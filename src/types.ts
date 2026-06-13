/** Detection result for a single fetched page. */
export type Status = "bookable" | "sold_out" | "coming_soon" | "unknown";

/** Decision about what the loop should do given a status transition. */
export type Decision = "alert" | "rearm" | "noop";

/** Availability of a single parsed showtime row. */
export type Availability = "bookable" | "sold_out" | "coming_soon" | "unknown";

/**
 * A single performance row parsed from the listing. `key` uniquely identifies
 * the showtime (`YYYY-MM-DDTHH:mm`) and is what the state file tracks so we can
 * alert once per distinct showtime and re-arm if it later drops out.
 */
export interface Showtime {
  /** Original listing text, e.g. "Thursday 28 May 2026 11:30". */
  readonly raw: string;
  /** Stable identity, e.g. "2026-05-28T11:30". */
  readonly key: string;
  /** ISO calendar date, e.g. "2026-05-28". */
  readonly isoDate: string;
  /** Day of week, 0 = Sunday .. 6 = Saturday. */
  readonly weekday: number;
  /** Minutes since midnight, e.g. 11:30 -> 690. */
  readonly minutes: number;
  /** Clock time, e.g. "11:30". */
  readonly time: string;
  readonly availability: Availability;
  /** Absolute booking URL when bookable, else null. */
  readonly bookingUrl: string | null;
}

/** A half-open-free inclusive minute range within a single day. */
export interface TimeRange {
  /** Minutes since midnight, inclusive. */
  readonly startMin: number;
  /** Minutes since midnight, inclusive. */
  readonly endMin: number;
}

/**
 * A single watch rule: a day-set ANDed with a time-of-day set. An empty
 * dimension within the rule matches anything (e.g. no days = every day). The
 * entries within each dimension are ORed.
 */
export interface WatchRule {
  /** Allowed weekdays (0 = Sunday .. 6 = Saturday); empty = any day. */
  readonly days: readonly number[];
  /** Allowed time-of-day ranges; empty = any time. */
  readonly times: readonly TimeRange[];
}

/**
 * The showtimes the user actually cares about. A showtime is watched when it
 * falls inside the global date window AND matches at least one rule (rules are
 * ORed, so e.g. "weekends any prime time" OR "weekdays after 6pm" coexist). An
 * empty `rules` list means every showtime in the date window is watched.
 */
export interface WatchFilter {
  /** OR-ed rules; empty = match any day/time. */
  readonly rules: readonly WatchRule[];
  /** Inclusive earliest ISO date, or null for unbounded. */
  readonly dateFrom: string | null;
  /** Inclusive latest ISO date, or null for unbounded. */
  readonly dateTo: string | null;
}

/**
 * Keyword/pattern configuration for the pure detector. Kept separate from the
 * runtime config so the detector can be unit-tested in isolation and so the
 * keywords can be tuned against real captured HTML without code changes.
 */
export interface DetectorConfig {
  /** Substrings (case-insensitive) that positively indicate tickets are bookable. */
  readonly bookableKeywords: readonly string[];
  /** Substrings (case-insensitive) that indicate the film is not yet on sale. */
  readonly comingSoonKeywords: readonly string[];
  /** Substrings (case-insensitive) that indicate every listed showtime is sold out. */
  readonly soldOutKeywords: readonly string[];
  /** Regex source strings (case-insensitive) matching booking links/affordances. */
  readonly bookingLinkPatterns: readonly string[];
}

/** Fully resolved, validated runtime configuration. */
export interface Config {
  readonly telegramBotToken: string;
  readonly telegramChatId: string;
  readonly targetUrl: string;
  readonly checkIntervalSeconds: number;
  readonly headless: boolean;
  readonly errorAlertAfter: number;
  readonly stateFile: string;
  readonly detector: DetectorConfig;
  readonly watch: WatchFilter;
}
