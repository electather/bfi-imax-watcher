# bfi-imax-watcher

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A520-brightgreen)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue)](https://www.typescriptlang.org/)

A small, always-on TypeScript service that watches a BFI IMAX film page and
sends a **Telegram** alert the moment tickets become bookable. Shipped pre-tuned
for **_Odyssey — The Film (IMAX 70mm, 2026)_**, but the target URL and detection
keywords are configurable so it works for any BFI IMAX listing.

Instead of treating the whole page as one status, it parses **each individual
showtime** (date, time, availability, booking link) and can be told to watch
**only the showtimes you care about** — by time of day, day of week, and/or date
range. It then alerts **once per distinct matching showtime** that becomes
bookable, including a direct booking link, and re-arms a showtime if it sells
out and later reopens.

The BFI page sits behind a Cloudflare managed JS challenge, so the service
renders it with headless **Playwright + Chromium** rather than a plain HTTP
request. It checks every 15 minutes (configurable) and persists state so it does
not re-alert after a restart.

## How it works

```
loop: fetch (headless Chromium, clears Cloudflare) -> parse showtimes
      -> keep the ones matching your filter -> alert each newly-bookable one
      (with booking link) -> persist tracked set -> sleep -> repeat
```

| Module         | Responsibility                                                              |
| -------------- | --------------------------------------------------------------------------- |
| `config.ts`    | Load + validate environment variables (incl. watch filter) into config.     |
| `fetcher.ts`   | Launch headless Chromium, clear Cloudflare, return the HTML.                |
| `detector.ts`  | Pure function: page-level `bookable \| coming_soon \| sold_out \| unknown`. |
| `showtimes.ts` | Pure: HTML -> per-showtime list; filter by time/day/date.                   |
| `state.ts`     | Read/write the set of already-alerted showtime keys as JSON on a volume.    |
| `notifier.ts`  | Send Telegram messages via the Bot API (native `fetch`).                    |
| `decide.ts`    | Pure per-showtime alert + error-counting decisions.                         |
| `main.ts`      | Wire the loop, retries, logging, and signal handling.                       |

The page-level status is still computed for logging and the error counter. It is
`unknown` when a page cannot be read or classified; an `unknown` read never
touches the tracked showtime set, and after `ERROR_ALERT_AFTER` consecutive
`unknown` checks the service sends one error alert so silent breakage is noticed.

## Watching only the showtimes you want

**Defaults are baked in** for Odyssey — weekends at prime times **or** any weekday
evening after 6pm, across the run window (17 Jul – 13 Aug 2026). The app works
with no watch config at all; the variables below only **override** the defaults.
Setting any of `WATCH_RULES` / `WATCH_TIMES` / `WATCH_DAYS` replaces the default
rules entirely; each date bound is overridden independently.

| Variable          | Meaning                                                                 | Example                                               |
| ----------------- | ----------------------------------------------------------------------- | ----------------------------------------------------- |
| `WATCH_RULES`     | One or more `DAYS@TIMES` rules separated by `;`. **Rules are ORed.**    | `sat,sun@12:00-13:00,19:30-21:00;mon-fri@18:00-23:59` |
| `WATCH_TIMES`     | Simple mode times: `HH:MM` (exact) or `HH:MM-HH:MM` (range), CSV.       | `11:30,18:00-22:00`                                   |
| `WATCH_DAYS`      | Simple mode days: names/abbreviations, with ranges like `mon-fri`, CSV. | `sat,sun`                                             |
| `WATCH_DATE_FROM` | Inclusive earliest date (`YYYY-MM-DD`), applied on top of the rules.    | `2026-07-17`                                          |
| `WATCH_DATE_TO`   | Inclusive latest date (`YYYY-MM-DD`).                                   | `2026-08-13`                                          |

A showtime is watched when it falls inside the date window **and** matches at
least one rule. Inside a single rule, `DAYS` and `TIMES` are ANDed (and empty
means "any"). `WATCH_TIMES`/`WATCH_DAYS` are the simple mode: together they form
one rule, ORed with any `WATCH_RULES` groups.

Example — "weekend shows at prime times, **or** any weekday evening after 6pm,
across the whole run":

```
WATCH_RULES=sat,sun@12:00-13:00,16:00-17:00,19:30-21:00;mon-fri@18:00-23:59
WATCH_DATE_FROM=2026-07-17
WATCH_DATE_TO=2026-08-13
```

Each matching showtime alerts once, with its booking link. If a watched showtime
sells out it is dropped from the tracked set and alerts again if it reopens.
Pre-sale rows (BFI's `next-on-sale` marker) are treated as _not yet bookable_, so
they never trigger an alert until general sale opens.

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
in a named volume (`bfi-state` mounted at `/data`), so already-alerted showtimes
are not re-alerted after a restart or host reboot.

**Change the polling interval:** set `CHECK_INTERVAL` (seconds) in `.env` and
`docker compose up -d` again. Lower it (e.g. `120`) as the expected on-sale date
approaches.

### Pull the pre-built image from GHCR

Every push to `main` and every `v*.*.*` tag publishes a multi-arch
(`linux/amd64` + `linux/arm64`) image to the GitHub Container Registry at
[`ghcr.io/electather/bfi-imax-watcher`](https://github.com/electather/bfi-imax-watcher/pkgs/container/bfi-imax-watcher).
The package is public — no `docker login` is required to pull.

Available tags:

| Tag                    | What it tracks                           |
| ---------------------- | ---------------------------------------- |
| `latest`               | Latest commit on `main`.                 |
| `main`                 | Same as `latest`.                        |
| `v1.2.3` / `1.2` / `1` | A specific release tag (semver fan-out). |
| `sha-<short>`          | A specific commit (e.g. `sha-0310a6b`).  |

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

Pure logic (`detector.ts`, `showtimes.ts`, `decide.ts`, `notifier.ts`,
`state.ts`) is covered by vitest unit tests against fixtures in
`tests/fixtures/`. The Playwright fetch path is exercised end-to-end via
`npm run dev:check`.

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
(true), `ERROR_ALERT_AFTER` (5), `STATE_FILE` (`/data/last_status.json`), the
watch filter (`WATCH_RULES`, or simple `WATCH_TIMES`/`WATCH_DAYS`, plus
`WATCH_DATE_FROM`/`WATCH_DATE_TO`), and the detector keyword overrides.

## Contributing

Issues and pull requests welcome. Please run `npm run lint`, `npm run
typecheck`, and `npm test` before opening a PR.

## License

[MIT](LICENSE) © Omid Astaraki

## Disclaimer

This tool only reads publicly available BFI listings to alert its operator. It
does not bypass rate limits, scrape personal data, or automate purchases. Use
responsibly and respect the BFI website's terms of service.
