import "server-only";
import { prisma } from "@/lib/db/client";
import { toDbDate, type BusinessDate } from "@/lib/finance/dates";
import { paise, type Paise } from "@/lib/finance/money";
import { ageing, netByPerson, overallPosition, type AgeBucket, type PersonNet, type Position } from "@/lib/finance/settlement";
import type { ShortTermDirection, ShortTermLoanStatus } from "@/lib/generated/prisma/client";
import { contractAggregates } from "./read-models";
import type { BusinessNow } from "./settings";
import { shortTermLoans, type ShortTermLoanItem } from "./short-term-read";

/**
 * Settlement read models — all derived from the same facts the rest of the app
 * uses (contract aggregates + short-term loans/repayments). Nothing stored.
 */

const monthStart = (today: BusinessDate) => toDbDate(`${today.slice(0, 7)}-01` as BusinessDate);
const sumOf = (agg: { _sum: { amount?: number | null; principalAmount?: number | null } }) => paise(agg._sum.amount ?? agg._sum.principalAmount ?? 0);

export interface MonthFlows {
  /** First day of the current business month. */
  from: BusinessDate;
  contracts: { given: Paise; collected: Paise };
  lent: { given: Paise; back: Paise };
  borrowed: { received: Paise; paidBack: Paise };
  /** All money in − all money out this month (cash view). */
  moneyIn: Paise;
  moneyOut: Paise;
}

export async function monthFlows(bn: BusinessNow): Promise<MonthFlows> {
  const from = monthStart(bn.today);
  const [disbursed, collected, lentGiven, lentBack, borrowedIn, paidBack] = await Promise.all([
    prisma.disbursement.aggregate({ where: { status: "ACTIVE", disbursedOn: { gte: from } }, _sum: { amount: true } }),
    prisma.payment.aggregate({ where: { status: "ACTIVE", paymentDate: { gte: from } }, _sum: { amount: true } }),
    prisma.shortTermLoan.aggregate({ where: { direction: "LENT", status: { not: "CANCELLED" }, givenOn: { gte: from } }, _sum: { principalAmount: true } }),
    prisma.shortTermRepayment.aggregate({ where: { status: "ACTIVE", receivedOn: { gte: from }, loan: { direction: "LENT" } }, _sum: { amount: true } }),
    prisma.shortTermLoan.aggregate({ where: { direction: "BORROWED", status: { not: "CANCELLED" }, givenOn: { gte: from } }, _sum: { principalAmount: true } }),
    prisma.shortTermRepayment.aggregate({ where: { status: "ACTIVE", receivedOn: { gte: from }, loan: { direction: "BORROWED" } }, _sum: { amount: true } }),
  ]);
  const f = {
    contracts: { given: sumOf(disbursed), collected: sumOf(collected) },
    lent: { given: sumOf(lentGiven), back: sumOf(lentBack) },
    borrowed: { received: sumOf(borrowedIn), paidBack: sumOf(paidBack) },
  };
  return {
    from: `${bn.today.slice(0, 7)}-01` as BusinessDate,
    ...f,
    moneyIn: paise(f.contracts.collected + f.lent.back + f.borrowed.received),
    moneyOut: paise(f.contracts.given + f.lent.given + f.borrowed.paidBack),
  };
}

export interface PersonNetRow extends PersonNet {
  slug: string;
  fullName: string;
  phoneNumber: string;
}

export async function getSettlementOverview(bn: BusinessNow): Promise<{
  position: Position;
  people: PersonNetRow[];
  ageingLent: AgeBucket[];
  ageingBorrowed: AgeBucket[];
  month: MonthFlows;
  openLent: number;
  openBorrowed: number;
}> {
  const [aggs, loans, month] = await Promise.all([contractAggregates({}, bn), shortTermLoans({ status: "OPEN" }, bn), monthFlows(bn)]);
  const contractOutstandingByPerson = new Map<string, Paise>();
  for (const a of aggs) contractOutstandingByPerson.set(a.personId, paise((contractOutstandingByPerson.get(a.personId) ?? 0) + a.outstanding));
  const input = { contractOutstandingByPerson, loans };
  const nets = netByPerson(input);
  const people = await prisma.person.findMany({
    where: { id: { in: nets.map((n) => n.personId) } },
    select: { id: true, slug: true, fullName: true, phoneNumber: true },
  });
  const byId = new Map(people.map((p) => [p.id, p]));
  return {
    position: overallPosition(input),
    people: nets.flatMap((n) => {
      const p = byId.get(n.personId);
      return p ? [{ ...n, slug: p.slug, fullName: p.fullName, phoneNumber: p.phoneNumber }] : [];
    }),
    ageingLent: ageing(loans, "LENT", bn.today),
    ageingBorrowed: ageing(loans, "BORROWED", bn.today),
    month,
    openLent: loans.filter((l) => l.direction === "LENT").length,
    openBorrowed: loans.filter((l) => l.direction === "BORROWED").length,
  };
}

export interface BookRow extends ShortTermLoanItem {
  personName: string;
  personSlug: string;
}

/** One direction's book (Lending or Borrowing page). */
export async function getShortTermBook(direction: ShortTermDirection, status: ShortTermLoanStatus, bn: BusinessNow) {
  const [rows, open, month] = await Promise.all([shortTermLoans({ direction, status }, bn), shortTermLoans({ direction, status: "OPEN" }, bn), monthFlows(bn)]);
  const people = await prisma.person.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.personId))] } },
    select: { id: true, slug: true, fullName: true },
  });
  const byId = new Map(people.map((p) => [p.id, p]));
  const s = (f: (l: ShortTermLoanItem) => number) => paise(open.reduce((t, l) => t + f(l), 0));
  return {
    rows: rows.map((r): BookRow => ({ ...r, personName: byId.get(r.personId)?.fullName ?? "—", personSlug: byId.get(r.personId)?.slug ?? "" })),
    totals: {
      open: open.length,
      outstanding: s((l) => l.outstanding),
      principalOutstanding: s((l) => l.principalOutstanding),
      interestOutstanding: s((l) => l.interestOutstanding),
      people: new Set(open.map((l) => l.personId)).size,
      oldestDays: open.reduce((m, l) => Math.max(m, l.days), 0),
    },
    ageing: ageing(open, direction, bn.today),
    month: direction === "LENT" ? { out: month.lent.given, in: month.lent.back } : { in: month.borrowed.received, out: month.borrowed.paidBack },
    monthFrom: month.from,
  };
}
