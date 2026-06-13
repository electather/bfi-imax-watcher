import { DEFAULT_DETECTOR_CONFIG } from "./detector.js";
import type {
  Config,
  DetectorConfig,
  TimeRange,
  WatchFilter,
  WatchRule,
} from "./types.js";

const DEFAULT_TARGET_URL =
  "https://whatson.bfi.org.uk/imax/Online/default.asp?BOparam::WScontent::loadArticle::permalink=odyssey-the-film-imax-70mm-2026";

// Built-in watch defaults for Odyssey (IMAX 70mm, 2026), derived from the live
// presale listing: weekends at prime times, OR any weekday evening after 6pm,
// across the run window. Env vars override these — see loadWatchFilter.
const DEFAULT_WATCH_RULES =
  "sat,sun@12:00-13:00,16:00-17:00,19:30-21:00;mon-fri@18:00-23:59";
const DEFAULT_WATCH_DATE_FROM = "2026-07-17";
const DEFAULT_WATCH_DATE_TO = "2026-08-13";

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

const WEEKDAY_ALIASES: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

// Week order starting Monday, used to expand day ranges like `mon-fri`.
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

function parseHhmm(token: string, context: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(token);
  if (!match) {
    throw new Error(`${context} must be HH:MM, got: ${token}`);
  }
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) {
    throw new Error(`${context} is not a valid time: ${token}`);
  }
  return hour * 60 + minute;
}

// Comma-separated `HH:MM` (exact) or `HH:MM-HH:MM` (inclusive range) -> ranges.
function parseTimeRanges(raw: string, context: string): TimeRange[] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => {
      const parts = entry.split("-").map((part) => part.trim());
      const startMin = parseHhmm(parts[0] ?? "", context);
      const endMin =
        parts[1] === undefined ? startMin : parseHhmm(parts[1], context);
      if (endMin < startMin) {
        throw new Error(`${context} range end is before start: ${entry}`);
      }
      return { startMin, endMin };
    });
}

function dayNumber(token: string, context: string): number {
  const day = WEEKDAY_ALIASES[token.trim().toLowerCase()];
  if (day === undefined) {
    throw new Error(`${context} has an unknown weekday: ${token}`);
  }
  return day;
}

// Comma-separated weekday names/abbreviations; an entry may be a range such as
// `mon-fri` (expanded over the Mon..Sun week order, wrapping if needed).
function parseDays(raw: string, context: string): number[] {
  const days: number[] = [];
  for (const entry of raw.split(",").map((part) => part.trim())) {
    if (entry.length === 0) {
      continue;
    }
    const rangeParts = entry.split("-").map((part) => part.trim());
    if (rangeParts.length === 1) {
      days.push(dayNumber(entry, context));
      continue;
    }
    if (rangeParts.length !== 2) {
      throw new Error(`${context} has an invalid day range: ${entry}`);
    }
    const start = WEEK_ORDER.indexOf(dayNumber(rangeParts[0]!, context));
    const end = WEEK_ORDER.indexOf(dayNumber(rangeParts[1]!, context));
    for (let i = start; ; i = (i + 1) % WEEK_ORDER.length) {
      days.push(WEEK_ORDER[i]!);
      if (i === end) {
        break;
      }
    }
  }
  return [...new Set(days)];
}

// A single WATCH_RULES group: `DAYS@TIMES`, `DAYS@`, or just `TIMES`.
function parseRuleGroup(group: string): WatchRule {
  const at = group.indexOf("@");
  if (at === -1) {
    return { days: [], times: parseTimeRanges(group, "WATCH_RULES") };
  }
  return {
    days: parseDays(group.slice(0, at), "WATCH_RULES"),
    times: parseTimeRanges(group.slice(at + 1), "WATCH_RULES"),
  };
}

// WATCH_DATE_FROM / WATCH_DATE_TO: inclusive ISO `YYYY-MM-DD` bounds. Unset =
// unbounded on that side.
function parseWatchDate(env: Env, key: string): string | null {
  const raw = env[key]?.trim();
  if (!raw) {
    return null;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${key} must be YYYY-MM-DD, got: ${raw}`);
  }
  return raw;
}

// Parse a WATCH_RULES-format string (`;`-separated `DAYS@TIMES` groups).
function parseRulesString(raw: string): WatchRule[] {
  const rules: WatchRule[] = [];
  for (const group of raw.split(";").map((part) => part.trim())) {
    if (group.length > 0) {
      rules.push(parseRuleGroup(group));
    }
  }
  return rules;
}

// Build the OR-ed rule list. When the user sets any of WATCH_RULES /
// WATCH_TIMES / WATCH_DAYS, the rules come entirely from the environment (a
// legacy WATCH_TIMES/WATCH_DAYS pair contributes one rule, ORed with the
// WATCH_RULES groups). When none are set, fall back to the built-in defaults so
// the app works out of the box.
function loadWatchRules(env: Env): WatchRule[] {
  const legacyTimes = env.WATCH_TIMES?.trim();
  const legacyDays = env.WATCH_DAYS?.trim();
  const rawRules = env.WATCH_RULES?.trim();

  if (!legacyTimes && !legacyDays && !rawRules) {
    return parseRulesString(DEFAULT_WATCH_RULES);
  }

  const rules: WatchRule[] = [];
  if (legacyTimes || legacyDays) {
    rules.push({
      days: legacyDays ? parseDays(legacyDays, "WATCH_DAYS") : [],
      times: legacyTimes ? parseTimeRanges(legacyTimes, "WATCH_TIMES") : [],
    });
  }
  if (rawRules) {
    rules.push(...parseRulesString(rawRules));
  }
  return rules;
}

function loadWatchFilter(env: Env): WatchFilter {
  // Each date bound falls back to its built-in default; an env var overrides it.
  const dateFrom =
    parseWatchDate(env, "WATCH_DATE_FROM") ?? DEFAULT_WATCH_DATE_FROM;
  const dateTo = parseWatchDate(env, "WATCH_DATE_TO") ?? DEFAULT_WATCH_DATE_TO;
  if (dateFrom !== null && dateTo !== null && dateTo < dateFrom) {
    throw new Error(
      `WATCH_DATE_TO (${dateTo}) is before WATCH_DATE_FROM (${dateFrom})`,
    );
  }
  return {
    rules: loadWatchRules(env),
    dateFrom,
    dateTo,
  };
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
    watch: loadWatchFilter(env),
  };
}
