import { describe, expect, it } from "vitest";
import { decideAction, evaluateErrorCounter } from "../src/decide.js";

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
