/**
 * Business calendar dates.
 *
 * A BusinessDate is a "YYYY-MM-DD" string — a calendar day with no time and
 * no timezone. All schedule / payment / disbursement dates use it. Only when
 * we need "what day is it right now?" do we consult the business timezone
 * (default Asia/Kolkata), never the browser's or the server's local zone.
 *
 * Postgres DATE columns come back from Prisma as a JS Date at 00:00 UTC; use
 * fromDbDate / toDbDate at the boundary.
 */

export type BusinessDate = string & { readonly __brand: "BusinessDate" };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function businessDate(value: string): BusinessDate {
  const m = ISO_DATE.exec(value);
  if (!m) throw new RangeError(`Invalid date "${value}", expected YYYY-MM-DD`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const dt = new Date(Date.UTC(y, mo - 1, d));
  // Rejects 2026-02-30, 2027-02-29, 2026-13-01, ...
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    throw new RangeError(`Invalid calendar date "${value}"`);
  }
  return value as BusinessDate;
}

export function isBusinessDate(value: string): value is BusinessDate {
  try {
    businessDate(value);
    return true;
  } catch {
    return false;
  }
}

function toUtcMs(d: BusinessDate): number {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
}

function fromUtcMs(ms: number): BusinessDate {
  return new Date(ms).toISOString().slice(0, 10) as BusinessDate;
}

const DAY_MS = 86_400_000;

export function addDays(d: BusinessDate, days: number): BusinessDate {
  if (!Number.isInteger(days)) throw new RangeError("days must be an integer");
  return fromUtcMs(toUtcMs(d) + days * DAY_MS);
}

/** Whole days from `from` to `to` (positive if `to` is later). */
export function diffDays(to: BusinessDate, from: BusinessDate): number {
  return Math.round((toUtcMs(to) - toUtcMs(from)) / DAY_MS);
}

/** ISO strings compare correctly as plain strings. */
export function compareDates(a: BusinessDate, b: BusinessDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function fromDbDate(d: Date): BusinessDate {
  return d.toISOString().slice(0, 10) as BusinessDate;
}

export function toDbDate(d: BusinessDate): Date {
  return new Date(toUtcMs(d));
}

// ─────────────────────── timezone-aware "now" ───────────────────────

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function wallClockFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatterCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock date and "HH:mm" in the business timezone at instant `now`. */
export function wallClock(now: Date, timeZone: string): { date: BusinessDate; time: string } {
  const parts = Object.fromEntries(
    wallClockFormatter(timeZone)
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}` as BusinessDate,
    time: `${parts.hour}:${parts.minute}`,
  };
}

export function todayIn(timeZone: string, now: Date = new Date()): BusinessDate {
  return wallClock(now, timeZone).date;
}

export interface BusinessClock {
  timeZone: string;
  /** "HH:mm" local time at which a collection day closes, e.g. "23:59". */
  cutoff: string;
}

/**
 * The most recent business date whose collection window has closed.
 * Before today's cutoff that is yesterday; at/after the cutoff it is today.
 * Comparing zero-padded "HH:mm" strings is exact and DST-proof because both
 * sides are wall-clock times in the same zone.
 */
export function closedThrough(now: Date, clock: BusinessClock): BusinessDate {
  const { date, time } = wallClock(now, clock.timeZone);
  return time >= clock.cutoff ? date : addDays(date, -1);
}

export function isDayClosed(day: BusinessDate, now: Date, clock: BusinessClock): boolean {
  return day <= closedThrough(now, clock);
}
