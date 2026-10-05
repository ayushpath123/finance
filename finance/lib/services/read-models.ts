import "server-only";
import { Prisma } from "@/lib/generated/prisma/client";
import type { AuditAction, ContractStatus, PaymentMethod, PersonStatus, TransactionStatus } from "@/lib/generated/prisma/client";
import { prisma } from "@/lib/db/client";
import { summarizeContract, type ContractSummary } from "@/lib/finance/contract-state";
import { fromDbDate, toDbDate, type BusinessDate } from "@/lib/finance/dates";
import { paise, type Paise } from "@/lib/finance/money";
import { toDisplayStatus, type ScheduleDisplayStatus, type ScheduleStatus } from "@/lib/finance/schedule-status";
import { formatContractNumber } from "./contracts";
import { formatShortTermNumber } from "./short-term";
import { shortTermLoans, shortTermTotalsOf, type ShortTermLoanItem, type ShortTermTotals } from "./short-term-read";
import { businessNow, getSettings, type BusinessNow } from "./settings";

/**
 * Read models for the UI. Everything here is DERIVED from the financial facts
 * (schedule projection, payments, disbursements) — nothing is stored twice and
 * no allocation logic is re-implemented. The per-contract SQL mirrors
 * `summarizeContract` exactly; tests/integration/read-models.test.ts proves it.
 */

/** One contract's numbers, as shown on every card. All money in paise. */
export interface ContractAggregate {
  contractId: string;
  contractNumber: number;
  label: string; // "AF-0009"
  personId: string;
  status: ContractStatus;
  principal: Paise; // agreed amount given
  disbursed: Paise; // Σ active disbursements
  dailyAmount: Paise;
  totalDays: number;
  startDate: BusinessDate;
  firstCollectionDate: BusinessDate;
  finalCollectionDate: BusinessDate;
  contractedCollection: Paise; // daily × days (the agreement)
  validContracted: Paise; // excluding cancelled obligations
  collected: Paise; // Σ active payments
  allocated: Paise;
  outstanding: Paise;
  overdue: Paise; // "missed outstanding"
  overdueDays: number;
  todayExpected: Paise;
  todayAllocated: Paise;
  prepaid: Paise;
  credit: Paise;
  cancelledObligation: Paise;
  daysSatisfied: number;
  daysValid: number;
  daysEverMissed: number;
  nextDue: { date: BusinessDate; amount: Paise } | null;
  lastPaymentDate: BusinessDate | null;
}

type AggRow = {
  id: string;
  contractNumber: number;
  personId: string;
  status: ContractStatus;
  principalAmount: number;
  dailyCollectionAmount: number;
  totalCollectionDays: number;
  expectedCollectionAmount: number;
  startDate: Date;
  firstCollectionDate: Date;
  expectedEndDate: Date;
  valid_contracted: bigint | null;
  allocated: bigint | null;
  outstanding: bigint | null;
  overdue: bigint | null;
  overdue_days: bigint | null;
  today_expected: bigint | null;
  today_allocated: bigint | null;
  prepaid: bigint | null;
  cancelled_obligation: bigint | null;
  days_satisfied: bigint | null;
  days_valid: bigint | null;
  days_ever_missed: bigint | null;
  next_due_date: Date | null;
  next_due_amount: number | null;
  collected: bigint | null;
  last_payment_date: Date | null;
  disbursed: bigint | null;
};

const n = (v: bigint | number | null | undefined) => paise(Number(v ?? 0));

export async function contractAggregates(
  filter: { personIds?: string[]; contractIds?: string[] },
  bn: BusinessNow,
): Promise<ContractAggregate[]> {
  if ((filter.personIds && filter.personIds.length === 0) || (filter.contractIds && filter.contractIds.length === 0)) return [];
  const today = toDbDate(bn.today);
  const closed = toDbDate(bn.closedThrough);
  const where = filter.contractIds
    ? Prisma.sql`c."id" IN (${Prisma.join(filter.contractIds.map((id) => Prisma.sql`${id}::uuid`))})`
    : filter.personIds
      ? Prisma.sql`c."personId" IN (${Prisma.join(filter.personIds.map((id) => Prisma.sql`${id}::uuid`))})`
      : Prisma.sql`TRUE`;

  const rows = await prisma.$queryRaw<AggRow[]>`
    WITH scope AS (SELECT c."id" FROM "contracts" c WHERE ${where}),
    s AS (
      SELECT sc."contractId",
        SUM(CASE WHEN sc."cancelledAt" IS NULL THEN sc."expectedAmount" ELSE 0 END) AS valid_contracted,
        SUM(sc."allocatedAmount") AS allocated,
        SUM(CASE WHEN sc."cancelledAt" IS NULL THEN sc."expectedAmount" - sc."allocatedAmount" ELSE 0 END) AS outstanding,
        SUM(CASE WHEN sc."cancelledAt" IS NULL AND sc."scheduledDate" <= ${closed}::date THEN sc."expectedAmount" - sc."allocatedAmount" ELSE 0 END) AS overdue,
        COUNT(*) FILTER (WHERE sc."cancelledAt" IS NULL AND sc."scheduledDate" <= ${closed}::date AND sc."allocatedAmount" < sc."expectedAmount") AS overdue_days,
        SUM(CASE WHEN sc."cancelledAt" IS NULL AND sc."scheduledDate" = ${today}::date THEN sc."expectedAmount" ELSE 0 END) AS today_expected,
        SUM(CASE WHEN sc."cancelledAt" IS NULL AND sc."scheduledDate" = ${today}::date THEN sc."allocatedAmount" ELSE 0 END) AS today_allocated,
        SUM(CASE WHEN sc."cancelledAt" IS NULL AND sc."scheduledDate" > ${today}::date THEN sc."allocatedAmount" ELSE 0 END) AS prepaid,
        SUM(CASE WHEN sc."cancelledAt" IS NOT NULL THEN sc."expectedAmount" ELSE 0 END) AS cancelled_obligation,
        COUNT(*) FILTER (WHERE sc."cancelledAt" IS NULL AND sc."allocatedAmount" >= sc."expectedAmount") AS days_satisfied,
        COUNT(*) FILTER (WHERE sc."cancelledAt" IS NULL) AS days_valid,
        COUNT(*) FILTER (WHERE sc."missedAt" IS NOT NULL) AS days_ever_missed
      FROM "collection_schedules" sc JOIN scope ON scope."id" = sc."contractId"
      GROUP BY sc."contractId"
    ),
    nd AS (
      SELECT DISTINCT ON (sc."contractId") sc."contractId", sc."scheduledDate" AS next_due_date,
        sc."expectedAmount" - sc."allocatedAmount" AS next_due_amount
      FROM "collection_schedules" sc JOIN scope ON scope."id" = sc."contractId"
      WHERE sc."cancelledAt" IS NULL AND sc."scheduledDate" >= ${today}::date AND sc."allocatedAmount" < sc."expectedAmount"
      ORDER BY sc."contractId", sc."scheduledDate"
    ),
    p AS (
      SELECT pm."contractId", SUM(pm."amount") AS collected, MAX(pm."paymentDate") AS last_payment_date
      FROM "payments" pm JOIN scope ON scope."id" = pm."contractId"
      WHERE pm."status" = 'ACTIVE' GROUP BY pm."contractId"
    ),
    d AS (
      SELECT ds."contractId", SUM(ds."amount") AS disbursed
      FROM "disbursements" ds JOIN scope ON scope."id" = ds."contractId"
      WHERE ds."status" = 'ACTIVE' GROUP BY ds."contractId"
    )
    SELECT c."id", c."contractNumber", c."personId", c."status", c."principalAmount", c."dailyCollectionAmount",
      c."totalCollectionDays", c."expectedCollectionAmount", c."startDate", c."firstCollectionDate", c."expectedEndDate",
      s.valid_contracted, s.allocated, s.outstanding, s.overdue, s.overdue_days, s.today_expected, s.today_allocated,
      s.prepaid, s.cancelled_obligation, s.days_satisfied, s.days_valid, s.days_ever_missed,
      nd.next_due_date, nd.next_due_amount, p.collected, p.last_payment_date, d.disbursed
    FROM "contracts" c
    JOIN scope ON scope."id" = c."id"
    LEFT JOIN s ON s."contractId" = c."id"
    LEFT JOIN nd ON nd."contractId" = c."id"
    LEFT JOIN p ON p."contractId" = c."id"
    LEFT JOIN d ON d."contractId" = c."id"
    ORDER BY c."contractNumber"`;

  return rows.map((r) => {
    const collected = n(r.collected);
    const allocated = n(r.allocated);
    return {
      contractId: r.id,
      contractNumber: r.contractNumber,
      label: formatContractNumber(r.contractNumber),
      personId: r.personId,
      status: r.status,
      principal: paise(r.principalAmount),
      disbursed: n(r.disbursed),
      dailyAmount: paise(r.dailyCollectionAmount),
      totalDays: r.totalCollectionDays,
      startDate: fromDbDate(r.startDate),
      firstCollectionDate: fromDbDate(r.firstCollectionDate),
      finalCollectionDate: fromDbDate(r.expectedEndDate),
      contractedCollection: paise(r.expectedCollectionAmount),
      validContracted: n(r.valid_contracted),
      collected,
      allocated,
      outstanding: n(r.outstanding),
      overdue: n(r.overdue),
      overdueDays: Number(r.overdue_days ?? 0),
      todayExpected: n(r.today_expected),
      todayAllocated: n(r.today_allocated),
      prepaid: n(r.prepaid),
      credit: paise(collected - allocated),
      cancelledObligation: n(r.cancelled_obligation),
      daysSatisfied: Number(r.days_satisfied ?? 0),
      daysValid: Number(r.days_valid ?? 0),
      daysEverMissed: Number(r.days_ever_missed ?? 0),
      nextDue: r.next_due_date ? { date: fromDbDate(r.next_due_date), amount: paise(r.next_due_amount ?? 0) } : null,
      lastPaymentDate: r.last_payment_date ? fromDbDate(r.last_payment_date) : null,
    };
  });
}

export interface MoneyTotals {
  principalGiven: Paise;
  contracted: Paise;
  collected: Paise;
  outstanding: Paise;
  todayExpected: Paise;
  todayAllocated: Paise;
  todayRemaining: Paise;
  missed: Paise;
  missedDays: number;
  prepaid: Paise;
  credit: Paise;
  activeContracts: number;
  totalContracts: number;
}

/** Person/portfolio totals = sums of the independent per-contract numbers. */
export function totalsOf(contracts: readonly ContractAggregate[]): MoneyTotals {
  const s = (f: (c: ContractAggregate) => number) => paise(contracts.reduce((t, c) => t + f(c), 0));
  const todayExpected = s((c) => c.todayExpected);
  const todayAllocated = s((c) => c.todayAllocated);
  return {
    principalGiven: s((c) => c.disbursed),
    contracted: s((c) => c.validContracted),
    collected: s((c) => c.collected),
    outstanding: s((c) => c.outstanding),
    todayExpected,
    todayAllocated,
    todayRemaining: paise(todayExpected - todayAllocated),
    missed: s((c) => c.overdue),
    missedDays: contracts.reduce((t, c) => t + c.overdueDays, 0),
    prepaid: s((c) => c.prepaid),
    credit: s((c) => c.credit),
    activeContracts: contracts.filter((c) => c.status === "ACTIVE" || c.status === "DEFAULTED").length,
    totalContracts: contracts.length,
  };
}

// ─────────────────────────── People directory ───────────────────────────

export interface PersonListItem {
  id: string;
  slug: string;
  fullName: string;
  phoneNumber: string;
  status: PersonStatus;
  totals: MoneyTotals;
  shortTerm: ShortTermTotals;
  /** Money YOU borrowed from this person and still have to pay back. Never netted with what they owe you. */
  borrowed: ShortTermTotals;
  /** Contracts + open short-term loans (what they owe you). */
  totalOutstanding: Paise;
  paidToday: boolean;
  lastPaymentDate: BusinessDate | null;
}

/** "AF-0009", "af9", "#9", "9" (only if it can't be a phone fragment) → 9 */
function parseContractNumber(q: string): number | null {
  const m = /^(?:af-?|#)\s*0*(\d{1,7})$/i.exec(q.trim());
  return m ? Number(m[1]) : null;
}

/** "ST-0003", "st3", "BR-0004" → number */
function parseShortTermNumber(q: string): number | null {
  const m = /^(?:st|br)-?\s*0*(\d{1,7})$/i.exec(q.trim());
  return m ? Number(m[1]) : null;
}

export async function getPeopleDirectory(opts: { q?: string; now?: Date } = {}) {
  const bn = businessNow(await getSettings(), opts.now);
  const q = opts.q?.trim() ?? "";
  const digits = q.replace(/\D/g, "");
  const contractNo = q ? parseContractNumber(q) : null;
  const shortTermNo = q ? parseShortTermNumber(q) : null;

  const or: Prisma.PersonWhereInput[] = [];
  if (q) {
    or.push({ fullName: { contains: q, mode: "insensitive" } });
    if (digits.length >= 3) or.push({ phoneNumber: { contains: digits } }, { alternatePhone: { contains: digits } });
    if (contractNo !== null) or.push({ contracts: { some: { contractNumber: contractNo } } });
    if (shortTermNo !== null) or.push({ shortTermLoans: { some: { loanNumber: shortTermNo } } });
  }

  const people = await prisma.person.findMany({
    where: { deletedAt: null, ...(or.length ? { OR: or } : {}) },
    orderBy: { fullName: "asc" },
    take: 200,
    select: { id: true, slug: true, fullName: true, phoneNumber: true, status: true },
  });
  const ids = people.map((p) => p.id);
  const [aggs, loans] = await Promise.all([contractAggregates({ personIds: ids }, bn), shortTermLoans({ personIds: ids }, bn)]);
  const byPerson = groupBy(aggs, (a) => a.personId);
  const loansByPerson = groupBy(loans, (l) => l.personId);

  const items: PersonListItem[] = people.map((p) => {
    const cs = byPerson.get(p.id) ?? [];
    const totals = totalsOf(cs);
    const shortTerm = shortTermTotalsOf(loansByPerson.get(p.id) ?? []);
    const borrowed = shortTermTotalsOf(loansByPerson.get(p.id) ?? [], "BORROWED");
    const last = cs.map((c) => c.lastPaymentDate).filter((d): d is BusinessDate => d !== null).sort().at(-1) ?? null;
    return {
      ...p,
      totals,
      shortTerm,
      borrowed,
      totalOutstanding: paise(totals.outstanding + shortTerm.outstanding),
      paidToday: totals.todayExpected > 0 && totals.todayRemaining <= 0,
      lastPaymentDate: last,
    };
  });
  return { bn, items, activeCount: items.filter((i) => i.totals.activeContracts > 0 || i.shortTerm.open > 0 || i.borrowed.open > 0).length };
}

function groupBy<T>(list: readonly T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const item of list) {
    const k = key(item);
    const arr = m.get(k);
    if (arr) arr.push(item);
    else m.set(k, [item]);
  }
  return m;
}

// ─────────────────────────── Person dashboard ───────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findPerson(key: string) {
  const person = await prisma.person.findFirst({
    where: { deletedAt: null, OR: [{ slug: key }, ...(UUID.test(key) ? [{ id: key }] : [])] },
  });
  return person;
}

export interface PaymentListItem {
  id: string;
  amount: Paise;
  paymentDate: BusinessDate;
  recordedAt: Date;
  method: PaymentMethod;
  referenceNumber: string | null;
  status: TransactionStatus;
  contractId: string;
  contractLabel: string;
  correctsPaymentId: string | null;
  createdBy: string;
}

export interface ActivityItem {
  id: string;
  action: AuditAction;
  description: string;
  timestamp: Date;
  by: string | null; // mobile number, or null for the system
  contractId: string | null;
}

const NOISY_ACTIONS: AuditAction[] = ["PAYMENT_ALLOCATED", "PAYMENT_UNALLOCATED", "RECONCILIATION_RUN"];

export async function getPersonDashboard(key: string, opts: { now?: Date } = {}) {
  const person = await findPerson(key);
  if (!person) return null;
  const bn = businessNow(await getSettings(), opts.now);
  const [contracts, loans, payments, activity] = await Promise.all([
    contractAggregates({ personIds: [person.id] }, bn),
    shortTermLoans({ personIds: [person.id] }, bn),
    listPayments({ personId: person.id, take: 8 }),
    prisma.auditLog.findMany({
      where: { personId: person.id, action: { notIn: NOISY_ACTIONS } },
      orderBy: { timestamp: "desc" },
      take: 200,
      include: { user: { select: { mobileNumber: true } } },
    }),
  ]);
  const order: Record<ContractStatus, number> = { ACTIVE: 0, DEFAULTED: 1, COMPLETED: 2, CANCELLED: 3 };
  contracts.sort((a, b) => order[a.status] - order[b.status] || b.contractNumber - a.contractNumber);
  const totals = totalsOf(contracts);
  const shortTerm = shortTermTotalsOf(loans);
  const borrowed = shortTermTotalsOf(loans, "BORROWED");
  const loanOrder: Record<ShortTermLoanItem["status"], number> = { OPEN: 0, CLOSED: 1, CANCELLED: 2 };
  loans.sort((a, b) => loanOrder[a.status] - loanOrder[b.status] || b.loanNumber - a.loanNumber);
  return {
    bn,
    person,
    totals,
    shortTerm,
    borrowed,
    shortTermLoans: loans.filter((l) => l.direction === "LENT"),
    borrowings: loans.filter((l) => l.direction === "BORROWED"),
    totalOutstanding: paise(totals.outstanding + shortTerm.outstanding),
    contracts,
    payments,
    activity: activity.map(
      (a): ActivityItem => ({
        id: a.id,
        action: a.action,
        description: a.description,
        timestamp: a.timestamp,
        by: a.user?.mobileNumber ?? null,
        contractId: a.contractId,
      }),
    ),
  };
}

export async function listPayments(filter: { personId?: string; contractId?: string; take?: number }): Promise<PaymentListItem[]> {
  const rows = await prisma.payment.findMany({
    where: { personId: filter.personId, contractId: filter.contractId },
    orderBy: [{ paymentDate: "desc" }, { recordedAt: "desc" }],
    take: filter.take ?? 50,
    include: { contract: { select: { contractNumber: true } }, createdBy: { select: { mobileNumber: true } } },
  });
  return rows.map((p) => ({
    id: p.id,
    amount: paise(p.amount),
    paymentDate: fromDbDate(p.paymentDate),
    recordedAt: p.recordedAt,
    method: p.paymentMethod,
    referenceNumber: p.referenceNumber,
    status: p.status,
    contractId: p.contractId,
    contractLabel: formatContractNumber(p.contract.contractNumber),
    correctsPaymentId: p.correctsPaymentId,
    createdBy: p.createdBy.mobileNumber,
  }));
}

// ─────────────────────────── Contract detail ───────────────────────────

export interface DayAllocation {
  paymentId: string;
  amount: Paise;
  paymentDate: BusinessDate;
  method: PaymentMethod;
  referenceNumber: string | null;
  paymentAmount: Paise;
}

export interface CalendarDay {
  id: string;
  sequence: number;
  date: BusinessDate;
  expected: Paise;
  allocated: Paise;
  outstanding: Paise;
  status: ScheduleStatus;
  display: ScheduleDisplayStatus;
  wasMissed: boolean;
  shortfallAtClose: Paise | null;
  /** Portion paid by money dated on/before the day (the rest was settled late). */
  paidOnTime: Paise;
  allocations: DayAllocation[];
  /** Payments whose payment date is this day (money received that day, any contract day it went to). */
  receivedThisDay: { id: string; amount: Paise; method: PaymentMethod; referenceNumber: string | null; status: TransactionStatus }[];
  notes: string | null;
}

export async function getContractDetail(contractId: string, opts: { now?: Date } = {}) {
  if (!UUID.test(contractId)) return null;
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    include: {
      person: { select: { id: true, slug: true, fullName: true, phoneNumber: true } },
      disbursements: { orderBy: { createdAt: "asc" } },
      createdBy: { select: { mobileNumber: true } },
    },
  });
  if (!contract) return null;
  const bn = businessNow(await getSettings(), opts.now);
  const ctx = { today: bn.today, closedThrough: bn.closedThrough };

  const [[agg], schedules, allocations, payments] = await Promise.all([
    contractAggregates({ contractIds: [contractId] }, bn),
    prisma.collectionSchedule.findMany({ where: { contractId }, orderBy: { sequence: "asc" } }),
    prisma.paymentAllocation.findMany({
      where: { contractId, voidedAt: null },
      include: { payment: { select: { amount: true, paymentDate: true, paymentMethod: true, referenceNumber: true } } },
    }),
    listPayments({ contractId, take: 500 }),
  ]);

  const allocBySchedule = groupBy(allocations, (a) => a.scheduleId);
  const paymentsByDate = groupBy(payments, (p) => p.paymentDate);

  const days: CalendarDay[] = schedules.map((s) => {
    const date = fromDbDate(s.scheduledDate);
    const status = s.status as ScheduleStatus;
    const allocs = (allocBySchedule.get(s.id) ?? [])
      .map(
        (a): DayAllocation => ({
          paymentId: a.paymentId,
          amount: paise(a.amount),
          paymentDate: fromDbDate(a.payment.paymentDate),
          method: a.payment.paymentMethod,
          referenceNumber: a.payment.referenceNumber,
          paymentAmount: paise(a.payment.amount),
        }),
      )
      .sort((a, b) => (a.paymentDate < b.paymentDate ? -1 : 1));
    return {
      id: s.id,
      sequence: s.sequence,
      date,
      expected: paise(s.expectedAmount),
      allocated: paise(s.allocatedAmount),
      outstanding: paise(s.cancelledAt ? 0 : s.expectedAmount - s.allocatedAmount),
      status,
      display: toDisplayStatus({ scheduledDate: date, status }, ctx),
      wasMissed: s.missedAt !== null,
      shortfallAtClose: s.shortfallAtClose === null ? null : paise(s.shortfallAtClose),
      paidOnTime: paise(allocs.filter((a) => a.paymentDate <= date).reduce((t, a) => t + a.amount, 0)),
      allocations: allocs,
      receivedThisDay: (paymentsByDate.get(date) ?? []).map((p) => ({
        id: p.id,
        amount: p.amount,
        method: p.method,
        referenceNumber: p.referenceNumber,
        status: p.status,
      })),
      notes: s.notes,
    };
  });

  return { bn, contract, label: formatContractNumber(contract.contractNumber), agg, days, payments };
}

// ─────────────────────────── Home / today ───────────────────────────

export async function getTodayOverview(opts: { now?: Date } = {}) {
  const bn = businessNow(await getSettings(), opts.now);
  const [aggs, receivedToday, people, openLoans, stReceivedToday] = await Promise.all([
    contractAggregates({}, bn),
    prisma.payment.aggregate({ where: { status: "ACTIVE", paymentDate: toDbDate(bn.today) }, _sum: { amount: true }, _count: true }),
    prisma.person.findMany({ where: { deletedAt: null }, select: { id: true, slug: true, fullName: true, phoneNumber: true } }),
    shortTermLoans({ status: "OPEN" }, bn),
    prisma.shortTermRepayment.aggregate({ where: { status: "ACTIVE", receivedOn: toDbDate(bn.today), loan: { direction: "LENT" } }, _sum: { amount: true } }),
  ]);
  const personById = new Map(people.map((p) => [p.id, p]));
  const totals = totalsOf(aggs);
  const due = aggs
    .filter((a) => a.todayExpected > 0)
    .map((a) => ({ ...a, person: personById.get(a.personId)! }))
    .sort((a, b) => Number(a.todayAllocated >= a.todayExpected) - Number(b.todayAllocated >= b.todayExpected) || a.person.fullName.localeCompare(b.person.fullName));
  const activePeople = new Set(aggs.filter((a) => a.status === "ACTIVE" || a.status === "DEFAULTED").map((a) => a.personId)).size;
  return {
    bn,
    totals,
    receivedToday: paise(receivedToday._sum.amount ?? 0),
    paymentsToday: receivedToday._count,
    due,
    activePeople,
    completedContracts: aggs.filter((a) => a.status === "COMPLETED").length,
    shortTerm: shortTermTotalsOf(openLoans),
    borrowed: shortTermTotalsOf(openLoans, "BORROWED"),
    shortTermReceivedToday: paise(stReceivedToday._sum.amount ?? 0),
  };
}

// ─────────────────────────── Activity (transactions) ───────────────────────────

export type TransactionItem =
  | ({ kind: "PAYMENT"; href: string; person: { slug: string; fullName: string } } & PaymentListItem)
  | {
      kind: "SHORT_TERM_GIVEN" | "SHORT_TERM_REPAYMENT" | "BORROWED" | "BORROWING_REPAID";
      href: string;
      id: string;
      amount: Paise;
      date: BusinessDate;
      recordedAt: Date;
      method: PaymentMethod;
      referenceNumber: string | null;
      status: TransactionStatus;
      contractLabel: string;
      createdBy: string;
      person: { slug: string; fullName: string };
    }
  | {
      kind: "DISBURSEMENT";
      href: string;
      id: string;
      amount: Paise;
      date: BusinessDate;
      recordedAt: Date;
      method: PaymentMethod;
      referenceNumber: string | null;
      status: TransactionStatus;
      contractId: string;
      contractLabel: string;
      createdBy: string;
      person: { slug: string; fullName: string };
    };

export async function getRecentTransactions(opts: { personId?: string; take?: number } = {}): Promise<TransactionItem[]> {
  const take = opts.take ?? 60;
  const include = {
    contract: { select: { contractNumber: true } },
    createdBy: { select: { mobileNumber: true } },
    person: { select: { slug: true, fullName: true } },
  } as const;
  const stInclude = { createdBy: { select: { mobileNumber: true } }, person: { select: { slug: true, fullName: true } } } as const;
  const [payments, disbursements, stLoans, stRepayments] = await Promise.all([
    prisma.payment.findMany({ where: { personId: opts.personId }, orderBy: { recordedAt: "desc" }, take, include }),
    prisma.disbursement.findMany({ where: { personId: opts.personId }, orderBy: { createdAt: "desc" }, take, include }),
    prisma.shortTermLoan.findMany({ where: { personId: opts.personId }, orderBy: { createdAt: "desc" }, take, include: stInclude }),
    prisma.shortTermRepayment.findMany({
      where: { personId: opts.personId },
      orderBy: { recordedAt: "desc" },
      take,
      include: { ...stInclude, loan: { select: { loanNumber: true, direction: true } } },
    }),
  ]);
  const items: TransactionItem[] = [
    ...payments.map(
      (p): TransactionItem => ({
        kind: "PAYMENT",
        href: `/contracts/${p.contractId}`,
        id: p.id,
        amount: paise(p.amount),
        paymentDate: fromDbDate(p.paymentDate),
        recordedAt: p.recordedAt,
        method: p.paymentMethod,
        referenceNumber: p.referenceNumber,
        status: p.status,
        contractId: p.contractId,
        contractLabel: formatContractNumber(p.contract.contractNumber),
        correctsPaymentId: p.correctsPaymentId,
        createdBy: p.createdBy.mobileNumber,
        person: p.person,
      }),
    ),
    ...disbursements.map(
      (d): TransactionItem => ({
        kind: "DISBURSEMENT",
        href: `/contracts/${d.contractId}`,
        id: d.id,
        amount: paise(d.amount),
        date: fromDbDate(d.disbursedOn),
        recordedAt: d.createdAt,
        method: d.method,
        referenceNumber: d.referenceNumber,
        status: d.status,
        contractId: d.contractId,
        contractLabel: formatContractNumber(d.contract.contractNumber),
        createdBy: d.createdBy.mobileNumber,
        person: d.person,
      }),
    ),
    ...stLoans.map(
      (l): TransactionItem => ({
        kind: l.direction === "BORROWED" ? "BORROWED" : "SHORT_TERM_GIVEN",
        href: `/short-term/${l.id}`,
        id: l.id,
        amount: paise(l.principalAmount),
        date: fromDbDate(l.givenOn),
        recordedAt: l.createdAt,
        method: l.method,
        referenceNumber: l.referenceNumber,
        status: l.status === "CANCELLED" ? "REVERSED" : "ACTIVE",
        contractLabel: formatShortTermNumber(l.loanNumber, l.direction),
        createdBy: l.createdBy.mobileNumber,
        person: l.person,
      }),
    ),
    ...stRepayments.map(
      (r): TransactionItem => ({
        kind: r.loan.direction === "BORROWED" ? "BORROWING_REPAID" : "SHORT_TERM_REPAYMENT",
        href: `/short-term/${r.loanId}`,
        id: r.id,
        amount: paise(r.amount),
        date: fromDbDate(r.receivedOn),
        recordedAt: r.recordedAt,
        method: r.method,
        referenceNumber: r.referenceNumber,
        status: r.status,
        contractLabel: formatShortTermNumber(r.loan.loanNumber, r.loan.direction),
        createdBy: r.createdBy.mobileNumber,
        person: r.person,
      }),
    ),
  ];
  return items.sort((a, b) => b.recordedAt.getTime() - a.recordedAt.getTime()).slice(0, take);
}

/** Chronological ledger for a person's statement. */
export async function getPersonLedger(personId: string) {
  const rows = await prisma.ledgerEntry.findMany({
    where: { personId },
    orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }],
    include: { contract: { select: { contractNumber: true } }, shortTermLoan: { select: { loanNumber: true, direction: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    date: fromDbDate(r.effectiveDate),
    type: r.entryType,
    amount: paise(r.amount),
    memoAmount: r.memoAmount === null ? null : paise(r.memoAmount),
    description: r.description,
    contractLabel: r.contract ? formatContractNumber(r.contract.contractNumber) : formatShortTermNumber(r.shortTermLoan!.loanNumber, r.shortTermLoan!.direction),
    contractId: r.contractId,
    href: r.contractId ? `/contracts/${r.contractId}` : `/short-term/${r.shortTermLoanId}`,
  }));
}

// ─────────────────────────── Single-contract summary (engine) ───────────────────────────

/** One contract's numbers straight from summarizeContract — the reference the SQL above is tested against. */
export async function getContractSummary(contractId: string, opts: { now?: Date } = {}): Promise<ContractSummary> {
  const bn = businessNow(await getSettings(), opts.now);
  const [contract, schedules, paid] = await Promise.all([
    prisma.contract.findUniqueOrThrow({ where: { id: contractId }, select: { principalAmount: true, expectedCollectionAmount: true } }),
    prisma.collectionSchedule.findMany({
      where: { contractId },
      select: { scheduledDate: true, expectedAmount: true, allocatedAmount: true, status: true, missedAt: true },
    }),
    prisma.payment.aggregate({ where: { contractId, status: "ACTIVE" }, _sum: { amount: true } }),
  ]);
  return summarizeContract(
    {
      principalAmount: paise(contract.principalAmount),
      expectedCollectionAmount: paise(contract.expectedCollectionAmount),
      activePaymentsTotal: paise(paid._sum.amount ?? 0),
      schedules: schedules.map((s) => ({
        scheduledDate: fromDbDate(s.scheduledDate),
        expectedAmount: paise(s.expectedAmount),
        allocatedAmount: paise(s.allocatedAmount),
        status: s.status as ScheduleStatus,
        missedAt: s.missedAt?.toISOString() ?? null,
      })),
    },
    { today: bn.today, closedThrough: bn.closedThrough },
  );
}
