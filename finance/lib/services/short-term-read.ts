import "server-only";
import { prisma } from "@/lib/db/client";
import { fromDbDate, type BusinessDate } from "@/lib/finance/dates";
import { paise, type Paise } from "@/lib/finance/money";
import { daysOutstanding, shortTermState } from "@/lib/finance/short-term";
import type { PaymentMethod, ShortTermDirection, ShortTermLoanStatus, TransactionStatus } from "@/lib/generated/prisma/client";
import { formatShortTermNumber } from "./short-term";
import type { BusinessNow } from "./settings";

/** Everything the UI shows about one short-term loan (derived from the loan + its repayments). */
export interface ShortTermLoanItem {
  id: string;
  label: string; // "ST-0003" (lent) or "BR-0004" (borrowed)
  loanNumber: number;
  /** LENT: they owe you. BORROWED: you owe them. */
  direction: ShortTermDirection;
  personId: string;
  status: ShortTermLoanStatus;
  principal: Paise;
  interest: Paise;
  totalDue: Paise;
  received: Paise;
  outstanding: Paise;
  waived: Paise;
  givenOn: BusinessDate;
  closedOn: BusinessDate | null;
  /** Days the money has been out (until today, or until it closed). */
  days: number;
  method: PaymentMethod;
  referenceNumber: string | null;
  notes: string | null;
}

export interface ShortTermTotals {
  open: number;
  given: Paise; // principal of open loans (lent: given out · borrowed: received)
  outstanding: Paise; // lent: still to come back · borrowed: still to pay back
}

export async function shortTermLoans(
  filter: { personIds?: string[]; loanIds?: string[]; status?: ShortTermLoanStatus; direction?: ShortTermDirection },
  bn: BusinessNow,
): Promise<ShortTermLoanItem[]> {
  if ((filter.personIds && filter.personIds.length === 0) || (filter.loanIds && filter.loanIds.length === 0)) return [];
  const loans = await prisma.shortTermLoan.findMany({
    where: {
      ...(filter.personIds ? { personId: { in: filter.personIds } } : {}),
      ...(filter.loanIds ? { id: { in: filter.loanIds } } : {}),
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.direction ? { direction: filter.direction } : {}),
    },
    orderBy: { loanNumber: "desc" },
  });
  if (loans.length === 0) return [];
  const sums = await prisma.shortTermRepayment.groupBy({
    by: ["loanId"],
    where: { loanId: { in: loans.map((l) => l.id) }, status: "ACTIVE" },
    _sum: { amount: true },
  });
  const received = new Map(sums.map((s) => [s.loanId, paise(s._sum.amount ?? 0)]));
  return loans.map((l) => {
    const st = shortTermState({
      principalAmount: paise(l.principalAmount),
      interestAmount: paise(l.interestAmount),
      receivedTotal: received.get(l.id) ?? paise(0),
      waivedAmount: l.waivedAmount === null ? null : paise(l.waivedAmount),
      status: l.status,
    });
    const givenOn = fromDbDate(l.givenOn);
    const closedOn = l.closedOn ? fromDbDate(l.closedOn) : null;
    return {
      id: l.id,
      label: formatShortTermNumber(l.loanNumber, l.direction),
      loanNumber: l.loanNumber,
      direction: l.direction,
      personId: l.personId,
      status: l.status,
      principal: st.principal,
      interest: st.interest,
      totalDue: st.totalDue,
      received: st.received,
      outstanding: st.outstanding,
      waived: st.waived,
      givenOn,
      closedOn,
      days: daysOutstanding(givenOn, closedOn ?? bn.today),
      method: l.method,
      referenceNumber: l.referenceNumber,
      notes: l.notes,
    };
  });
}

/** Totals for ONE direction (default LENT = money owed to you). Lent and borrowed are never netted. */
export function shortTermTotalsOf(loans: readonly ShortTermLoanItem[], direction: ShortTermDirection = "LENT"): ShortTermTotals {
  const open = loans.filter((l) => l.status === "OPEN" && l.direction === direction);
  return {
    open: open.length,
    given: paise(open.reduce((t, l) => t + l.principal, 0)),
    outstanding: paise(open.reduce((t, l) => t + l.outstanding, 0)),
  };
}

export interface ShortTermRepaymentItem {
  id: string;
  amount: Paise;
  receivedOn: BusinessDate;
  recordedAt: Date;
  method: PaymentMethod;
  referenceNumber: string | null;
  notes: string | null;
  status: TransactionStatus;
  reversalReason: string | null;
  createdBy: string;
}

export async function getShortTermDetail(loanId: string, bn: BusinessNow) {
  if (!/^[0-9a-f-]{36}$/i.test(loanId)) return null;
  const [item] = await shortTermLoans({ loanIds: [loanId] }, bn);
  if (!item) return null;
  const [loan, repayments] = await Promise.all([
    prisma.shortTermLoan.findUniqueOrThrow({
      where: { id: loanId },
      include: {
        person: { select: { id: true, slug: true, fullName: true, phoneNumber: true } },
        createdBy: { select: { mobileNumber: true } },
        closedBy: { select: { mobileNumber: true } },
        cancelledBy: { select: { mobileNumber: true } },
      },
    }),
    prisma.shortTermRepayment.findMany({
      where: { loanId },
      orderBy: [{ receivedOn: "desc" }, { recordedAt: "desc" }],
      include: { createdBy: { select: { mobileNumber: true } } },
    }),
  ]);
  return {
    item,
    loan,
    repayments: repayments.map(
      (r): ShortTermRepaymentItem => ({
        id: r.id,
        amount: paise(r.amount),
        receivedOn: fromDbDate(r.receivedOn),
        recordedAt: r.recordedAt,
        method: r.method,
        referenceNumber: r.referenceNumber,
        notes: r.notes,
        status: r.status,
        reversalReason: r.reversalReason,
        createdBy: r.createdBy.mobileNumber,
      }),
    ),
  };
}
