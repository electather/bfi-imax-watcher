import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

const CREDS = {
  TELEGRAM_BOT_TOKEN: "token",
  TELEGRAM_CHAT_ID: "chat",
};

describe("loadConfig watch filter", () => {
  it("falls back to built-in defaults when no watch env vars are set", () => {
    const { watch } = loadConfig(CREDS);
    // Weekends prime times OR weekday evenings, across the run window.
    expect(watch.rules).toEqual([
      {
        days: [6, 0],
        times: [
          { startMin: 12 * 60, endMin: 13 * 60 },
          { startMin: 16 * 60, endMin: 17 * 60 },
          { startMin: 19 * 60 + 30, endMin: 21 * 60 },
        ],
      },
      {
        days: [1, 2, 3, 4, 5],
        times: [{ startMin: 18 * 60, endMin: 23 * 60 + 59 }],
      },
    ]);
    expect(watch.dateFrom).toBe("2026-07-17");
    expect(watch.dateTo).toBe("2026-08-13");
  });

  it("lets env vars override the default rules entirely", () => {
    const { watch } = loadConfig({ ...CREDS, WATCH_DAYS: "wed" });
    expect(watch.rules).toEqual([{ days: [3], times: [] }]);
  });

  it("overrides only the supplied date bound, keeping the other default", () => {
    const { watch } = loadConfig({ ...CREDS, WATCH_DATE_TO: "2026-07-31" });
    expect(watch.dateFrom).toBe("2026-07-17"); // default retained.
    expect(watch.dateTo).toBe("2026-07-31"); // overridden.
  });

  it("builds one rule from legacy WATCH_TIMES + WATCH_DAYS", () => {
    const { watch } = loadConfig({
      ...CREDS,
      WATCH_TIMES: "12:00,19:30-21:00",
      WATCH_DAYS: "sat,sun",
    });
    expect(watch.rules).toEqual([
      {
        days: [6, 0],
        times: [
          { startMin: 720, endMin: 720 },
          { startMin: 19 * 60 + 30, endMin: 21 * 60 },
        ],
      },
    ]);
  });

  it("parses WATCH_RULES groups (days@times) ORed together", () => {
    const { watch } = loadConfig({
      ...CREDS,
      WATCH_RULES: "sat,sun@12:00-13:00,19:30-21:00 ; mon-fri@18:00-23:59",
    });
    expect(watch.rules).toEqual([
      {
        days: [6, 0],
        times: [
          { startMin: 12 * 60, endMin: 13 * 60 },
          { startMin: 19 * 60 + 30, endMin: 21 * 60 },
        ],
      },
      {
        days: [1, 2, 3, 4, 5],
        times: [{ startMin: 18 * 60, endMin: 23 * 60 + 59 }],
      },
    ]);
  });

  it("expands wrapping day ranges (fri-mon)", () => {
    const { watch } = loadConfig({ ...CREDS, WATCH_DAYS: "fri-mon" });
    // Fri, Sat, Sun, Mon.
    expect(watch.rules[0]?.days).toEqual([5, 6, 0, 1]);
  });

  it("combines a legacy rule with WATCH_RULES groups", () => {
    const { watch } = loadConfig({
      ...CREDS,
      WATCH_DAYS: "wed",
      WATCH_RULES: "fri@20:00-22:00",
    });
    expect(watch.rules).toHaveLength(2);
    expect(watch.rules[0]?.days).toEqual([3]);
    expect(watch.rules[1]?.days).toEqual([5]);
  });

  it("rejects an unknown weekday", () => {
    expect(() => loadConfig({ ...CREDS, WATCH_DAYS: "funday" })).toThrow(
      /unknown weekday/i,
    );
  });

  it("rejects a backwards date window", () => {
    expect(() =>
      loadConfig({
        ...CREDS,
        WATCH_DATE_FROM: "2026-08-13",
        WATCH_DATE_TO: "2026-07-17",
      }),
    ).toThrow(/before/i);
  });
});
