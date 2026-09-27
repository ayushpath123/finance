import type { BusinessDate } from "@/lib/finance/dates";

const BUSINESS_TZ = "Asia/Kolkata";

const dateTime = new Intl.DateTimeFormat("en-IN", { timeZone: BUSINESS_TZ, dateStyle: "medium", timeStyle: "short" });
const dateOnly = new Intl.DateTimeFormat("en-IN", { timeZone: BUSINESS_TZ, dateStyle: "medium" });
const timeOnly = new Intl.DateTimeFormat("en-IN", { timeZone: BUSINESS_TZ, hour: "numeric", minute: "2-digit" });

/** Instants are always shown in business time (IST), never the browser's zone. */
export function formatDateTimeIST(d: Date | null | undefined): string {
  return d ? dateTime.format(d) : "—";
}
export function formatDateIST(d: Date | null | undefined): string {
  return d ? dateOnly.format(d) : "—";
}
export function formatTimeIST(d: Date): string {
  return timeOnly.format(d);
}

// Business dates are calendar days — format them in UTC so no zone can shift the day.
const bdLong = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short", year: "numeric" });
const bdShort = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", day: "numeric", month: "short" });
const bdFull = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long", year: "numeric" });
const bdMonth = new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", month: "long", year: "numeric" });

const toUtc = (d: BusinessDate | string) => new Date(`${d}T00:00:00Z`);

/** "29 Sept 2026" */
export const formatDay = (d: BusinessDate | string) => bdLong.format(toUtc(d)).replace("Sept", "Sep");
/** "29 Sep" */
export const formatDayShort = (d: BusinessDate | string) => bdShort.format(toUtc(d)).replace("Sept", "Sep");
/** "Tuesday, 29 September 2026" */
export const formatDayFull = (d: BusinessDate | string) => bdFull.format(toUtc(d));
/** "September 2026" for a "YYYY-MM" key */
export const formatMonth = (ym: string) => bdMonth.format(toUtc(`${ym}-01`));

/** "Today", "Tomorrow", "Yesterday" or the short date. */
export function relativeDay(d: BusinessDate, today: BusinessDate): string {
  const diff = Math.round((toUtc(d).getTime() - toUtc(today).getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return formatDayShort(d);
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: "Cash",
  UPI: "UPI",
  BANK_TRANSFER: "Bank transfer",
  OTHER: "Other",
};
