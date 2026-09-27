import { compareDates, type BusinessDate } from "./dates";
import type { Paise } from "./money";

/** Mirrors the Prisma ScheduleStatus enum (kept free of generated-client imports so it stays pure). */
export type ScheduleStatus = "PENDING" | "PAID" | "PARTIAL" | "MISSED" | "SETTLED_LATE" | "CANCELLED";

/**
 * UI-level status for the collection calendar. Adds views that are not stored facts:
 *   PREPAID — a future day already fully paid (BLUE)
 *   FUTURE  — a future day with nothing (or only part) paid yet (GRAY)
 *   TODAY_PENDING — today's obligation, not yet fully paid, day still open (NEUTRAL)
 */
export type ScheduleDisplayStatus = ScheduleStatus | "PREPAID" | "FUTURE" | "TODAY_PENDING";

export interface ScheduleFacts {
  scheduledDate: BusinessDate;
  expectedAmount: Paise;
  /** Σ active allocations now. */
  allocatedAmount: Paise;
  /** Portion covered by payments dated on/before the scheduled date. */
  coveredAtClose: Paise;
  cancelled: boolean;
}

export interface StatusContext {
  /** Business "today" in the configured timezone. */
  today: BusinessDate;
  /** Latest day whose cutoff has passed (see dates.closedThrough). */
  closedThrough: BusinessDate;
}

/**
 * Stored status of one schedule day. Pure function of facts + clock, so it
 * can always be recomputed and verified.
 *
 *   cancelled      → CANCELLED
 *   fully covered  → PAID if covered by money dated on/before the day, else SETTLED_LATE
 *   day closed     → MISSED (nothing) / PARTIAL (something)
 *   day open       → PARTIAL if it is today and something is paid, otherwise PENDING
 */
export function deriveScheduleStatus(f: ScheduleFacts, ctx: StatusContext): ScheduleStatus {
  if (f.cancelled) return "CANCELLED";
  const closed = compareDates(f.scheduledDate, ctx.closedThrough) <= 0;
  if (f.allocatedAmount >= f.expectedAmount) {
    return closed && f.coveredAtClose < f.expectedAmount ? "SETTLED_LATE" : "PAID";
  }
  if (closed) return f.allocatedAmount === 0 ? "MISSED" : "PARTIAL";
  if (compareDates(f.scheduledDate, ctx.today) <= 0 && f.allocatedAmount > 0) return "PARTIAL";
  return "PENDING";
}

export function toDisplayStatus(
  s: { scheduledDate: BusinessDate; status: ScheduleStatus },
  ctx: StatusContext,
): ScheduleDisplayStatus {
  const future = compareDates(s.scheduledDate, ctx.today) > 0;
  if (future && s.status !== "CANCELLED") return s.status === "PAID" ? "PREPAID" : "FUTURE";
  if (s.scheduledDate === ctx.today && s.status === "PENDING") return "TODAY_PENDING";
  return s.status;
}

/** Shortfall recorded when a day closes; null means the day closed fully covered (or isn't due). */
export function shortfallAtClose(f: ScheduleFacts, ctx: StatusContext): Paise | null {
  if (f.cancelled) return null;
  if (compareDates(f.scheduledDate, ctx.closedThrough) > 0) return null;
  const short = f.expectedAmount - f.coveredAtClose;
  return short > 0 ? (short as Paise) : null;
}

/**
 * Cancelling a contract on `cancelDate` cancels every FUTURE day that is not
 * already fully paid. Past days and today stay obligations (arrears remain owed);
 * fully prepaid future days stay PAID. Money sitting on a partly prepaid future
 * day is released by the next allocation run and becomes unallocated credit.
 */
export function schedulesToCancel<T extends { id: string; scheduledDate: BusinessDate; expectedAmount: Paise; allocatedAmount: Paise; cancelled?: boolean }>(
  schedules: readonly T[],
  cancelDate: BusinessDate,
): string[] {
  return schedules
    .filter((s) => !s.cancelled && compareDates(s.scheduledDate, cancelDate) > 0 && s.allocatedAmount < s.expectedAmount)
    .map((s) => s.id);
}
