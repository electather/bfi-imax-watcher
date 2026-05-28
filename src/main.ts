import process from "node:process";
import { loadConfig } from "./config.js";
import { decideAction, evaluateErrorCounter } from "./decide.js";
import { detect } from "./detector.js";
import { fetchHtml } from "./fetcher.js";
import { sendAlert, sendError } from "./notifier.js";
import { readStatus, writeStatus } from "./state.js";
import type { Config, Status } from "./types.js";

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

// Fetch and classify; any failure after retries maps to "unknown" so the loop
// keeps running and the error counter can surface persistent breakage.
async function determineStatus(config: Config): Promise<Status> {
  try {
    const html = await fetchWithRetry(config);
    return detect(html, config.detector);
  } catch (error) {
    log(`fetch failed after retries, status=unknown: ${errMsg(error)}`);
    return "unknown";
  }
}

function buildAlertText(config: Config): string {
  return [
    "🎬 Tickets now bookable!",
    "Odyssey — The Film (IMAX 70mm, 2026)",
    `Book now: ${config.targetUrl}`,
  ].join("\n");
}

// Returns true if the alert was delivered or there is nothing to retry (no
// credentials). Returns false only when a send was attempted and failed, so the
// caller can avoid persisting "bookable" and thereby retry next cycle.
async function notifyAlert(config: Config): Promise<boolean> {
  const text = buildAlertText(config);
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
  const status = await determineStatus(config);
  const prev = readStatus(config.stateFile);
  const decision = decideAction(prev, status);

  let persisted = false;
  if (decision === "alert") {
    const delivered = await notifyAlert(config);
    if (delivered) {
      writeStatus(config.stateFile, status);
      persisted = true;
    } else {
      log("not persisting bookable so the alert retries next cycle");
    }
  } else {
    writeStatus(config.stateFile, status);
    persisted = true;
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
    `heartbeat prev=${prev ?? "none"} status=${status} decision=${decision} ` +
      `persisted=${persisted} consecutiveUnknown=${errorEval.consecutive}`,
  );
  return errorEval.consecutive;
}

async function main(): Promise<void> {
  const once = process.argv.includes("--once");
  const config = loadConfig(process.env, { allowMissingTelegram: once });

  log(
    `starting bfi-odyssey-ticket-checker once=${once} ` +
      `interval=${config.checkIntervalSeconds}s headless=${config.headless} url=${config.targetUrl}`,
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
