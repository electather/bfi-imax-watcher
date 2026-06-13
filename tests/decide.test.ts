import { describe, expect, it } from "vitest";
import {
  decideAction,
  decideShowtimeAlerts,
  evaluateErrorCounter,
} from "../src/decide.js";
import type { Showtime } from "../src/types.js";

function showtime(key: string): Showtime {
  const [isoDate, time] = key.split("T");
  const [hour, minute] = time.split(":").map(Number);
  return {
    raw: key,
    key,
    isoDate,
    weekday: 0,
    minutes: hour * 60 + minute,
    time,
    availability: "bookable",
    bookingUrl: `https://example.test/${key}`,
  };
}

describe("decideAction (TEST-006)", () => {
  it("alerts on coming_soon -> bookable", () => {
    expect(decideAction("coming_soon", "bookable")).toBe("alert");
  });

  it("does not alert on bookable -> bookable", () => {
    expect(decideAction("bookable", "bookable")).toBe("noop");
  });

  it("re-arms on bookable -> coming_soon", () => {
    expect(decideAction("bookable", "coming_soon")).toBe("rearm");
  });

  it("re-arms on bookable -> sold_out", () => {
    expect(decideAction("bookable", "sold_out")).toBe("rearm");
  });

  it("alerts on sold_out -> bookable", () => {
    expect(decideAction("sold_out", "bookable")).toBe("alert");
  });

  it("does not alert on first-ever sold_out (null prev)", () => {
    expect(decideAction(null, "sold_out")).toBe("noop");
  });

  it("does not alert on bookable -> unknown", () => {
    expect(decideAction("bookable", "unknown")).toBe("noop");
  });

  it("alerts on unknown -> bookable (duplicate accepted, REQ-007)", () => {
    expect(decideAction("unknown", "bookable")).toBe("alert");
  });

  it("alerts on first-ever bookable (null prev)", () => {
    expect(decideAction(null, "bookable")).toBe("alert");
  });

  it("does nothing on first-ever coming_soon (null prev)", () => {
    expect(decideAction(null, "coming_soon")).toBe("noop");
  });
});

describe("decideShowtimeAlerts", () => {
  it("alerts every newly bookable showtime on first sight", () => {
    const { toAlert, nextAlerted } = decideShowtimeAlerts(new Set(), [
      showtime("2026-07-17T11:30"),
      showtime("2026-07-17T20:15"),
    ]);
    expect(toAlert.map((s) => s.key)).toEqual([
      "2026-07-17T11:30",
      "2026-07-17T20:15",
    ]);
    expect(nextAlerted).toEqual(
      new Set(["2026-07-17T11:30", "2026-07-17T20:15"]),
    );
  });

  it("does not re-alert a showtime already alerted", () => {
    const prev = new Set(["2026-07-17T11:30"]);
    const { toAlert } = decideShowtimeAlerts(prev, [
      showtime("2026-07-17T11:30"),
      showtime("2026-07-17T20:15"),
    ]);
    expect(toAlert.map((s) => s.key)).toEqual(["2026-07-17T20:15"]);
  });

  it("re-arms a showtime that dropped out and came back", () => {
    const prev = new Set(["2026-07-17T11:30"]);
    // Showtime sells out: no longer in the bookable set, so it is dropped.
    const dropped = decideShowtimeAlerts(prev, []);
    expect(dropped.nextAlerted).toEqual(new Set());
    // It reopens later: alerts again because it is no longer tracked.
    const reopened = decideShowtimeAlerts(dropped.nextAlerted, [
      showtime("2026-07-17T11:30"),
    ]);
    expect(reopened.toAlert.map((s) => s.key)).toEqual(["2026-07-17T11:30"]);
  });

  it("emits nothing when there are no bookable matches", () => {
    const { toAlert, nextAlerted } = decideShowtimeAlerts(
      new Set(["2026-07-17T11:30"]),
      [],
    );
    expect(toAlert).toEqual([]);
    expect(nextAlerted).toEqual(new Set());
  });
});

describe("evaluateErrorCounter (TEST-007)", () => {
  const threshold = 5;

  it("fires exactly once at the Nth consecutive unknown, then resets", () => {
    let consecutive = 0;
    const fires: boolean[] = [];
    for (let i = 0; i < threshold; i++) {
      const result = evaluateErrorCounter(consecutive, "unknown", threshold);
      consecutive = result.consecutive;
      fires.push(result.fireError);
    }
    expect(fires).toEqual([false, false, false, false, true]);
    expect(consecutive).toBe(0);
  });

  it("resets the counter on any non-unknown status", () => {
    const afterUnknowns = evaluateErrorCounter(3, "unknown", threshold);
    expect(afterUnknowns.consecutive).toBe(4);

    const reset = evaluateErrorCounter(4, "coming_soon", threshold);
    expect(reset.consecutive).toBe(0);
    expect(reset.fireError).toBe(false);
  });

  it("re-alerts after another full run of failures", () => {
    let consecutive = 0;
    let fireCount = 0;
    for (let i = 0; i < threshold * 2; i++) {
      const result = evaluateErrorCounter(consecutive, "unknown", threshold);
      consecutive = result.consecutive;
      if (result.fireError) fireCount++;
    }
    expect(fireCount).toBe(2);
  });
});
