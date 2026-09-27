/**
 * Plans the complete financial state of ONE contract from its facts.
 * The DB layer loads facts (inside a transaction holding the contract row
 * lock), calls planContractState, and persists exactly what it returns.
 * Contracts are never mixed: every input and output is scoped to one contract.
 */

import {
  allocateOldestFirst,
  coverageAtClose,
  diffAllocations,
  type AllocatablePayment,
  type AllocatableSchedule,
  type AllocationLine,
  type AllocationResult,
  type ExistingAllocation,
} from "./allocation";
import { compareDates, type BusinessDate } from "./dates";
import { paise, sub, type Paise } from "./money";
import { deriveScheduleStatus, shortfallAtClose, type ScheduleStatus, type StatusContext } from "./schedule-status";

export interface ScheduleRecord extends AllocatableSchedule {
  allocatedAmount: Paise; // current projection in DB
  status: ScheduleStatus; // current projection in DB
  missedAt: string | null;
}

export interface ContractFacts {
  schedules: ScheduleRecord[];
  /** ACTIVE (non-reversed) payments only. */
  payments: AllocatablePayment[];
  /** ACTIVE (non-voided) allocation rows currently in the DB. */
  activeAllocations: ExistingAllocation[];
}

export interface ScheduleUpdate {
  id: string;
  allocatedAmount: Paise;
  status: ScheduleStatus;
  /** Set when the day has closed short and has never been flagged before. */
  markMissed: { shortfall: Paise } | null;
  /** This plan cancels the day (contract cancellation). */
  cancel: boolean;
  becameSettled: boolean;
}

export interface ContractPlan {
  result: AllocationResult;
  toVoid: ExistingAllocation[];
  toCreate: AllocationLine[];
  /** Only schedules whose projection changes (or need a missed flag / cancellation). */
  scheduleUpdates: ScheduleUpdate[];
  /** Every non-cancelled obligation fully satisfied. */
  fullyCollected: boolean;
}

export function planContractState(
  facts: ContractFacts,
  ctx: StatusContext,
  opts: { cancelScheduleIds?: ReadonlySet<string> } = {},
): ContractPlan {
  const cancelNow = opts.cancelScheduleIds ?? new Set<string>();
  const schedules = facts.schedules.map((s) => ({ ...s, cancelled: Boolean(s.cancelled) || cancelNow.has(s.id) }));

  const result = allocateOldestFirst(schedules, facts.payments);
  const { toVoid, toCreate } = diffAllocations(facts.activeAllocations, result.allocations);
  const onTime = coverageAtClose(schedules, facts.payments);

  const scheduleUpdates: ScheduleUpdate[] = [];
  for (const s of schedules) {
    const allocatedAmount = result.allocatedBySchedule.get(s.id) ?? (0 as Paise);
    const scheduleFacts = {
      scheduledDate: s.scheduledDate,
      expectedAmount: s.expectedAmount,
      allocatedAmount,
      coveredAtClose: onTime.get(s.id) ?? (0 as Paise),
      cancelled: s.cancelled,
    };
    const status = deriveScheduleStatus(scheduleFacts, ctx);
    const short = s.missedAt ? null : shortfallAtClose(scheduleFacts, ctx);
    const markMissed = short !== null ? { shortfall: short } : null;
    const cancel = cancelNow.has(s.id);
    const becameSettled = allocatedAmount >= s.expectedAmount && s.allocatedAmount < s.expectedAmount;
    if (allocatedAmount !== s.allocatedAmount || status !== s.status || markMissed || cancel) {
      scheduleUpdates.push({ id: s.id, allocatedAmount, status, markMissed, cancel, becameSettled });
    }
  }

  const fullyCollected = schedules.every(
    (s) => s.cancelled || (result.allocatedBySchedule.get(s.id) ?? 0) >= s.expectedAmount,
  );

  return { result, toVoid, toCreate, scheduleUpdates, fullyCollected };
}

// ─────────────────────────── Summary numbers ───────────────────────────

export interface ScheduleSnapshot {
  scheduledDate: BusinessDate;
  expectedAmount: Paise;
  allocatedAmount: Paise;
  status: ScheduleStatus;
  missedAt: string | null;
}

/**
 * Everything the UI shows for one contract, derived from the schedule
 * projection + the active payment total. No principal/profit split: the
 * obligation is the contracted collection (daily × days); principal and
 * margin are reported alongside, never used for allocation.
 */
export interface ContractSummary {
  principal: Paise;
  contractedCollection: Paise;
  contractualMargin: Paise;
  /** Σ active payments (includes unallocated credit). */
  collected: Paise;
  /** Σ active allocations. */
  allocated: Paise;
  /** Remaining obligation over the life of the contract (excludes cancelled days). */
  outstanding: Paise;
  /** Shortfall on days whose cutoff has passed ("Missed Outstanding"). */
  overdue: Paise;
  /** Today's obligation and how much of it is covered. */
  todayExpected: Paise;
  todayAllocated: Paise;
  /** Allocated to days after today. */
  prepaid: Paise;
  /** Money received beyond every remaining obligation. */
  credit: Paise;
  /** Obligations removed by cancellation (not outstanding, not "written off"). */
  cancelledObligation: Paise;
  daysTotal: number;
  daysCancelled: number;
  /** Obligations fully satisfied (PAID + SETTLED_LATE, including prepaid). */
  daysSatisfied: number;
  /** Closed days not fully covered right now. */
  daysOverdue: number;
  /** Closed days that were flagged short at close (history; stays after late settlement). */
  daysEverMissed: number;
}

export function summarizeContract(
  input: {
    principalAmount: Paise;
    expectedCollectionAmount: Paise;
    activePaymentsTotal: Paise;
    schedules: readonly ScheduleSnapshot[];
  },
  ctx: StatusContext,
): ContractSummary {
  let allocated = 0;
  let outstanding = 0;
  let overdue = 0;
  let todayExpected = 0;
  let todayAllocated = 0;
  let prepaid = 0;
  let cancelledObligation = 0;
  let daysCancelled = 0;
  let daysSatisfied = 0;
  let daysOverdue = 0;
  let daysEverMissed = 0;

  for (const s of input.schedules) {
    allocated += s.allocatedAmount;
    if (s.missedAt) daysEverMissed++;
    if (s.status === "CANCELLED") {
      cancelledObligation += s.expectedAmount;
      daysCancelled++;
      continue;
    }
    const short = s.expectedAmount - s.allocatedAmount;
    outstanding += short;
    if (short <= 0) daysSatisfied++;
    const cmpToday = compareDates(s.scheduledDate, ctx.today);
    if (cmpToday > 0) prepaid += s.allocatedAmount;
    if (cmpToday === 0) {
      todayExpected += s.expectedAmount;
      todayAllocated += s.allocatedAmount;
    }
    if (compareDates(s.scheduledDate, ctx.closedThrough) <= 0 && short > 0) {
      overdue += short;
      daysOverdue++;
    }
  }

  const allocatedP = paise(allocated);
  return {
    principal: input.principalAmount,
    contractedCollection: input.expectedCollectionAmount,
    contractualMargin: sub(input.expectedCollectionAmount, input.principalAmount),
    collected: input.activePaymentsTotal,
    allocated: allocatedP,
    outstanding: paise(outstanding),
    overdue: paise(overdue),
    todayExpected: paise(todayExpected),
    todayAllocated: paise(todayAllocated),
    prepaid: paise(prepaid),
    credit: sub(input.activePaymentsTotal, allocatedP),
    cancelledObligation: paise(cancelledObligation),
    daysTotal: input.schedules.length,
    daysCancelled,
    daysSatisfied,
    daysOverdue,
    daysEverMissed,
  };
}
