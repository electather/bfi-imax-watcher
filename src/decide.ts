import type { Decision, Showtime, Status } from "./types.js";

/**
 * Decide what to do given the previously persisted status and the current one.
 * Pure function — see TEST-006.
 *
 * - "alert": entering bookable from any non-bookable state (including null/first
 *   run and "unknown"; the rare bookable -> unknown -> bookable duplicate is
 *   accepted per REQ-007).
 * - "rearm": leaving bookable back to coming_soon or sold_out, re-arming the
 *   alert for the next time tickets open up.
 * - "noop": everything else, including any transition into "unknown" (REQ-006).
 */
export function decideAction(prev: Status | null, current: Status): Decision {
  if (current === "bookable") {
    return prev === "bookable" ? "noop" : "alert";
  }
  if (
    (current === "coming_soon" || current === "sold_out") &&
    prev === "bookable"
  ) {
    return "rearm";
  }
  return "noop";
}

export interface ShowtimeAlertDecision {
  /** Watched showtimes that just became bookable and should be alerted now. */
  readonly toAlert: Showtime[];
  /** Keys to persist as the new "already alerted while bookable" set. */
  readonly nextAlerted: Set<string>;
}

/**
 * Decide which watched showtimes to alert on this cycle. Pure function.
 *
 * `bookableMatches` is the set of currently-bookable showtimes the user is
 * watching. We alert for any whose key was not already in `prevAlerted` (so
 * each distinct showtime alerts once), and carry forward exactly the current
 * bookable keys. A showtime dropping out of `bookableMatches` (sold out again,
 * or pulled from the listing) is thereby removed from the set and will re-alert
 * if it later reopens — mirroring the page-level re-arm behaviour.
 */
export function decideShowtimeAlerts(
  prevAlerted: ReadonlySet<string>,
  bookableMatches: readonly Showtime[],
): ShowtimeAlertDecision {
  const toAlert = bookableMatches.filter(
    (showtime) => !prevAlerted.has(showtime.key),
  );
  const nextAlerted = new Set(bookableMatches.map((showtime) => showtime.key));
  return { toAlert, nextAlerted };
}

export interface ErrorCounterResult {
  /** Consecutive-unknown count to carry into the next cycle. */
  readonly consecutive: number;
  /** Whether an error alert should be sent this cycle. */
  readonly fireError: boolean;
}

/**
 * Advance the consecutive-"unknown" error counter. Pure function — see TEST-007.
 *
 * A non-unknown status resets the counter. The Nth consecutive unknown (where N
 * is the threshold) fires exactly one error alert and resets the counter, so a
 * sustained outage re-alerts every N cycles rather than every cycle.
 */
export function evaluateErrorCounter(
  prevConsecutive: number,
  status: Status,
  threshold: number,
): ErrorCounterResult {
  if (status !== "unknown") {
    return { consecutive: 0, fireError: false };
  }
  const consecutive = prevConsecutive + 1;
  if (consecutive >= threshold) {
    return { consecutive: 0, fireError: true };
  }
  return { consecutive, fireError: false };
}
