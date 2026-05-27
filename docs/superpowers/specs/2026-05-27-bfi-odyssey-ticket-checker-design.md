# BFI IMAX Odyssey Ticket Checker — Design

**Date:** 2026-05-27
**Status:** Approved (design phase)

## Problem

The BFI IMAX page for *Odyssey — The Film (IMAX 70mm, 2026)* is currently "coming
soon" with no tickets on sale. We want an automatic alert the moment tickets
become bookable, so we can buy before the screening sells out.

Target URL:
`https://whatson.bfi.org.uk/imax/Online/default.asp?BOparam::WScontent::loadArticle::permalink=odyssey-the-film-imax-70mm-2026`

## Research findings

- **No existing local project** — the `bfiMovieCheck/` directory is empty.
- **Prior art exists but none is drop-in:**
  - [jamesgawn/bfi-imax-new-film-notifier](https://github.com/jamesgawn/bfi-imax-new-film-notifier)
    — BFI-specific, serverless TypeScript, *tweets* when any new film opens. Watches
    all films, not one; notifies publicly via Twitter, not personally.
  - [rach gist](https://gist.github.com/rach/2439291) — Python + BeautifulSoup +
    email, 12h polling. Old; uses a now-dead URL (`bfi.org.uk/whatson/...`).
  - [matrso/Oppenheimer-Ticket-Checker](https://github.com/matrso/Oppenheimer-Ticket-Checker)
    — Selenium + AWS, single film. Same shape as this goal.
- **The site is protected by a Cloudflare managed JS challenge.** Confirmed by test:
  plain `curl`/`requests` with a browser User-Agent returns **HTTP 403** with the
  "Just a moment..." interstitial and header `cf-mitigated: challenge`. A simple HTTP
  scrape will not work; a real browser that executes JS is required. This is the
  single most important constraint shaping the design.

## Requirements

1. Watch **only** the Odyssey 70mm page and alert when it becomes **bookable**.
2. Alert via a **Telegram bot**.
3. Run as an **always-on Docker container**.
4. Alert **once** per transition into bookable (no repeated spam), and survive
   restarts without re-alerting for an already-known state.
5. Survive transient failures (network, challenge) without crashing the loop.

## Chosen approach

**Headless browser (Playwright + Chromium) inside the container.** Each cycle
launches/uses headless Chromium, loads the page, lets Cloudflare's managed
challenge auto-resolve for the real browser, then inspects the rendered DOM.

Approaches considered and rejected:

- **Lightweight HTTP impersonation** (`curl_cffi`/`cloudscraper`-equivalents):
  tiny and fast, but managed JS challenges are generally not bypassable by these.
  We confirmed `cf-mitigated: challenge`, so this is unreliable. Rejected as primary.
- **Hybrid (browser solves once, reuse `cf_clearance` cookie for fast polls):**
  cheaper steady-state, but `cf_clearance` is short-lived and IP+UA-bound; marginal
  gain for polling one page every 15 minutes. Over-engineering. Kept only as a
  fallback if headless Chromium is blocked.

**Language/stack:** Node 20+ with TypeScript.

## Architecture

Single long-running TypeScript service in Docker. Internal loop:
`check → sleep(CHECK_INTERVAL) → repeat`. Container policy `restart: always`.

```
[loop scheduler] → [fetcher: Playwright headless Chromium] → [detector: parse DOM]
                                                                      |
                        [state store: last_status.json] <-> [notifier: Telegram]
```

### Modules (each one job, independently testable)

| Module        | Responsibility                                                                 | Depends on            |
|---------------|--------------------------------------------------------------------------------|-----------------------|
| `config.ts`   | Load + validate env vars; expose typed config object.                          | env                   |
| `fetcher.ts`  | Launch headless Chromium, load `TARGET_URL`, wait for Cloudflare to clear, return rendered HTML. Adds `playwright-extra` stealth if headless is detected. | playwright            |
| `detector.ts` | **Pure function** `html -> Status`. No I/O. Easy to unit-test with fixtures.   | none                  |
| `notifier.ts` | Send a Telegram message via Bot API using native `fetch`.                      | config                |
| `state.ts`    | Read/write last known status to a JSON file on a mounted volume.               | filesystem            |
| `main.ts`     | Wire the loop, logging, error handling, dedup decision.                        | all of the above      |

## Detection logic

`Status = "bookable" | "coming_soon" | "unknown"`

The exact "bookable" markup is unknown while the page is coming-soon, so the
detector uses configurable keywords with a belt-and-braces rule:

- **bookable** — a "Book" / "Buy tickets" link or a showtime/date or a
  `mapSelect.asp` booking link is present in the article, and/or coming-soon text
  is gone.
- **coming_soon** — coming-soon text present and no booking affordance.
- **unknown** — neither matches (markup changed, or the challenge was not passed).
  Logged; optionally alerted so silent breakage is noticed.

`detector.ts` is a pure function over saved HTML, unit-tested against fixtures for
the coming-soon and (synthetic/known) bookable states.

## Notification + dedup

- Alert fires **once** on transition `coming_soon`/`unknown` → `bookable`.
- Last status persisted in `last_status.json` on a mounted volume; survives restart.
- Re-arms if the status flips back to non-bookable.
- Telegram message includes the film title, the URL, and a clear "Tickets now
  bookable" line.
- Optional: send a Telegram alert after **N consecutive fetch errors** to surface
  silent breakage. A heartbeat line is logged each cycle.

## Configuration (env)

| Var                  | Default                  | Purpose                                  |
|----------------------|--------------------------|------------------------------------------|
| `TELEGRAM_BOT_TOKEN` | (required)               | Telegram bot token.                      |
| `TELEGRAM_CHAT_ID`   | (required)               | Chat to notify.                          |
| `TARGET_URL`         | Odyssey 70mm page        | Page to watch.                           |
| `CHECK_INTERVAL`     | `900` (15 min)           | Seconds between checks.                   |
| `HEADLESS`           | `true`                   | Run Chromium headless.                    |
| `ERROR_ALERT_AFTER`  | `5`                      | Consecutive errors before an error alert. |

## Deployment

- Base image: `mcr.microsoft.com/playwright:vX-jammy` (Node + Chromium preinstalled).
- Build: `tsc` → `dist/`, run `node dist/main.js`. `tsx` for local dev.
- Ships: `Dockerfile`, `docker-compose.yml`, `.env.example`, `README.md`.
- Run on an always-on host (NAS / VPS / Mac mini). Volume mounts the state file.

## Error handling

- Fetch wrapped in retry (3x with backoff). Failure → status `unknown`, logged, no
  crash.
- The loop never dies on a single bad cycle.
- Each cycle logs a heartbeat (timestamp, status, action taken).

## Testing

- **Unit:** `detector.ts` against saved HTML fixtures (coming-soon and bookable).
- **Unit:** `state.ts` read/write/dedup transitions.
- **Smoke:** `notifier.ts` with mocked `fetch`.
- Tooling: `vitest`, ESLint, Prettier.

## Phase 0 — spike (do first, gates the build)

~15 minutes: run headless Playwright + Chromium in a container against the target
URL. Confirm it passes the Cloudflare challenge and renders the real article; save
the HTML as the first detector fixture.

- If headless is blocked → add `playwright-extra` + stealth plugin.
- If still blocked → fall back to the hybrid cookie approach (solve once with a
  visible/virtual-display browser, reuse `cf_clearance`).

**The full build is gated on this spike passing.**

## Out of scope (YAGNI)

- Watching multiple films or the whole BFI catalogue.
- Auto-purchasing tickets.
- Web UI / dashboard.
- Channels other than Telegram (email, SMS) — can be added later behind the
  `notifier` interface if wanted.
