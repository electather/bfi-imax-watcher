import type {
  Availability,
  Showtime,
  WatchFilter,
  WatchRule,
} from "./types.js";

// BFI's AudienceView listing renders one `<div class="odd|even result-box-item">`
// per performance. Inside each row: a `<span class="start-date">` carrying the
// human date/time, an `item-link ... last-column <availability>` wrapper whose
// trailing class is `excellent|good|limited` (bookable) or `soldout`, and, when
// bookable, a Buy `<a aria-label="Buy, ...">` linking to the seat-select page.
const ROW_RE =
  /class="(?:odd|even)\s+result-box-item"([\s\S]*?)(?=class="(?:odd|even)\s+result-box-item"|<\/form>|<\/main>|$)/gi;
const START_DATE_RE = /<span[^>]*class="start-date"[^>]*>([^<]+)<\/span>/i;
// `next-on-sale` is the presale marker BFI renders before general sale opens —
// the showtime exists but is not yet buyable, so it must not count as bookable.
const AVAILABILITY_RE =
  /last-column\s+(excellent|good|limited|soldout|next-on-sale)\b/i;
// Prefer the Buy anchor (carries aria-label); fall back to any seat/map link.
const BUY_LINK_RE = /<a\b[^>]*\bhref="([^"]+)"[^>]*aria-label="buy/i;
const ANY_BOOKING_LINK_RE =
  /<a\b[^>]*\bhref="([^"]*(?:seatselect|mapselect)\.asp[^"]*)"/i;

const MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

// 0 = Sunday .. 6 = Saturday, matching JS Date.getDay() / cron conventions.
const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

// "Thursday 28 May 2026 11:30" -> structured parts. Returns null on anything
// that does not match the expected listing shape so callers can skip the row.
function parseStartDate(text: string): {
  isoDate: string;
  weekday: number;
  minutes: number;
  time: string;
} | null {
  const match =
    /([A-Za-z]+)\s+(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})\s+(\d{1,2}):(\d{2})/.exec(
      text.trim(),
    );
  if (!match) {
    return null;
  }
  const [, weekdayName, dayStr, monthName, yearStr, hourStr, minuteStr] = match;
  if (
    !weekdayName ||
    !dayStr ||
    !monthName ||
    !yearStr ||
    !hourStr ||
    !minuteStr
  ) {
    return null;
  }
  const month = MONTHS[monthName.toLowerCase()];
  const weekday = WEEKDAYS[weekdayName.toLowerCase()];
  if (month === undefined || weekday === undefined) {
    return null;
  }
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (hour > 23 || minute > 59) {
    return null;
  }
  const isoDate = `${yearStr}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const time = `${String(hour).padStart(2, "0")}:${minuteStr}`;
  return { isoDate, weekday, minutes: hour * 60 + minute, time };
}

function classifyRow(block: string): {
  availability: Availability;
  bookingUrl: string | null;
} {
  const avail = AVAILABILITY_RE.exec(block)?.[1]?.toLowerCase();
  const href =
    BUY_LINK_RE.exec(block)?.[1] ??
    ANY_BOOKING_LINK_RE.exec(block)?.[1] ??
    null;

  if (avail === "soldout") {
    return { availability: "sold_out", bookingUrl: null };
  }
  if (avail === "next-on-sale") {
    return { availability: "coming_soon", bookingUrl: null };
  }
  if (
    avail === "excellent" ||
    avail === "good" ||
    avail === "limited" ||
    href
  ) {
    return { availability: "bookable", bookingUrl: href };
  }
  return { availability: "unknown", bookingUrl: null };
}

function absoluteUrl(href: string | null, baseUrl: string): string | null {
  if (!href) {
    return null;
  }
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

/**
 * Parse every performance row from listing HTML into structured showtimes.
 *
 * Pure function: no I/O. Booking links are resolved against `baseUrl` so the
 * notifier can hand the user a clickable absolute URL. Rows whose date fails to
 * parse are skipped rather than guessed at.
 */
export function parseShowtimes(html: string, baseUrl: string): Showtime[] {
  const showtimes: Showtime[] = [];
  for (const match of html.matchAll(ROW_RE)) {
    const block = match[1];
    if (!block) {
      continue;
    }
    const startDate = START_DATE_RE.exec(block)?.[1];
    if (!startDate) {
      continue;
    }
    const parsed = parseStartDate(startDate);
    if (!parsed) {
      continue;
    }
    const { availability, bookingUrl } = classifyRow(block);
    showtimes.push({
      raw: startDate.trim(),
      key: `${parsed.isoDate}T${parsed.time}`,
      isoDate: parsed.isoDate,
      weekday: parsed.weekday,
      minutes: parsed.minutes,
      time: parsed.time,
      availability,
      bookingUrl: absoluteUrl(bookingUrl, baseUrl),
    });
  }
  return showtimes;
}

/** True when `filter` places no constraints, i.e. every showtime is of interest. */
export function isUnfiltered(filter: WatchFilter): boolean {
  return (
    filter.rules.length === 0 &&
    filter.dateFrom === null &&
    filter.dateTo === null
  );
}

function matchesRule(showtime: Showtime, rule: WatchRule): boolean {
  if (rule.days.length > 0 && !rule.days.includes(showtime.weekday)) {
    return false;
  }
  if (
    rule.times.length > 0 &&
    !rule.times.some(
      (range) =>
        showtime.minutes >= range.startMin && showtime.minutes <= range.endMin,
    )
  ) {
    return false;
  }
  return true;
}

/**
 * Whether a showtime is watched: inside the date window AND matching at least
 * one rule (rules are ORed). An empty rule list matches any day/time.
 */
export function matchesFilter(
  showtime: Showtime,
  filter: WatchFilter,
): boolean {
  if (filter.dateFrom !== null && showtime.isoDate < filter.dateFrom) {
    return false;
  }
  if (filter.dateTo !== null && showtime.isoDate > filter.dateTo) {
    return false;
  }
  if (filter.rules.length === 0) {
    return true;
  }
  return filter.rules.some((rule) => matchesRule(showtime, rule));
}

/** Return only the showtimes the user is watching, preserving listing order. */
export function filterShowtimes(
  showtimes: readonly Showtime[],
  filter: WatchFilter,
): Showtime[] {
  return showtimes.filter((showtime) => matchesFilter(showtime, filter));
}
