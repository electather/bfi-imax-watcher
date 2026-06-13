import process from "node:process";
import { loadConfig } from "./config.js";
import { decideShowtimeAlerts, evaluateErrorCounter } from "./decide.js";
import { detect } from "./detector.js";
import { fetchHtml } from "./fetcher.js";
import { sendAlert, sendError } from "./notifier.js";
import { filterShowtimes, isUnfiltered, parseShowtimes } from "./showtimes.js";
import { readAlerted, writeAlerted } from "./state.js";
import type { Config, Showtime, Status } from "./types.js";

const FETCH_RETRIES = 3;
const FETCH_BACKOFF_BASE_MS = 2_000;
const SHUTDOWN_POLL_MS = 1_000;

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function log(line: string): void {
  console.log(`${new Date().toISOString()} ${line}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sleep that wakes early once shouldStop() returns true, so SIGTERM/SIGINT
// don't have to wait out a full check interval.
async function sleepInterruptible(
  ms: number,
  shouldStop: () => boolean,
): Promise<void> {
  let waited = 0;
  while (waited < ms && !shouldStop()) {
    const step = Math.min(SHUTDOWN_POLL_MS, ms - waited);
    await sleep(step);
    waited += step;
  }
}

async function fetchWithRetry(config: Config): Promise<string> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= FETCH_RETRIES; attempt++) {
    try {
      return await fetchHtml(config);
    } catch (error) {
      lastError = error;
      log(`fetch attempt ${attempt}/${FETCH_RETRIES} failed: ${errMsg(error)}`);
      if (attempt < FETCH_RETRIES) {
        await sleep(FETCH_BACKOFF_BASE_MS * 2 ** (attempt - 1));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

interface Observation {
  readonly status: Status;
  readonly showtimes: Showtime[];
  readonly title: string;
}

function extractTitle(html: string, fallback: string): string {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  if (!match?.[1]) {
    return fallback;
  }
  const text = match[1].replace(/<[^>]+>/g, "").trim();
  return text.length > 0 ? text : fallback;
}

// Fetch, classify, and parse showtimes; any failure after retries maps to
// "unknown" with no showtimes so the loop keeps running and the error counter
// can surface persistent breakage.
async function observe(config: Config): Promise<Observation> {
  try {
    const html = await fetchWithRetry(config);
    return {
      status: detect(html, config.detector),
      showtimes: parseShowtimes(html, config.targetUrl),
      title: extractTitle(html, "BFI IMAX listing"),
    };
  } catch (error) {
    log(`fetch failed after retries, status=unknown: ${errMsg(error)}`);
    return { status: "unknown", showtimes: [], title: "BFI IMAX listing" };
  }
}

function buildAlertText(
  config: Config,
  title: string,
  showtimes: readonly Showtime[],
): string {
  const lines = [
    `🎬 ${showtimes.length} watched showtime${showtimes.length === 1 ? "" : "s"} now bookable!`,
    title,
    "",
  ];
  for (const showtime of showtimes) {
    const link = showtime.bookingUrl ?? config.targetUrl;
    lines.push(`• ${showtime.raw} — ${link}`);
  }
  lines.push("", `Listing: ${config.targetUrl}`);
  return lines.join("\n");
}

// Returns true if the alert was delivered or there is nothing to retry (no
// credentials). Returns false only when a send was attempted and failed, so the
// caller can avoid persisting the alerted keys and thereby retry next cycle.
async function notifyAlert(
  config: Config,
  title: string,
  showtimes: readonly Showtime[],
): Promise<boolean> {
  const text = buildAlertText(config, title, showtimes);
  if (!config.telegramBotToken || !config.telegramChatId) {
    log(`[telegram not configured] would alert:\n${text}`);
    return true;
  }
  try {
    await sendAlert(config, text);
    log("alert sent");
    return true;
  } catch (error) {
    log(`alert send FAILED: ${errMsg(error)}`);
    return false;
  }
}

async function notifyError(config: Config, text: string): Promise<void> {
  if (!config.telegramBotToken || !config.telegramChatId) {
    log(`[telegram not configured] would send error: ${text}`);
    return;
  }
  try {
    await sendError(config, text);
    log("error alert sent");
  } catch (error) {
    log(`error alert send FAILED: ${errMsg(error)}`);
  }
}

async function runCycle(
  config: Config,
  consecutiveUnknown: number,
): Promise<number> {
  const { status, showtimes, title } = await observe(config);

  // Only touch the alerted set when the page actually rendered. An "unknown"
  // read (Cloudflare challenge, fetch failure) yields no showtimes; treating
  // that as "everything sold out" would wipe the set and re-alert spuriously
  // once the page recovers.
  let alertedSummary = "skipped (unknown)";
  if (status !== "unknown") {
    const matches = filterShowtimes(showtimes, config.watch);
    const bookableMatches = matches.filter(
      (showtime) => showtime.availability === "bookable",
    );
    const prevAlerted = readAlerted(config.stateFile);
    const { toAlert, nextAlerted } = decideShowtimeAlerts(
      prevAlerted,
      bookableMatches,
    );

    if (toAlert.length > 0) {
      const delivered = await notifyAlert(config, title, toAlert);
      if (delivered) {
        writeAlerted(config.stateFile, nextAlerted);
      } else {
        // Leave the set untouched so the same showtimes retry next cycle.
        log("not persisting alerted keys so the alert retries next cycle");
      }
    } else {
      writeAlerted(config.stateFile, nextAlerted);
    }

    alertedSummary =
      `watched=${matches.length} bookable=${bookableMatches.length} ` +
      `alerted=${toAlert.length} tracked=${nextAlerted.size}`;
  }

  const errorEval = evaluateErrorCounter(
    consecutiveUnknown,
    status,
    config.errorAlertAfter,
  );
  if (errorEval.fireError) {
    await notifyError(
      config,
      `No successful read for ${config.errorAlertAfter} consecutive checks of ${config.targetUrl}`,
    );
  }

  log(
    `heartbeat status=${status} showtimes=${showtimes.length} ${alertedSummary} ` +
      `consecutiveUnknown=${errorEval.consecutive}`,
  );
  return errorEval.consecutive;
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const config = loadConfig(process.env, { allowMissingTelegram: once });

  const rulesDesc = config.watch.rules
    .map(
      (rule) =>
        `{days=[${rule.days.join(",")}] ` +
        `times=[${rule.times.map((range) => `${range.startMin}-${range.endMin}`).join(",")}]}`,
    )
    .join(" OR ");
  const filterDesc = isUnfiltered(config.watch)
    ? "all showtimes"
    : `rules=${rulesDesc || "(none)"} ` +
      `dateFrom=${config.watch.dateFrom ?? "*"} dateTo=${config.watch.dateTo ?? "*"}`;
  log(
    `starting bfi-imax-watcher once=${once} ` +
      `interval=${config.checkIntervalSeconds}s headless=${config.headless} url=${config.targetUrl} ` +
      `watching=${filterDesc}`,
  );

  let shuttingDown = false;
  const onSignal = (signal: string): void => {
    log(`received ${signal}, shutting down after current cycle`);
    shuttingDown = true;
  };
  process.on("SIGTERM", () => onSignal("SIGTERM"));
  process.on("SIGINT", () => onSignal("SIGINT"));

  let consecutiveUnknown = 0;
  do {
    try {
      consecutiveUnknown = await runCycle(config, consecutiveUnknown);
    } catch (error) {
      // The loop must never exit on a single bad cycle (REQ-009).
      log(`cycle error (loop continues): ${errMsg(error)}`);
    }
    if (once || shuttingDown) {
      break;
    }
    await sleepInterruptible(
      config.checkIntervalSeconds * 1_000,
      () => shuttingDown,
    );
  } while (!shuttingDown);

  log("stopped");
}

main().catch((error: unknown) => {
  log(`fatal: ${errMsg(error)}`);
  process.exitCode = 1;
});
