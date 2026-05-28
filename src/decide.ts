import type { Decision, Status } from "./types.js";

/**
 * Decide what to do given the previously persisted status and the current one.
 * Pure function — see TEST-006.
 *
 * - "alert": entering bookable from any non-bookable state (including null/first
 *   run and "unknown"; the rare bookable -> unknown -> bookable duplicate is
 *   accepted per REQ-007).
 * - "rearm": leaving bookable back to coming_soon, re-arming the alert.
 * - "noop": everything else, including any transition into "unknown" (REQ-006).
 */
export function decideAction(prev: Status | null, current: Status): Decision {
  if (current === "bookable") {
    return prev === "bookable" ? "noop" : "alert";
  }
  if (current === "coming_soon" && prev === "bookable") {
    return "rearm";
  }
  return "noop";
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
