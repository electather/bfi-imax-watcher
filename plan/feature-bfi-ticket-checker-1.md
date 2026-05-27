---
goal: Build a Dockerized TypeScript service that polls the BFI IMAX "Odyssey 70mm" page behind Cloudflare via headless Playwright and sends a Telegram alert when tickets become bookable
version: 1.0
date_created: 2026-05-27
last_updated: 2026-05-27
owner: omid@what3words.com
status: 'Planned'
tags: [feature, infrastructure, scraping, notifier]
---

# Introduction

![Status: Planned](https://img.shields.io/badge/status-Planned-blue)

This plan implements a single long-running TypeScript service, shipped as a Docker container, that polls one BFI IMAX web page on a fixed interval, detects when the film transitions from "coming soon" to "bookable", and sends a Telegram alert exactly once per transition. The page sits behind a Cloudflare managed JS challenge, so the service uses headless Playwright + Chromium to render the page. The design source is `docs/superpowers/specs/2026-05-27-bfi-odyssey-ticket-checker-design.md`. The build is gated on a Phase 0 spike that proves headless Chromium can pass the Cloudflare challenge.

## 1. Requirements & Constraints

- **REQ-001**: Watch only the Odyssey 70mm page (`TARGET_URL`), not the whole BFI catalogue.
- **REQ-002**: Detect status as one of `bookable | coming_soon | unknown`.
- **REQ-003**: Send a Telegram alert exactly once on transition into `bookable`.
- **REQ-004**: Persist last known status across container restarts; do not re-alert for an already-known `bookable` state.
- **REQ-005**: Re-arm the alert if status flips back to a non-bookable state (`coming_soon`).
- **REQ-006**: `unknown` is never itself alert-worthy; it is logged and counted toward `ERROR_ALERT_AFTER`. (Reviewer advisory 1.)
- **REQ-007**: Accept a rare duplicate alert on the sequence `bookable -> unknown -> bookable`; do not add machinery to suppress it. (Reviewer advisory 2.)
- **REQ-008**: Send a Telegram error alert after `ERROR_ALERT_AFTER` consecutive cycles whose status is `unknown` (silent-breakage detection).
- **REQ-009**: The loop must never exit on a single failed cycle.
- **CON-001**: The site is protected by a Cloudflare managed JS challenge (`cf-mitigated: challenge`). Plain HTTP returns HTTP 403. A real JS-executing browser is required.
- **CON-002**: Pin the Playwright npm version and the Docker base image tag to the SAME concrete version: Playwright `1.50.0`, image `mcr.microsoft.com/playwright:v1.50.0-jammy`. They must never drift. (Reviewer advisory 3.)
- **CON-003**: The state file path is fixed at `/data/last_status.json` inside the container; `state.ts` reads `STATE_FILE` (default `/data/last_status.json`) and `docker-compose.yml` mounts a named volume at `/data`. The two must agree. (Reviewer advisory 4.)
- **CON-004**: Runtime is Node 20+ with TypeScript. Notifier uses native global `fetch` (no HTTP dependency).
- **GUD-001**: Each module has one responsibility and is independently testable. `detector.ts` is a pure function with no I/O.
- **GUD-002**: All configuration is supplied via environment variables; no secrets committed to the repo.
- **PAT-001**: `detector.ts` signature is `detect(html: string, config: DetectorConfig): Status`. No side effects.
- **PAT-002**: `fetcher.ts` exposes `fetchHtml(config): Promise<string>` and owns all browser lifecycle.

## 2. Implementation Steps

### Implementation Phase 0 — Cloudflare spike (gates all later phases)

- GOAL-000: Prove headless Chromium passes the BFI Cloudflare challenge and renders the real article; capture the first HTML fixture. No later phase begins until GOAL-000 completes.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-001 | Create a throwaway script `spike/spike.ts` that launches Playwright Chromium headless, navigates to `TARGET_URL`, waits up to 30s for `networkidle` and for the document title to NOT equal "Just a moment...", then writes `page.content()` to `tests/fixtures/coming_soon.html`. | | |
| TASK-002 | Run the spike inside the pinned image `mcr.microsoft.com/playwright:v1.50.0-jammy`. Confirm the saved HTML contains the article body (film title text) and NOT the Cloudflare interstitial. | | |
| TASK-003 | If headless is blocked: add `playwright-extra` + `puppeteer-extra-plugin-stealth`, retry TASK-002. If still blocked: stop and escalate to the hybrid `cf_clearance` fallback (documented in spec Alternatives). Record the working method in `plan/feature-bfi-ticket-checker-1.md` notes. | | |
| TASK-004 | Delete `spike/` once the working approach and fixture are captured. The proven launch method becomes the basis for `fetcher.ts`. | | |

### Implementation Phase 1 — Project scaffold

- GOAL-001: Initialize the TypeScript project, tooling, and pinned dependencies.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-005 | Create `package.json` (type module, Node 20 engines). Scripts: `build` (`tsc`), `start` (`node dist/main.js`), `dev` (`tsx src/main.ts`), `test` (`vitest run`), `lint` (`eslint .`), `format` (`prettier --write .`). | | |
| TASK-006 | Add exact-pinned deps: `playwright@1.50.0` (and stealth packages only if Phase 0 required them). Dev deps: `typescript@5.x`, `tsx`, `vitest`, `eslint`, `@typescript-eslint/*`, `prettier`. | | |
| TASK-007 | Create `tsconfig.json` (target ES2022, module NodeNext, `outDir dist`, `rootDir src`, strict true). | | |
| TASK-008 | Create `.eslintrc.cjs` and `.prettierrc`. Confirm `.gitignore` already excludes `node_modules/`, `dist/`, `.env`, `last_status.json`, `*.log` (it does). | | |

### Implementation Phase 2 — Core modules

- GOAL-002: Implement config, detector, state, notifier, fetcher as isolated modules with unit tests.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-009 | `src/config.ts`: load + validate env into a typed `Config`. Required: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`. Defaults: `TARGET_URL` (Odyssey page), `CHECK_INTERVAL=900`, `HEADLESS=true`, `ERROR_ALERT_AFTER=5`, `STATE_FILE=/data/last_status.json`. Throw on missing required vars. | | |
| TASK-010 | `src/detector.ts`: pure `detect(html, config): Status`. Rules per spec — `bookable` if a Book/Buy-tickets link, showtime/date, or `mapSelect.asp` link present and/or coming-soon text absent; `coming_soon` if coming-soon text present and no booking affordance; else `unknown`. Keywords configurable via `DetectorConfig`. No I/O. | | |
| TASK-011 | `src/state.ts`: `readStatus(file): Status \| null` and `writeStatus(file, status): void`. JSON at `STATE_FILE`. Create parent dir if missing. Treat unreadable/missing file as `null`. | | |
| TASK-012 | `src/notifier.ts`: `sendAlert(config, text): Promise<void>` and `sendError(config, text): Promise<void>` via `fetch` POST to `https://api.telegram.org/bot<token>/sendMessage`. Throw on non-2xx so the loop can count failures. | | |
| TASK-013 | `src/fetcher.ts`: `fetchHtml(config): Promise<string>` using the Phase 0 proven launch method. Wait for challenge clearance; throw on timeout/interstitial so caller maps to `unknown`. Owns browser launch/close per call. | | |

### Implementation Phase 3 — Orchestration

- GOAL-003: Wire the loop with dedup, error counting, retries, and logging.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-014 | `src/main.ts`: one cycle = fetch (retry 3x exponential backoff) -> detect -> compare to stored status -> act. On fetch failure after retries, status = `unknown`. | | |
| TASK-015 | Dedup logic: alert + persist only on `previous != bookable && current == bookable`. Persist current status every cycle. On `current == coming_soon` after `bookable`, persist (re-arm). `unknown` is logged, persisted as `unknown` only for error-counting, and never triggers an alert (REQ-006). | | |
| TASK-016 | Error counting: maintain in-memory consecutive-`unknown` counter; when it reaches `ERROR_ALERT_AFTER`, call `notifier.sendError` once, then reset counter. Reset on any non-`unknown` cycle. | | |
| TASK-017 | Loop: wrap each cycle in try/catch so no single cycle exits the process; `sleep(CHECK_INTERVAL)` between cycles; log a heartbeat line per cycle (ISO timestamp, status, action). Handle SIGTERM/SIGINT for clean browser shutdown. | | |

### Implementation Phase 4 — Containerization & docs

- GOAL-004: Package as a container and document setup.

| Task | Description | Completed | Date |
|------|-------------|-----------|------|
| TASK-018 | `Dockerfile`: FROM `mcr.microsoft.com/playwright:v1.50.0-jammy`; install deps, `npm run build`, CMD `node dist/main.js`. | | |
| TASK-019 | `docker-compose.yml`: service with `restart: always`, `env_file: .env`, named volume mounted at `/data` (matches `STATE_FILE`, CON-003). | | |
| TASK-020 | `.env.example`: all env vars from TASK-009 with placeholder values and comments. | | |
| TASK-021 | `README.md`: how to create a Telegram bot + get chat id, configure `.env`, `docker compose up -d`, view logs, change interval. | | |

## 3. Alternatives

- **ALT-001**: Lightweight HTTP impersonation (`curl_cffi`/`cloudscraper`-equivalents). Rejected: managed JS challenges generally not bypassable; confirmed `cf-mitigated: challenge`.
- **ALT-002**: Hybrid — browser solves once, reuse `cf_clearance` cookie for fast `fetch` polls. Kept only as Phase 0 fallback; `cf_clearance` is short-lived and IP+UA-bound, marginal gain for 15-min polling.
- **ALT-003**: Cron-in-container instead of an internal loop. Rejected: a long-running process with `sleep` is simpler and keeps state in memory across cycles for error counting.
- **ALT-004**: Python (matches most prior art). Rejected: user requested TypeScript.

## 4. Dependencies

- **DEP-001**: `playwright@1.50.0` (Chromium driver).
- **DEP-002**: Docker base image `mcr.microsoft.com/playwright:v1.50.0-jammy` (Node + Chromium preinstalled), version-locked to DEP-001 (CON-002).
- **DEP-003**: `typescript`, `tsx`, `vitest`, `eslint`, `@typescript-eslint/*`, `prettier` (dev).
- **DEP-004**: A Telegram bot token + chat id (user-provisioned, runtime).
- **DEP-005** (conditional): `playwright-extra` + `puppeteer-extra-plugin-stealth`, only if Phase 0 TASK-003 requires them.

## 5. Files

- **FILE-001**: `spike/spike.ts` — throwaway Phase 0 challenge probe (deleted in TASK-004).
- **FILE-002**: `src/config.ts` — typed env loader/validator.
- **FILE-003**: `src/detector.ts` — pure `detect(html, config): Status`.
- **FILE-004**: `src/state.ts` — read/write `STATE_FILE`.
- **FILE-005**: `src/notifier.ts` — Telegram `sendAlert` / `sendError`.
- **FILE-006**: `src/fetcher.ts` — Playwright headless fetch + challenge wait.
- **FILE-007**: `src/main.ts` — loop, dedup, error counting, logging, signals.
- **FILE-008**: `src/types.ts` — `Status`, `Config`, `DetectorConfig` types.
- **FILE-009**: `tests/fixtures/coming_soon.html` — real captured page (Phase 0).
- **FILE-010**: `tests/fixtures/bookable.html` — synthetic/known bookable variant for detector tests.
- **FILE-011**: `tests/detector.test.ts`, `tests/state.test.ts`, `tests/notifier.test.ts`.
- **FILE-012**: `Dockerfile`, `docker-compose.yml`, `.env.example`, `README.md`.
- **FILE-013**: `package.json`, `tsconfig.json`, `.eslintrc.cjs`, `.prettierrc`.

## 6. Testing

- **TEST-001**: `detector.test.ts` — `coming_soon.html` fixture → `coming_soon`.
- **TEST-002**: `detector.test.ts` — `bookable.html` fixture → `bookable`.
- **TEST-003**: `detector.test.ts` — garbage/interstitial HTML → `unknown`.
- **TEST-004**: `state.test.ts` — write then read returns same status; missing file → `null`; corrupt file → `null`.
- **TEST-005**: `notifier.test.ts` — mocked `fetch`: 2xx resolves; non-2xx throws.
- **TEST-006**: `main` dedup unit (extract pure decision fn `decideAction(prev, current)`): `coming_soon→bookable` = alert; `bookable→bookable` = no alert; `bookable→coming_soon` = re-arm; `bookable→unknown` = no alert; `unknown→bookable` = alert (duplicate accepted, REQ-007).
- **TEST-007**: error-counter unit: N consecutive `unknown` → one error alert then reset; any non-`unknown` resets.

## 7. Risks & Assumptions

- **RISK-001**: Headless Chromium is detected and blocked by Cloudflare. Mitigation: Phase 0 gate + stealth fallback + hybrid `cf_clearance` fallback.
- **RISK-002**: The "bookable" markup differs from assumptions (page is coming-soon now, real bookable HTML unknown). Mitigation: configurable keywords + belt-and-braces rule; `bookable.html` is synthetic until the real state appears; revisit detector when the page changes.
- **RISK-003**: Cloudflare/Playwright version drift breaks launch. Mitigation: CON-002 version lock.
- **RISK-004**: Telegram API/network outage. Mitigation: errors thrown and logged; loop continues; `ERROR_ALERT_AFTER` surfaces persistent failure (though if Telegram itself is down the alert cannot send — logged regardless).
- **ASSUMPTION-001**: Host runs Docker and stays always-on (NAS/VPS/Mac mini).
- **ASSUMPTION-002**: 15-minute polling is frequent enough to catch the drop in time; user can lower `CHECK_INTERVAL`.
- **ASSUMPTION-003**: Playwright `1.50.0` is available and compatible; if a newer pinned version is preferred, update DEP-001 and CON-002/DEP-002 together.

## 8. Related Specifications / Further Reading

- Design spec: `docs/superpowers/specs/2026-05-27-bfi-odyssey-ticket-checker-design.md`
- Prior art: https://github.com/jamesgawn/bfi-imax-new-film-notifier
- Prior art: https://gist.github.com/rach/2439291
- Prior art: https://github.com/matrso/Oppenheimer-Ticket-Checker
- Playwright Docker images: https://playwright.dev/docs/docker
- Telegram Bot API (`sendMessage`): https://core.telegram.org/bots/api#sendmessage
