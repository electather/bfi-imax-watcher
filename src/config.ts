import { DEFAULT_DETECTOR_CONFIG } from "./detector.js";
import type { Config, DetectorConfig } from "./types.js";

const DEFAULT_TARGET_URL =
  "https://whatson.bfi.org.uk/imax/Online/default.asp?BOparam::WScontent::loadArticle::permalink=odyssey-the-film-imax-70mm-2026";

export interface LoadConfigOptions {
  /**
   * When true, missing Telegram credentials are tolerated (resolved to empty
   * strings) instead of throwing. Used by one-shot check mode so the live
   * Cloudflare/detection path can be exercised without bot setup.
   */
  readonly allowMissingTelegram?: boolean;
}

type Env = Record<string, string | undefined>;

function required(env: Env, key: string): string {
  const value = env[key]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

function optional(env: Env, key: string, fallback: string): string {
  const value = env[key]?.trim();
  return value ? value : fallback;
}

function positiveInt(env: Env, key: string, fallback: number): number {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer, got: ${raw}`);
  }
  return value;
}

function boolean(env: Env, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`${key} must be true/false, got: ${raw}`);
}

// Comma-separated env override for a detector keyword list; falls back to the
// built-in default when unset so the detector always has sensible keywords.
function keywordList(
  env: Env,
  key: string,
  fallback: readonly string[],
): readonly string[] {
  const raw = env[key]?.trim();
  if (!raw) {
    return fallback;
  }
  const items = raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : fallback;
}

function loadDetectorConfig(env: Env): DetectorConfig {
  return {
    bookableKeywords: keywordList(
      env,
      "BOOKABLE_KEYWORDS",
      DEFAULT_DETECTOR_CONFIG.bookableKeywords,
    ),
    comingSoonKeywords: keywordList(
      env,
      "COMING_SOON_KEYWORDS",
      DEFAULT_DETECTOR_CONFIG.comingSoonKeywords,
    ),
    soldOutKeywords: keywordList(
      env,
      "SOLD_OUT_KEYWORDS",
      DEFAULT_DETECTOR_CONFIG.soldOutKeywords,
    ),
    bookingLinkPatterns: keywordList(
      env,
      "BOOKING_LINK_PATTERNS",
      DEFAULT_DETECTOR_CONFIG.bookingLinkPatterns,
    ),
  };
}

/**
 * Load and validate configuration from environment variables into a typed,
 * immutable Config. Throws on missing required vars or malformed values.
 */
export function loadConfig(
  env: Env = process.env,
  options: LoadConfigOptions = {},
): Config {
  const allowMissingTelegram = options.allowMissingTelegram ?? false;

  const telegramBotToken = allowMissingTelegram
    ? optional(env, "TELEGRAM_BOT_TOKEN", "")
    : required(env, "TELEGRAM_BOT_TOKEN");
  const telegramChatId = allowMissingTelegram
    ? optional(env, "TELEGRAM_CHAT_ID", "")
    : required(env, "TELEGRAM_CHAT_ID");

  return {
    telegramBotToken,
    telegramChatId,
    targetUrl: optional(env, "TARGET_URL", DEFAULT_TARGET_URL),
    checkIntervalSeconds: positiveInt(env, "CHECK_INTERVAL", 900),
    headless: boolean(env, "HEADLESS", true),
    errorAlertAfter: positiveInt(env, "ERROR_ALERT_AFTER", 5),
    stateFile: optional(env, "STATE_FILE", "/data/last_status.json"),
    detector: loadDetectorConfig(env),
  };
}
