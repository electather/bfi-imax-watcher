# bfi-imax-watcher

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

A small, always-on TypeScript service that watches a BFI IMAX film page and
sends a **Telegram** alert the moment tickets become bookable. Shipped pre-tuned
for **_Odyssey — The Film (IMAX 70mm, 2026)_**, but the target URL and detection
keywords are configurable so it works for any BFI IMAX listing.

The BFI page sits behind a Cloudflare managed JS challenge, so the service
renders it with headless **Playwright + Chromium** rather than a plain HTTP
request. It checks every 15 minutes (configurable), alerts **exactly once** per
transition into `bookable`, and persists state so it does not re-alert after a
restart.

## How it works

```
loop: fetch (headless Chromium, clears Cloudflare) -> detect status -> compare
      to last status -> alert on (coming_soon|sold_out|unknown) -> bookable
      -> sleep -> repeat
```

| Module        | Responsibility                                                          |
| ------------- | ----------------------------------------------------------------------- |
| `config.ts`   | Load + validate environment variables into a typed config.              |
| `fetcher.ts`  | Launch headless Chromium, clear Cloudflare, return the HTML.            |
| `detector.ts` | Pure function: HTML -> `bookable \| coming_soon \| sold_out \| unknown`. |
| `state.ts`    | Read/write the last known status as JSON on a volume.                   |
| `notifier.ts` | Send Telegram messages via the Bot API (native `fetch`).                |
| `decide.ts`   | Pure dedup + error-counting decisions.                                  |
| `main.ts`     | Wire the loop, retries, logging, and signal handling.                   |

Status is `unknown` when a page cannot be read or classified. `unknown` never
triggers a "bookable" alert; instead, after `ERROR_ALERT_AFTER` consecutive
`unknown` checks the service sends one error alert so silent breakage is noticed.

## Quick start

### 1. Create a Telegram bot

1. In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and
   follow the prompts. Copy the **bot token** it gives you
   (`123456789:ABC...`).
2. Get your **chat id**: message your new bot once (say "hi"), then open
   `https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates` in a browser and read
   `result[].message.chat.id`. For a group, add the bot to the group and use the
   group's (negative) id.

### 2. Configure

```bash
cp .env.example .env
# edit .env and set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID
```

All variables and their defaults are documented in `.env.example`.

### 3. Run with Docker (recommended)

```bash
docker compose up -d --build      # start in the background
docker compose logs -f            # follow the heartbeat / status logs
docker compose down               # stop
```

The container restarts automatically (`restart: always`) and stores its state
in a named volume (`bfi-state` mounted at `/data`), so a known `bookable` is
not re-alerted after a restart or host reboot.

**Change the polling interval:** set `CHECK_INTERVAL` (seconds) in `.env` and
`docker compose up -d` again. Lower it (e.g. `120`) as the expected on-sale date
approaches.

### Pull the pre-built image from GHCR

Every push to `main` and every `v*.*.*` tag publishes a multi-arch
(`linux/amd64` + `linux/arm64`) image to the GitHub Container Registry at
[`ghcr.io/electather/bfi-imax-watcher`](https://github.com/electather/bfi-imax-watcher/pkgs/container/bfi-imax-watcher).
The package is public — no `docker login` is required to pull.

Available tags:

| Tag                     | What it tracks                                |
| ----------------------- | --------------------------------------------- |
| `latest`                | Latest commit on `main`.                      |
| `main`                  | Same as `latest`.                             |
| `v1.2.3` / `1.2` / `1`  | A specific release tag (semver fan-out).      |
| `sha-<short>`           | A specific commit (e.g. `sha-0310a6b`).       |

**One-liner:**

```bash
docker run -d \
  --name bfi-imax-watcher \
  --restart always \
  --env-file .env \
  -e STATE_FILE=/data/last_status.json \
  -v bfi-state:/data \
  ghcr.io/electather/bfi-imax-watcher:latest
```

**With `docker compose`:** edit `docker-compose.yml`, remove the `build: .` line
and set `image:` to the published tag:

```yaml
services:
  bfi-checker:
    image: ghcr.io/electather/bfi-imax-watcher:latest
    # ... rest unchanged
```

Then:

```bash
docker compose pull            # fetch newest image
docker compose up -d           # (re)start with it
```

**Private fork?** If you fork this repo and keep the package private, log in
first with a [classic PAT](https://github.com/settings/tokens) that has
`read:packages`:

```bash
echo "$GHCR_PAT" | docker login ghcr.io -u <your-github-user> --password-stdin
```

### 4. Verify the Cloudflare bypass (one-shot check)

Before trusting the service, confirm headless Chromium can actually clear the
challenge **from your network**. The one-shot mode runs a single check and
exits; it does not require Telegram credentials:

```bash
# Locally (Node 20+):
npm install
npx playwright install chromium
STATE_FILE=./data/last_status.json npm run dev:check

# Or inside the built image:
docker compose run --rm bfi-checker node dist/main.js --once
```

A healthy run logs `status=coming_soon` (today) — anything else (especially a
run that logs a fetch failure or `status=unknown`) means the challenge was not
cleared from your environment; see [Troubleshooting](#troubleshooting).

> **Note on bot detection.** Whether headless Chromium clears Cloudflare
> depends on the host IP/fingerprint. `fetcher.ts` ships with a realistic user
> agent, locale, viewport, and `navigator.webdriver` masking. If you are
> consistently blocked, the next step is `playwright-extra` + the stealth
> plugin, then a hybrid `cf_clearance` approach.

## Watching a different film

Point at any BFI IMAX listing by setting `TARGET_URL`. If that page's bookable
markup differs from Odyssey's, tune the detector keywords (`BOOKABLE_KEYWORDS`,
`COMING_SOON_KEYWORDS`, `SOLD_OUT_KEYWORDS`, `BOOKING_LINK_PATTERNS`) — see
`.env.example` for examples. No code changes required.

## Development

```bash
npm install
npm run dev          # run the loop with tsx (no build step)
npm run dev:check    # run a single check and exit
npm run build        # compile TypeScript to dist/
npm test             # run the vitest unit suite
npm run lint         # eslint
npm run format       # prettier --write
npm run typecheck    # tsc --noEmit
```

Pure logic (`detector.ts`, `decide.ts`, `notifier.ts`, `state.ts`) is covered
by vitest unit tests against fixtures in `tests/fixtures/`. The Playwright
fetch path is exercised end-to-end via `npm run dev:check`.

## Troubleshooting

- **Fetch fails / `status=unknown` every cycle:** the challenge is not clearing
  from your network. Try a different host/IP, then add stealth (see the note in
  step 4). The Node process itself must also have outbound network access.
- **No Telegram messages:** re-check `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID`,
  and that you have messaged the bot at least once. Logs show send failures.
- **Re-alerted after restart:** ensure the `/data` volume is mounted and
  `STATE_FILE` points inside it (the defaults already do).

## Configuration reference

See [`.env.example`](.env.example). Required: `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID`. Optional: `TARGET_URL`, `CHECK_INTERVAL` (900), `HEADLESS`
(true), `ERROR_ALERT_AFTER` (5), `STATE_FILE` (`/data/last_status.json`), and
the detector keyword overrides.

## Contributing

Issues and pull requests welcome. Please run `npm run lint`, `npm run
typecheck`, and `npm test` before opening a PR.

## License

[MIT](LICENSE) © Omid Astaraki

## Disclaimer

This tool only reads publicly available BFI listings to alert its operator. It
does not bypass rate limits, scrape personal data, or automate purchases. Use
responsibly and respect the BFI website's terms of service.
