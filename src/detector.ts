import type { DetectorConfig, Status } from "./types.js";

/** Default detector keywords/patterns; overridable via env (see config.ts). */
export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  bookableKeywords: [
    "buy tickets",
    "book tickets",
    "select your seats",
    "add to basket",
    "on sale now",
    "tickets available",
  ],
  comingSoonKeywords: [
    "coming soon",
    "on sale soon",
    "tickets on sale soon",
    "not yet on sale",
    "sale date to be confirmed",
    "go on sale",
  ],
  bookingLinkPatterns: [
    "mapselect\\.asp",
    "addtocart",
    "::performance",
    "selectseats",
  ],
};

// Markers of the Cloudflare interstitial; if present the page never rendered,
// so the result is "unknown" regardless of any incidental keyword matches.
const CHALLENGE_MARKERS = [
  "just a moment",
  "cf-mitigated",
  "challenges.cloudflare.com",
  "enable javascript and cookies to continue",
];

/**
 * Classify rendered page HTML as bookable, coming_soon, or unknown.
 *
 * Pure function: no I/O, no side effects. A real booking affordance (a booking
 * link pattern or a bookable keyword) wins over coming-soon text, because once
 * tickets open the site may leave stale "coming soon" copy in place. If neither
 * signal is present — including the Cloudflare interstitial or garbage — the
 * status is "unknown" and is never treated as alert-worthy by the caller.
 */
export function detect(html: string, config: DetectorConfig): Status {
  const lower = html.toLowerCase();

  if (CHALLENGE_MARKERS.some((marker) => lower.includes(marker))) {
    return "unknown";
  }

  const hasBooking =
    config.bookableKeywords.some((keyword) =>
      lower.includes(keyword.toLowerCase()),
    ) ||
    config.bookingLinkPatterns.some((pattern) =>
      new RegExp(pattern, "i").test(html),
    );
  if (hasBooking) {
    return "bookable";
  }

  const hasComingSoon = config.comingSoonKeywords.some((keyword) =>
    lower.includes(keyword.toLowerCase()),
  );
  if (hasComingSoon) {
    return "coming_soon";
  }

  return "unknown";
}
