/**
 * Overall settlement position — pure arithmetic over already-derived numbers.
 * Receivable = what others owe you (daily contracts + short-term money you lent).
 * Payable    = what you owe others (money you borrowed).
 * Net        = receivable − payable: positive → you will receive more than you pay.
 */
import { diffDays, type BusinessDate } from "./dates";
import { paise, type Paise } from "./money";

export interface OpenLoanFacts {
  direction: "LENT" | "BORROWED";
  status: "OPEN" | "CLOSED" | "CANCELLED";
  personId: string;
  givenOn: BusinessDate;
  outstanding: Paise;
  principalOutstanding: Paise;
  interestOutstanding: Paise;
}

export interface PositionInput {
  /** Per person: outstanding on their daily contracts (owed to you). */
  contractOutstandingByPerson: ReadonlyMap<string, Paise>;
  loans: readonly OpenLoanFacts[];
}

export interface Position {
  receivable: { contracts: Paise; lentPrincipal: Paise; lentInterest: Paise; total: Paise };
  payable: { borrowedPrincipal: Paise; borrowedInterest: Paise; total: Paise };
  /** receivable − payable */
  net: Paise;
  /** Interest still to earn (lent) − interest still to pay (borrowed). */
  netInterest: Paise;
}

const sum = (xs: Iterable<number>) => {
  let t = 0;
  for (const x of xs) t += x;
  return paise(t);
};

export function overallPosition({ contractOutstandingByPerson, loans }: PositionInput): Position {
  const open = loans.filter((l) => l.status === "OPEN");
  const lent = open.filter((l) => l.direction === "LENT");
  const borrowed = open.filter((l) => l.direction === "BORROWED");
  const contracts = sum(contractOutstandingByPerson.values());
  const lentPrincipal = sum(lent.map((l) => l.principalOutstanding));
  const lentInterest = sum(lent.map((l) => l.interestOutstanding));
  const borrowedPrincipal = sum(borrowed.map((l) => l.principalOutstanding));
  const borrowedInterest = sum(borrowed.map((l) => l.interestOutstanding));
  const receivable = paise(contracts + lentPrincipal + lentInterest);
  const payable = paise(borrowedPrincipal + borrowedInterest);
  return {
    receivable: { contracts, lentPrincipal, lentInterest, total: receivable },
    payable: { borrowedPrincipal, borrowedInterest, total: payable },
    net: paise(receivable - payable),
    netInterest: paise(lentInterest - borrowedInterest),
  };
}

export interface PersonNet {
  personId: string;
  /** Contracts + short-term lent, still outstanding. */
  theyOweMe: Paise;
  /** Borrowings still to pay back. */
  iOweThem: Paise;
  /** theyOweMe − iOweThem: positive → they owe you overall. */
  net: Paise;
}

/** Who owes whom after BOTH directions, per person. Only people with something open. Largest first. */
export function netByPerson({ contractOutstandingByPerson, loans }: PositionInput): PersonNet[] {
  const owe = new Map<string, { theyOweMe: number; iOweThem: number }>();
  const get = (id: string) => owe.get(id) ?? owe.set(id, { theyOweMe: 0, iOweThem: 0 }).get(id)!;
  for (const [id, amt] of contractOutstandingByPerson) if (amt > 0) get(id).theyOweMe += amt;
  for (const l of loans) {
    if (l.status !== "OPEN" || l.outstanding <= 0) continue;
    if (l.direction === "LENT") get(l.personId).theyOweMe += l.outstanding;
    else get(l.personId).iOweThem += l.outstanding;
  }
  return [...owe]
    .map(([personId, v]) => ({ personId, theyOweMe: paise(v.theyOweMe), iOweThem: paise(v.iOweThem), net: paise(v.theyOweMe - v.iOweThem) }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || a.personId.localeCompare(b.personId));
}

export const AGE_BUCKETS = [
  { key: "0-30", label: "Up to 30 days", max: 30 },
  { key: "31-90", label: "31–90 days", max: 90 },
  { key: "91-180", label: "3–6 months", max: 180 },
  { key: "180+", label: "Over 6 months", max: Infinity },
] as const;

export interface AgeBucket {
  key: (typeof AGE_BUCKETS)[number]["key"];
  label: string;
  count: number;
  outstanding: Paise;
}

/** How long open money has been out (lent) or owed (borrowed). */
export function ageing(loans: readonly OpenLoanFacts[], direction: "LENT" | "BORROWED", today: BusinessDate): AgeBucket[] {
  const buckets: AgeBucket[] = AGE_BUCKETS.map((b) => ({ key: b.key, label: b.label, count: 0, outstanding: paise(0) }));
  for (const l of loans) {
    if (l.status !== "OPEN" || l.direction !== direction) continue;
    const days = Math.max(0, diffDays(today, l.givenOn));
    const i = AGE_BUCKETS.findIndex((b) => days <= b.max);
    buckets[i].count++;
    buckets[i].outstanding = paise(buckets[i].outstanding + l.outstanding);
  }
  return buckets;
}
