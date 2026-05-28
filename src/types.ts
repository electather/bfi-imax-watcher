/** Detection result for a single fetched page. */
export type Status = "bookable" | "coming_soon" | "unknown";

/** Decision about what the loop should do given a status transition. */
export type Decision = "alert" | "rearm" | "noop";

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
}
