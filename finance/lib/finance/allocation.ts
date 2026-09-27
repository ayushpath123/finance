/**
 * Payment allocation engine — pure, deterministic, no I/O.
 *
 * Policy OLDEST_FIRST:
 *   Active payments, ordered by (paymentDate, recordedAt, id), are poured into
 *   the contract's due schedule days in date order. Each day absorbs at most
 *   its expected amount. This naturally yields:
 *     1. oldest outstanding first,
 *     2. then the current day,
 *     3. then future days (advance),
 *     4. anything left after the last day is unallocated contract credit.
 *
 * The engine always computes the complete TARGET allocation set from scratch,
 * then diffs it against the currently active allocation rows. For the common
 * case (a new payment that is the latest in order) the diff is exactly "insert
 * the new payment's rows" — earlier rows are untouched. For reversals and
 * back-dated payments the diff voids and re-creates only what changed. The
 * resulting state is identical no matter what order events arrived in.
 */

import { compareDates, type BusinessDate } from "./dates";
import { paise, sub, type Paise } from "./money";

export interface AllocatableSchedule {
  id: string;
  sequence: number;
  scheduledDate: BusinessDate;
  expectedAmount: Paise;
  /** Cancelled days (future unpaid days of a cancelled contract) are not obligations and absorb nothing. */
  cancelled?: boolean;
}

export interface AllocatablePayment {
  id: string;
  amount: Paise;
  paymentDate: BusinessDate;
  /** ISO timestamp; tie-breaker for payments on the same date. */
  recordedAt: string;
}

export interface AllocationLine {
  paymentId: string;
  scheduleId: string;
  amount: Paise;
}

export interface ExistingAllocation extends AllocationLine {
  id: string;
}

export interface AllocationResult {
  allocations: AllocationLine[];
  /** Per-schedule allocated total (every schedule id present, 0 if none). */
  allocatedBySchedule: Map<string, Paise>;
  /** Per-payment amount left over after every due day is covered (credit). */
  unallocatedByPayment: Map<string, Paise>;
}

export function comparePayments(a: AllocatablePayment, b: AllocatablePayment): number {
  return (
    compareDates(a.paymentDate, b.paymentDate) ||
    (a.recordedAt < b.recordedAt ? -1 : a.recordedAt > b.recordedAt ? 1 : 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function compareSchedules(a: AllocatableSchedule, b: AllocatableSchedule): number {
  return compareDates(a.scheduledDate, b.scheduledDate) || a.sequence - b.sequence;
}

export function allocateOldestFirst(
  schedules: readonly AllocatableSchedule[],
  payments: readonly AllocatablePayment[],
): AllocationResult {
  const allocatedBySchedule = new Map<string, Paise>(schedules.map((s) => [s.id, 0 as Paise]));
  const remainingByPayment = new Map<string, number>(payments.map((p) => [p.id, p.amount]));
  const allocations: AllocationLine[] = [];

  const due = schedules.filter((s) => !s.cancelled).sort(compareSchedules);
  const ordered = [...payments].sort(comparePayments);

  let si = 0;
  for (const payment of ordered) {
    let left = remainingByPayment.get(payment.id) ?? 0;
    while (left > 0 && si < due.length) {
      const schedule = due[si];
      const room = schedule.expectedAmount - (allocatedBySchedule.get(schedule.id) ?? 0);
      if (room <= 0) {
        si++;
        continue;
      }
      const take = Math.min(room, left);
      allocations.push({ paymentId: payment.id, scheduleId: schedule.id, amount: paise(take) });
      allocatedBySchedule.set(schedule.id, paise((allocatedBySchedule.get(schedule.id) ?? 0) + take));
      left -= take;
      if (take === room) si++;
    }
    remainingByPayment.set(payment.id, left);
  }

  return {
    allocations,
    allocatedBySchedule,
    unallocatedByPayment: new Map([...remainingByPayment].map(([id, v]) => [id, paise(v)])),
  };
}

/**
 * Minimal set of changes turning `active` rows into `target` lines.
 * Rows are matched on (paymentId, scheduleId, amount); an amount change on
 * the same pair is a void + create, never an in-place edit.
 */
export function diffAllocations(
  active: readonly ExistingAllocation[],
  target: readonly AllocationLine[],
): { toVoid: ExistingAllocation[]; toCreate: AllocationLine[] } {
  const key = (a: AllocationLine) => `${a.paymentId}|${a.scheduleId}|${a.amount}`;
  const pool = new Map<string, ExistingAllocation[]>();
  for (const row of active) {
    const k = key(row);
    const list = pool.get(k);
    if (list) list.push(row);
    else pool.set(k, [row]);
  }
  const toCreate: AllocationLine[] = [];
  for (const line of target) {
    const match = pool.get(key(line));
    if (match && match.length > 0) match.shift();
    else toCreate.push(line);
  }
  const toVoid = [...pool.values()].flat();
  return { toVoid, toCreate };
}

/**
 * How much of each schedule day was covered by money dated ON OR BEFORE that
 * day. Because OLDEST_FIRST coverage is prefix-shaped, this only depends on
 * the running total of payments by date — so it gives the same answer no
 * matter when reconciliation runs or when a back-dated payment was keyed in.
 * This is what decides MISSED/PARTIAL-at-close vs PAID-on-time.
 * Cancelled days were never due, so they are skipped exactly as in allocation.
 */
export function coverageAtClose(
  schedules: readonly AllocatableSchedule[],
  payments: readonly AllocatablePayment[],
): Map<string, Paise> {
  const due = schedules.filter((s) => !s.cancelled).sort(compareSchedules);
  const ordered = [...payments].sort(comparePayments);
  const result = new Map<string, Paise>(schedules.map((s) => [s.id, 0 as Paise]));

  let paidSoFar = 0; // payments dated <= current schedule date
  let pi = 0;
  let expectedBefore = 0; // Σ expected of earlier due days
  for (const s of due) {
    while (pi < ordered.length && compareDates(ordered[pi].paymentDate, s.scheduledDate) <= 0) {
      paidSoFar += ordered[pi].amount;
      pi++;
    }
    const covered = Math.max(0, Math.min(s.expectedAmount, paidSoFar - expectedBefore));
    result.set(s.id, paise(covered));
    expectedBefore += s.expectedAmount;
  }
  return result;
}

export type AllocationKind = "ARREARS" | "CURRENT" | "ADVANCE";

export interface AllocationExplanationLine {
  scheduleId: string;
  scheduledDate: BusinessDate;
  amount: Paise;
  kind: AllocationKind;
}

export interface AllocationExplanation {
  paymentId: string;
  amount: Paise;
  lines: AllocationExplanationLine[];
  credit: Paise;
}

/** "₹1,500 received → ₹750 to 28 Sep (arrears), ₹750 to 29 Sep (today)". */
export function explainPayment(
  payment: AllocatablePayment,
  result: AllocationResult,
  schedules: readonly AllocatableSchedule[],
): AllocationExplanation {
  const byId = new Map(schedules.map((s) => [s.id, s]));
  const lines = result.allocations
    .filter((a) => a.paymentId === payment.id)
    .map((a) => {
      const s = byId.get(a.scheduleId)!;
      const cmp = compareDates(s.scheduledDate, payment.paymentDate);
      const kind: AllocationKind = cmp < 0 ? "ARREARS" : cmp === 0 ? "CURRENT" : "ADVANCE";
      return { scheduleId: s.id, scheduledDate: s.scheduledDate, amount: a.amount, kind };
    })
    .sort((a, b) => compareDates(a.scheduledDate, b.scheduledDate));
  const allocated = lines.reduce((t, l) => t + l.amount, 0);
  return { paymentId: payment.id, amount: payment.amount, lines, credit: sub(payment.amount, paise(allocated)) };
}
