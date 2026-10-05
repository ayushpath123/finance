"use server";

import { revalidatePath } from "next/cache";
import { adminActorOrRedirect } from "@/lib/auth/dal";
import { fromDbDate } from "@/lib/finance/dates";
import { paise } from "@/lib/finance/money";
import { findPerson } from "@/lib/services/read-models";
import { businessNow, getSettings } from "@/lib/services/settings";
import { shortTermLoans } from "@/lib/services/short-term-read";
import {
  cancelShortTermLoan,
  createShortTermLoan,
  formatShortTermNumber,
  recordShortTermRepayment,
  reverseShortTermRepayment,
  settleShortTermLoan,
} from "@/lib/services/short-term";
import {
  shortTermCancellationSchema,
  shortTermLoanInputSchema,
  shortTermRepaymentReversalSchema,
  shortTermRepaymentSchema,
  shortTermSettlementSchema,
} from "@/lib/validation/schemas";
import { failure, zodFailure, type FormFailure } from "./forms";

const field = (fd: FormData, k: string) => fd.get(k) ?? undefined;

export type CreateShortTermState =
  | { ok: true; loan: { id: string; label: string; direction: "LENT" | "BORROWED"; principal: number; interest: number; givenOn: string; personSlug: string } }
  | FormFailure;

export async function createShortTermLoanAction(personKey: string, fd: FormData): Promise<CreateShortTermState> {
  const { actor } = await adminActorOrRedirect();
  const person = await findPerson(personKey);
  if (!person) return { ok: false, error: "Person not found." };
  const parsed = shortTermLoanInputSchema.safeParse({
    personId: person.id,
    direction: fd.get("direction") === "BORROWED" ? "BORROWED" : "LENT",
    principalAmount: field(fd, "principalAmount"),
    interestAmount: field(fd, "interestAmount") || "0",
    givenOn: field(fd, "givenOn"),
    method: field(fd, "method"),
    referenceNumber: field(fd, "referenceNumber"),
    notes: field(fd, "notes"),
    idempotencyKey: field(fd, "idempotencyKey"),
  });
  if (!parsed.success) return zodFailure(parsed.error);
  try {
    const { loan } = await createShortTermLoan(parsed.data, actor);
    revalidatePath(`/people/${person.slug}`);
    return {
      ok: true,
      loan: {
        id: loan.id,
        label: formatShortTermNumber(loan.loanNumber, loan.direction),
        direction: loan.direction,
        principal: paise(loan.principalAmount),
        interest: paise(loan.interestAmount),
        givenOn: fromDbDate(loan.givenOn),
        personSlug: person.slug,
      },
    };
  } catch (err) {
    return failure(err, "create short-term loan");
  }
}

export type ShortTermMoneyBackState = { ok: true; amount: number; closed: boolean; waived: number; duplicate: boolean; outstandingAfter: number } | FormFailure;

async function outstandingOf(loanId: string) {
  const [l] = await shortTermLoans({ loanIds: [loanId] }, businessNow(await getSettings()));
  return l?.outstanding ?? 0;
}

/**
 * Money back. mode=settle closes the loan now and lets any remainder go (with a note).
 * No revalidatePath here: re-rendering the loan page mid-action would unmount the
 * confirmation. The form refreshes the page when the user taps "Done".
 */
export async function shortTermMoneyBackAction(fd: FormData): Promise<ShortTermMoneyBackState> {
  const { actor } = await adminActorOrRedirect();
  const loanId = String(fd.get("loanId") ?? "");
  try {
    if (fd.get("mode") === "settle") {
      const parsed = shortTermSettlementSchema.safeParse({
        loanId,
        finalAmount: field(fd, "amount") || "0",
        receivedOn: field(fd, "receivedOn"),
        method: field(fd, "method"),
        referenceNumber: field(fd, "referenceNumber"),
        note: field(fd, "notes"),
        idempotencyKey: field(fd, "idempotencyKey"),
      });
      if (!parsed.success) return zodFailure(parsed.error);
      const r = await settleShortTermLoan(parsed.data, actor);
      return { ok: true, amount: parsed.data.finalAmount, closed: true, waived: r.waived, duplicate: false, outstandingAfter: 0 };
    }
    const parsed = shortTermRepaymentSchema.safeParse({
      loanId,
      amount: field(fd, "amount"),
      receivedOn: field(fd, "receivedOn"),
      method: field(fd, "method"),
      referenceNumber: field(fd, "referenceNumber"),
      notes: field(fd, "notes"),
      idempotencyKey: field(fd, "idempotencyKey"),
    });
    if (!parsed.success) return zodFailure(parsed.error);
    const r = await recordShortTermRepayment(parsed.data, actor);
    return { ok: true, amount: r.repayment.amount, closed: r.closed, waived: 0, duplicate: r.duplicate, outstandingAfter: await outstandingOf(loanId) };
  } catch (err) {
    return failure(err, "short-term money back");
  }
}

export type SimpleState = { ok: true; message: string } | FormFailure | { ok?: undefined };

export async function reverseShortTermRepaymentAction(_prev: SimpleState, fd: FormData): Promise<SimpleState> {
  const { actor } = await adminActorOrRedirect();
  const parsed = shortTermRepaymentReversalSchema.safeParse({ repaymentId: fd.get("repaymentId"), reason: fd.get("reason") });
  if (!parsed.success) return zodFailure(parsed.error);
  try {
    const r = await reverseShortTermRepayment(parsed.data, actor);
    revalidatePath("/", "layout");
    return { ok: true, message: r.reopened ? "Repayment reversed. The loan is open again." : "Repayment reversed." };
  } catch (err) {
    return failure(err, "reverse short-term repayment");
  }
}

export async function cancelShortTermLoanAction(_prev: SimpleState, fd: FormData): Promise<SimpleState> {
  const { actor } = await adminActorOrRedirect();
  const parsed = shortTermCancellationSchema.safeParse({ loanId: fd.get("loanId"), reason: fd.get("reason") });
  if (!parsed.success) return zodFailure(parsed.error);
  try {
    await cancelShortTermLoan(parsed.data, actor);
    revalidatePath("/", "layout");
    return { ok: true, message: "Loan cancelled." };
  } catch (err) {
    return failure(err, "cancel short-term loan");
  }
}
