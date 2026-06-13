import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterShowtimes,
  isUnfiltered,
  matchesFilter,
  parseShowtimes,
} from "../src/showtimes.js";
import type { WatchFilter } from "../src/types.js";

const BASE_URL =
  "https://whatson.bfi.org.uk/imax/Online/default.asp?BOparam=odyssey";

function fixture(name: string): string {
  return readFileSync(resolve(import.meta.dirname, "fixtures", name), "utf8");
}

const NO_FILTER: WatchFilter = {
  rules: [],
  dateFrom: null,
  dateTo: null,
};

describe("parseShowtimes", () => {
  const showtimes = parseShowtimes(fixture("showtimes.html"), BASE_URL);

  it("parses every performance row", () => {
    expect(showtimes.map((s) => s.key)).toEqual([
      "2026-07-17T11:30",
      "2026-07-17T20:15",
      "2026-07-18T19:30",
      "2026-07-19T20:30",
    ]);
  });

  it("classifies availability from the last-column marker", () => {
    expect(showtimes.map((s) => s.availability)).toEqual([
      "bookable",
      "bookable",
      "sold_out",
      "bookable",
    ]);
  });

  it("resolves booking links to absolute URLs", () => {
    expect(showtimes[0].bookingUrl).toBe(
      "https://whatson.bfi.org.uk/imax/Online/seatSelect.asp?perf=1",
    );
    expect(showtimes[2].bookingUrl).toBeNull();
  });

  it("derives weekday and minutes", () => {
    expect(showtimes[0].weekday).toBe(5); // Friday.
    expect(showtimes[0].minutes).toBe(11 * 60 + 30);
    expect(showtimes[3].weekday).toBe(0); // Sunday.
  });

  it("returns no showtimes for a listing without performance rows", () => {
    expect(parseShowtimes(fixture("coming_soon.html"), BASE_URL)).toEqual([]);
  });

  it("parses the bookable mandalorian fixture", () => {
    const parsed = parseShowtimes(fixture("bookable.html"), BASE_URL);
    expect(parsed).toHaveLength(2);
    expect(parsed.every((s) => s.availability === "bookable")).toBe(true);
  });

  it("treats presale next-on-sale rows as coming_soon, not bookable", () => {
    const parsed = parseShowtimes(fixture("presale.html"), BASE_URL);
    expect(parsed.map((s) => s.availability)).toEqual([
      "sold_out",
      "coming_soon",
      "coming_soon",
    ]);
    // A next-on-sale link must never be treated as a booking affordance.
    expect(parsed.some((s) => s.availability === "bookable")).toBe(false);
    expect(parsed[1].bookingUrl).toBeNull();
  });
});

describe("matchesFilter", () => {
  const showtimes = parseShowtimes(fixture("showtimes.html"), BASE_URL);
  const friMorning = showtimes[0]; // Fri 11:30.
  const friEvening = showtimes[1]; // Fri 20:15.
  const sunEvening = showtimes[3]; // Sun 20:30.

  it("matches everything when unfiltered", () => {
    expect(showtimes.every((s) => matchesFilter(s, NO_FILTER))).toBe(true);
  });

  it("filters by time-of-day range", () => {
    const filter: WatchFilter = {
      ...NO_FILTER,
      rules: [{ days: [], times: [{ startMin: 18 * 60, endMin: 22 * 60 }] }],
    };
    expect(matchesFilter(friMorning, filter)).toBe(false);
    expect(matchesFilter(friEvening, filter)).toBe(true);
  });

  it("filters by weekday", () => {
    const filter: WatchFilter = {
      ...NO_FILTER,
      rules: [{ days: [6, 0], times: [] }], // Sat + Sun.
    };
    expect(matchesFilter(friEvening, filter)).toBe(false);
    expect(matchesFilter(sunEvening, filter)).toBe(true);
  });

  it("filters by inclusive date range", () => {
    const filter: WatchFilter = {
      ...NO_FILTER,
      dateFrom: "2026-07-18",
      dateTo: "2026-07-19",
    };
    expect(matchesFilter(friEvening, filter)).toBe(false);
    expect(matchesFilter(sunEvening, filter)).toBe(true);
  });

  it("ANDs days and times within a rule, and the date window", () => {
    const filter: WatchFilter = {
      rules: [{ days: [0], times: [{ startMin: 19 * 60, endMin: 23 * 60 }] }],
      dateFrom: "2026-07-01",
      dateTo: "2026-07-31",
    };
    const matched = filterShowtimes(showtimes, filter);
    expect(matched.map((s) => s.key)).toEqual(["2026-07-19T20:30"]);
  });

  it("ORs multiple rules: weekends any time OR weekdays evening only", () => {
    const filter: WatchFilter = {
      ...NO_FILTER,
      rules: [
        { days: [6, 0], times: [] }, // Sat/Sun: any time.
        {
          days: [1, 2, 3, 4, 5],
          times: [{ startMin: 18 * 60, endMin: 24 * 60 }],
        },
      ],
    };
    // Fri morning excluded (weekday, before 18:00); Fri evening included.
    expect(matchesFilter(friMorning, filter)).toBe(false);
    expect(matchesFilter(friEvening, filter)).toBe(true);
    // Sun evening included via the weekend rule (any time).
    expect(matchesFilter(sunEvening, filter)).toBe(true);
  });
});

describe("isUnfiltered", () => {
  it("is true for an empty filter", () => {
    expect(isUnfiltered(NO_FILTER)).toBe(true);
  });

  it("is false once a rule is set", () => {
    expect(
      isUnfiltered({ ...NO_FILTER, rules: [{ days: [1], times: [] }] }),
    ).toBe(false);
  });
});
