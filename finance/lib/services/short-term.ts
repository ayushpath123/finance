import "server-only";
import { prisma, TX_OPTIONS, type Tx } from "@/lib/db/client";
import { compareDates, fromDbDate, toDbDate } from "@/lib/finance/dates";
import { formatINR, paise, type Paise } from "@/lib/finance/money";
import { planRepayment, planSettlement, shortTermState, ShortTermError, validateShortTermTerms, type ShortTermState } from "@/lib/finance/short-term";
import type { ShortTermLoan, ShortTermRepayment } from "@/lib/generated/prisma/client";
import type {
  ShortTermCancellationInput,
  ShortTermLoanInput,
  ShortTermRepaymentInput,
  ShortTermRepaymentReversalInput,
  ShortTermSettlementInput,
} from "@/lib/validation/schemas";
import { requireUserActor, type Actor, type ServiceOptions } from "./actor";
import { writeAudit } from "./audit";
import { DomainError, isUniqueViolation } from "./errors";
import { businessNow, getSettings, type BusinessNow } from "./settings";

/**
 * Short-term loans: money given now, principal + a fixed interest amount comes
 * back whenever — in one go or in parts. Every change is one transaction with
 * the loan row locked, its ledger entry and its audit event. The database
 * re-checks the balance rules at COMMIT (see migration 20261005000000).
 */

/** ST-0003 for money you lent, BR-0004 for money you borrowed (one shared number sequence). */
export const formatShortTermNumber = (n: number, direction: "LENT" | "BORROWED" = "LENT") =>
  `${direction === "BORROWED" ? "BR" : "ST"}-${String(n).padStart(4, "0")}`;

/**
 * Ledger entry types and cash signs (lender's-cash perspective) per direction.
 * LENT: money out −, back in +.  BORROWED: money in +, paid back −.
 */
const LEDGER = {
  LENT: { start: "SHORT_TERM_GIVEN", cancel: "SHORT_TERM_CANCELLED", repay: "SHORT_TERM_REPAYMENT", reverse: "SHORT_TERM_REPAYMENT_REVERSAL", startSign: -1 },
  BORROWED: { start: "BORROWING_RECEIVED", cancel: "BORROWING_CANCELLED", repay: "BORROWING_REPAID", reverse: "BORROWING_REPAID_REVERSAL", startSign: 1 },
} as const;

const words = (d: "LENT" | "BORROWED") =>
  d === "BORROWED"
    ? { started: "borrowed from", back: "paid back on", toCome: "to pay back", forgiven: "let off by the lender" }
    : { started: "given to", back: "received back on", toCome: "to come back", forgiven: "let go" };

const wrapTermsError = (err: unknown): never => {
  if (err instanceof ShortTermError) throw new DomainError("INVALID_INPUT", err.message, { field: err.field });
  throw err;
};

async function lockLoan(tx: Tx, loanId: string): Promise<ShortTermLoan> {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "short_term_loans" WHERE "id" = ${loanId}::uuid FOR UPDATE`;
  if (rows.length === 0) throw new DomainError("NOT_FOUND", "Loan not found");
  return tx.shortTermLoan.findUniqueOrThrow({ where: { id: loanId } });
}

async function receivedTotal(tx: Tx, loanId: string): Promise<Paise> {
  const agg = await tx.shortTermRepayment.aggregate({ where: { loanId, status: "ACTIVE" }, _sum: { amount: true } });
  return paise(agg._sum.amount ?? 0);
}

async function stateOf(tx: Tx, loan: ShortTermLoan): Promise<ShortTermState> {
  return shortTermState({
    principalAmount: paise(loan.principalAmount),
    interestAmount: paise(loan.interestAmount),
    receivedTotal: await receivedTotal(tx, loan.id),
    waivedAmount: loan.waivedAmount === null ? null : paise(loan.waivedAmount),
    status: loan.status,
  });
}

// ─────────────────────────── Give money ───────────────────────────

export async function createShortTermLoan(input: ShortTermLoanInput, actor: Actor, opts: ServiceOptions = {}) {
  requireUserActor(actor);
  const existing = await prisma.shortTermLoan.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return { loan: existing, duplicate: true };

  let totalDue: Paise;
  try {
    ({ totalDue } = validateShortTermTerms(input));
  } catch (err) {
    return wrapTermsError(err);
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const bn = businessNow(await getSettings(tx), opts.now);
      if (compareDates(input.givenOn, bn.today) > 0) {
        throw new DomainError("INVALID_INPUT", "The date given can't be in the future", { field: "givenOn" });
      }
      const person = await tx.person.findUnique({ where: { id: input.personId } });
      if (!person || person.deletedAt) throw new DomainError("NOT_FOUND", "Person not found");

      const loan = await tx.shortTermLoan.create({
        data: {
          personId: person.id,
          direction: input.direction,
          principalAmount: input.principalAmount,
          interestAmount: input.interestAmount,
          givenOn: toDbDate(input.givenOn),
          method: input.method,
          referenceNumber: input.referenceNumber,
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
          createdById: actor.userId,
          createdAt: bn.now,
        },
      });
      const label = formatShortTermNumber(loan.loanNumber, loan.direction);
      const w = words(loan.direction);
      await tx.ledgerEntry.create({
        data: {
          personId: person.id,
          shortTermLoanId: loan.id,
          entryType: LEDGER[loan.direction].start,
          amount: LEDGER[loan.direction].startSign * input.principalAmount,
          effectiveDate: toDbDate(input.givenOn),
          description: `${formatINR(input.principalAmount)} ${w.started} ${person.fullName} (${label}), ${formatINR(input.interestAmount)} interest agreed`,
          createdAt: bn.now,
        },
      });
      await writeAudit(
        tx,
        actor,
        {
          action: "SHORT_TERM_LOAN_CREATED",
          entityType: "ShortTermLoan",
          entityId: loan.id,
          personId: person.id,
          description: `${label}: ${formatINR(input.principalAmount)} ${loan.direction === "BORROWED" ? "borrowed" : "given"} + ${formatINR(input.interestAmount)} interest = ${formatINR(totalDue)} ${w.toCome}`,
          after: loan,
          metadata: { direction: loan.direction },
        },
        bn.now,
      );
      return { loan, duplicate: false };
    }, TX_OPTIONS);
  } catch (err) {
    if (isUniqueViolation(err, "idempotencyKey")) {
      const again = await prisma.shortTermLoan.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (again) return { loan: again, duplicate: true };
    }
    throw err;
  }
}

// ─────────────────────────── Money back ───────────────────────────

async function insertRepaymentTx(
  tx: Tx,
  loan: ShortTermLoan,
  data: { amount: Paise; receivedOn: string; method: ShortTermRepaymentInput["method"]; referenceNumber?: string; notes?: string; idempotencyKey: string },
  actor: Actor & { userId: string },
  bn: BusinessNow,
): Promise<ShortTermRepayment> {
  const repayment = await tx.shortTermRepayment.create({
    data: {
      loanId: loan.id,
      personId: loan.personId,
      amount: data.amount,
      receivedOn: toDbDate(data.receivedOn as never),
      recordedAt: bn.now,
      method: data.method,
      referenceNumber: data.referenceNumber,
      notes: data.notes,
      idempotencyKey: data.idempotencyKey,
      createdById: actor.userId,
    },
  });
  const label = formatShortTermNumber(loan.loanNumber, loan.direction);
  const w = words(loan.direction);
  await tx.ledgerEntry.create({
    data: {
      personId: loan.personId,
      shortTermLoanId: loan.id,
      shortTermRepaymentId: repayment.id,
      entryType: LEDGER[loan.direction].repay,
      amount: -LEDGER[loan.direction].startSign * data.amount,
      effectiveDate: repayment.receivedOn,
      description: `${formatINR(data.amount)} ${w.back} ${label} by ${data.method}`,
      createdAt: bn.now,
    },
  });
  await writeAudit(
    tx,
    actor,
    {
      action: "SHORT_TERM_REPAYMENT_RECORDED",
      entityType: "ShortTermRepayment",
      entityId: repayment.id,
      personId: loan.personId,
      description: `${formatINR(data.amount)} ${w.back} ${label} dated ${data.receivedOn}`,
      after: repayment,
      metadata: { loanId: loan.id },
    },
    bn.now,
  );
  return repayment;
}

function checkRepaymentDate(loan: ShortTermLoan, receivedOn: string, bn: BusinessNow) {
  if (compareDates(receivedOn as never, bn.today) > 0) throw new DomainError("INVALID_INPUT", "Date can't be in the future", { field: "receivedOn" });
  if (compareDates(receivedOn as never, fromDbDate(loan.givenOn)) < 0) {
    throw new DomainError("INVALID_INPUT", "Date can't be before the money was given", { field: "receivedOn" });
  }
}

async function closeTx(tx: Tx, loan: ShortTermLoan, on: string, waived: Paise, note: string | undefined, actor: Actor & { userId: string }, bn: BusinessNow) {
  const closed = await tx.shortTermLoan.update({
    where: { id: loan.id },
    data: {
      status: "CLOSED",
      closedOn: toDbDate(on as never),
      closedAt: bn.now,
      closedById: actor.userId,
      waivedAmount: waived > 0 ? waived : null,
      closeNote: note ?? null,
    },
  });
  const label = formatShortTermNumber(loan.loanNumber, loan.direction);
  await writeAudit(
    tx,
    actor,
    {
      action: "SHORT_TERM_LOAN_CLOSED",
      entityType: "ShortTermLoan",
      entityId: loan.id,
      personId: loan.personId,
      description: waived > 0 ? `${label} settled and closed; ${formatINR(waived)} ${words(loan.direction).forgiven}${note ? ` — ${note}` : ""}` : `${label} fully repaid and closed`,
      before: { status: loan.status },
      after: { status: "CLOSED", closedOn: on, waivedAmount: waived > 0 ? waived : null },
    },
    bn.now,
  );
  return closed;
}

/** Records money back. Closes the loan automatically once principal + interest is fully back. */
export async function recordShortTermRepayment(input: ShortTermRepaymentInput, actor: Actor, opts: ServiceOptions = {}) {
  requireUserActor(actor);
  const replay = await prisma.shortTermRepayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.loanId !== input.loanId || replay.amount !== input.amount) {
      throw new DomainError("IDEMPOTENCY_CONFLICT", "This submission key was already used for a different repayment");
    }
    const loan = await prisma.shortTermLoan.findUniqueOrThrow({ where: { id: replay.loanId } });
    return { repayment: replay, loan, closed: false, duplicate: true };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const bn = businessNow(await getSettings(tx), opts.now);
      const loan = await lockLoan(tx, input.loanId);
      if (loan.status !== "OPEN") throw new DomainError("INVALID_STATE", `This loan is ${loan.status.toLowerCase()}`);
      checkRepaymentDate(loan, input.receivedOn, bn);

      const plan = planRepayment(await stateOf(tx, loan), input.amount);
      if (!plan.ok) throw new DomainError("INVALID_INPUT", plan.error, { field: "amount" });

      const repayment = await insertRepaymentTx(tx, loan, input, actor, bn);
      const after = plan.closes ? await closeTx(tx, loan, input.receivedOn, paise(0), undefined, actor, bn) : loan;
      return { repayment, loan: after, closed: plan.closes, duplicate: false };
    }, TX_OPTIONS);
  } catch (err) {
    if (isUniqueViolation(err, "idempotencyKey")) {
      const again = await prisma.shortTermRepayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (again) return { repayment: again, loan: await prisma.shortTermLoan.findUniqueOrThrow({ where: { id: again.loanId } }), closed: false, duplicate: true };
    }
    throw err;
  }
}

/**
 * Close now: take `finalAmount` (₹0 allowed) and let the rest go — e.g. the
 * borrower returned the principal and you forgave the interest. The waived
 * amount is recorded on the loan and in the audit log.
 */
export async function settleShortTermLoan(input: ShortTermSettlementInput, actor: Actor, opts: ServiceOptions = {}) {
  requireUserActor(actor);
  return prisma.$transaction(async (tx) => {
    const bn = businessNow(await getSettings(tx), opts.now);
    const loan = await lockLoan(tx, input.loanId);
    if (loan.status !== "OPEN") throw new DomainError("INVALID_STATE", `This loan is ${loan.status.toLowerCase()}`);
    checkRepaymentDate(loan, input.receivedOn, bn);
    const plan = planSettlement(await stateOf(tx, loan), input.finalAmount);
    if (!plan.ok) throw new DomainError("INVALID_INPUT", plan.error, { field: "finalAmount" });
    if (plan.waived > 0 && !input.note) {
      throw new DomainError("INVALID_INPUT", "Add a note explaining why the rest is being let go", { field: "note" });
    }
    if (input.finalAmount > 0) {
      const dup = await tx.shortTermRepayment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
      if (dup) throw new DomainError("IDEMPOTENCY_CONFLICT", "This settlement was already submitted");
      await insertRepaymentTx(tx, loan, { ...input, amount: input.finalAmount, notes: input.note }, actor, bn);
    }
    const closed = await closeTx(tx, loan, input.receivedOn, plan.waived, input.note, actor, bn);
    return { loan: closed, waived: plan.waived };
  }, TX_OPTIONS);
}

/** Undo a wrongly entered repayment. A closed loan reopens (its settlement is undone too). */
export async function reverseShortTermRepayment(input: ShortTermRepaymentReversalInput, actor: Actor, opts: ServiceOptions = {}) {
  requireUserActor(actor);
  return prisma.$transaction(async (tx) => {
    const bn = businessNow(await getSettings(tx), opts.now);
    const found = await tx.shortTermRepayment.findUnique({ where: { id: input.repaymentId }, select: { loanId: true } });
    if (!found) throw new DomainError("NOT_FOUND", "Repayment not found");
    const loan = await lockLoan(tx, found.loanId);
    const before = await tx.shortTermRepayment.findUniqueOrThrow({ where: { id: input.repaymentId } });
    if (before.status === "REVERSED") throw new DomainError("INVALID_STATE", "This repayment has already been reversed");

    const after = await tx.shortTermRepayment.update({
      where: { id: before.id },
      data: { status: "REVERSED", reversedAt: bn.now, reversedById: actor.userId, reversalReason: input.reason },
    });
    const label = formatShortTermNumber(loan.loanNumber, loan.direction);
    await tx.ledgerEntry.create({
      data: {
        personId: loan.personId,
        shortTermLoanId: loan.id,
        shortTermRepaymentId: before.id,
        entryType: LEDGER[loan.direction].reverse,
        amount: LEDGER[loan.direction].startSign * before.amount,
        effectiveDate: toDbDate(bn.today),
        description: `Reversal of ${formatINR(paise(before.amount))} ${words(loan.direction).back} ${label}: ${input.reason}`,
        createdAt: bn.now,
      },
    });
    const audits: Parameters<typeof writeAudit>[2] = [
      {
        action: "SHORT_TERM_REPAYMENT_REVERSED",
        entityType: "ShortTermRepayment",
        entityId: before.id,
        personId: loan.personId,
        description: `Reversed ${formatINR(paise(before.amount))} on ${label}: ${input.reason}`,
        before,
        after,
      },
    ];
    let reopened = false;
    if (loan.status === "CLOSED") {
      await tx.shortTermLoan.update({
        where: { id: loan.id },
        data: { status: "OPEN", closedOn: null, closedAt: null, closedById: null, waivedAmount: null, closeNote: null },
      });
      reopened = true;
      audits.push({
        action: "SHORT_TERM_LOAN_REOPENED",
        entityType: "ShortTermLoan",
        entityId: loan.id,
        personId: loan.personId,
        description: `${label} reopened after a repayment was reversed`,
        before: { status: "CLOSED", closedOn: loan.closedOn, waivedAmount: loan.waivedAmount },
        after: { status: "OPEN" },
      });
    }
    await writeAudit(tx, actor, audits, bn.now);
    return { repayment: after, reopened };
  }, TX_OPTIONS);
}

/** Loan entered by mistake. Only possible while nothing has been received on it. */
export async function cancelShortTermLoan(input: ShortTermCancellationInput, actor: Actor, opts: ServiceOptions = {}) {
  requireUserActor(actor);
  return prisma.$transaction(async (tx) => {
    const bn = businessNow(await getSettings(tx), opts.now);
    const loan = await lockLoan(tx, input.loanId);
    if (loan.status !== "OPEN") throw new DomainError("INVALID_STATE", `A ${loan.status.toLowerCase()} loan can't be cancelled`);
    if ((await receivedTotal(tx, loan.id)) > 0) {
      throw new DomainError("INVALID_STATE", "Money has already been received on this loan. Reverse those repayments first.");
    }
    const after = await tx.shortTermLoan.update({
      where: { id: loan.id },
      data: { status: "CANCELLED", cancelledAt: bn.now, cancelledById: actor.userId, cancelReason: input.reason },
    });
    const label = formatShortTermNumber(loan.loanNumber, loan.direction);
    await tx.ledgerEntry.create({
      data: {
        personId: loan.personId,
        shortTermLoanId: loan.id,
        entryType: LEDGER[loan.direction].cancel,
        amount: -LEDGER[loan.direction].startSign * loan.principalAmount,
        effectiveDate: toDbDate(bn.today),
        description: `${label} cancelled (entered by mistake): ${input.reason}`,
        createdAt: bn.now,
      },
    });
    await writeAudit(
      tx,
      actor,
      {
        action: "SHORT_TERM_LOAN_CANCELLED",
        entityType: "ShortTermLoan",
        entityId: loan.id,
        personId: loan.personId,
        description: `${label} cancelled: ${input.reason}`,
        before: { status: loan.status },
        after: { status: after.status },
      },
      bn.now,
    );
    return after;
  }, TX_OPTIONS);
}
