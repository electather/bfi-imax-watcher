import type { DetectorConfig, Status } from "./types.js";

// Defaults match BFI's AudienceView markup. Per-showtime rows render
// `<div class="item-link ... last-column <availability>">`, where the trailing
// class is one of `excellent|good|limited` (Buy button rendered) or `soldout`
// (an `<span class="unavailable-message">Sold out!</span>` is rendered
// instead). The Buy button itself carries `aria-label="Buy, ..."`. We key off
// those structural markers because the page leaves stale prose in place across
// state transitions.
export const DEFAULT_DETECTOR_CONFIG: DetectorConfig = {
  bookableKeywords: [
    'aria-label="buy,',
    "buy tickets",
    "book tickets",
    "select your seats",
    "add to basket",
  ],
  comingSoonKeywords: [
    "coming soon",
    "on sale soon",
    "tickets on sale soon",
    "not yet on sale",
    "sale date to be confirmed",
    "go on sale",
    "last-column next-on-sale",
  ],
  soldOutKeywords: [
    'class="unavailable-message">sold out',
    "last-column soldout",
  ],
  bookingLinkPatterns: [
    "last-column\\s+(?:excellent|good|limited)\\b",
    "mapselect\\.asp",
    "addtocart",
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
 * Classify rendered page HTML as bookable, sold_out, coming_soon, or unknown.
 *
 * Pure function: no I/O, no side effects. Precedence is intentional: a real
 * booking affordance wins over everything else, because once any showtime
 * opens up the page may still carry stale "sold out" or "coming soon" copy
 * elsewhere. Sold-out detection runs before coming-soon so a film that is on
 * sale but currently has every listed date sold reports `sold_out` rather
 * than getting confused with a not-yet-on-sale page. If none of the markers
 * match — including the Cloudflare interstitial or garbage — the status is
 * "unknown" and is never treated as alert-worthy by the caller.
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

  const hasSoldOut = config.soldOutKeywords.some((keyword) =>
    lower.includes(keyword.toLowerCase()),
  );
  if (hasSoldOut) {
    return "sold_out";
  }

  const hasComingSoon = config.comingSoonKeywords.some((keyword) =>
    lower.includes(keyword.toLowerCase()),
  );
  if (hasComingSoon) {
    return "coming_soon";
  }

  return "unknown";
}
