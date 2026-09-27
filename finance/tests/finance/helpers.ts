import type { AllocatablePayment, ExistingAllocation } from "@/lib/finance/allocation";
import { buildContractTerms } from "@/lib/finance/contract-terms";
import type { ContractFacts, ScheduleRecord } from "@/lib/finance/contract-state";
import { addDays, businessDate, type BusinessDate } from "@/lib/finance/dates";
import { paise, type Paise } from "@/lib/finance/money";
import type { StatusContext } from "@/lib/finance/schedule-status";

export const rs = (rupees: number): Paise => paise(rupees * 100);
export const d = (s: string): BusinessDate => businessDate(s);

/** Dharmjit's contract: ₹50,000 → ₹750/day × 100, collections from 27 Sep 2026. */
export function makeContract(opts: { daily?: number; days?: number; first?: string; principal?: number } = {}) {
  const terms = buildContractTerms({
    principalAmount: rs(opts.principal ?? 50_000),
    dailyCollectionAmount: rs(opts.daily ?? 750),
    totalCollectionDays: opts.days ?? 100,
    startDate: addDays(d(opts.first ?? "2026-09-27"), -1),
    firstCollectionDate: d(opts.first ?? "2026-09-27"),
  });
  const schedules: ScheduleRecord[] = terms.schedule.map((s) => ({
    id: `S${String(s.sequence).padStart(3, "0")}`,
    sequence: s.sequence,
    scheduledDate: s.scheduledDate,
    expectedAmount: s.expectedAmount,
    allocatedAmount: paise(0),
    status: "PENDING",
    missedAt: null,
  }));
  return { terms, schedules };
}

let seq = 0;
export function pay(rupees: number, date: string, id?: string): AllocatablePayment {
  seq++;
  return {
    id: id ?? `P${String(seq).padStart(4, "0")}`,
    amount: rs(rupees),
    paymentDate: d(date),
    recordedAt: `${date}T10:00:${String(seq % 60).padStart(2, "0")}.000Z`,
  };
}

/** "Today is `today`, and the previous day has closed" (i.e. before today's cutoff). */
export function ctxOn(today: string, opts: { afterCutoff?: boolean } = {}): StatusContext {
  const t = d(today);
  return { today: t, closedThrough: opts.afterCutoff ? t : addDays(t, -1) };
}

export function facts(
  base: { schedules: ScheduleRecord[] },
  payments: AllocatablePayment[],
  activeAllocations: ExistingAllocation[] = [],
): ContractFacts {
  return { schedules: base.schedules, payments, activeAllocations };
}
