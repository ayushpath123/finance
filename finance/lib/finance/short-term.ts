/**
 * Short-term loans — pure arithmetic, no I/O.
 *
 * A lump sum is given; the borrower returns principal + a FIXED interest
 * amount agreed up front, whenever (no schedule, no time limit). Money can come
 * back in one go or in parts. The loan closes when everything is back, or
 * when the lender settles for less — the shortfall is recorded as waived.
 */
import { diffDays, type BusinessDate } from "./dates";
import { formatINR, MAX_ROW_PAISE, paise, type Paise } from "./money";

export interface ShortTermTermsInput {
  principalAmount: Paise;
  interestAmount: Paise;
}

export class ShortTermError extends Error {
  constructor(
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "ShortTermError";
  }
}

export function validateShortTermTerms({ principalAmount, interestAmount }: ShortTermTermsInput): { totalDue: Paise } {
  if (!Number.isSafeInteger(principalAmount) || principalAmount <= 0) throw new ShortTermError("Amount given must be more than zero", "principalAmount");
  if (!Number.isSafeInteger(interestAmount) || interestAmount < 0) throw new ShortTermError("Interest can't be negative", "interestAmount");
  const totalDue = principalAmount + interestAmount;
  if (totalDue > MAX_ROW_PAISE) throw new ShortTermError("Amount is too large", "principalAmount");
  return { totalDue: paise(totalDue) };
}

export interface ShortTermState {
  principal: Paise;
  interest: Paise;
  totalDue: Paise;
  received: Paise;
  waived: Paise;
  /** Still to come back (0 once closed or cancelled). */
  outstanding: Paise;
  /** How the money received so far splits: principal first, interest last. */
  principalRecovered: Paise;
  interestRecovered: Paise;
}

export function shortTermState(input: {
  principalAmount: Paise;
  interestAmount: Paise;
  receivedTotal: Paise;
  waivedAmount?: Paise | null;
  status: "OPEN" | "CLOSED" | "CANCELLED";
}): ShortTermState {
  const totalDue = paise(input.principalAmount + input.interestAmount);
  const received = input.receivedTotal;
  const waived = paise(input.waivedAmount ?? 0);
  const outstanding = input.status === "OPEN" ? paise(Math.max(0, totalDue - received)) : paise(0);
  const principalRecovered = paise(Math.min(received, input.principalAmount));
  return {
    principal: input.principalAmount,
    interest: input.interestAmount,
    totalDue,
    received,
    waived,
    outstanding,
    principalRecovered,
    interestRecovered: paise(received - principalRecovered),
  };
}

export type RepaymentPlan =
  | { ok: true; closes: boolean; outstandingAfter: Paise }
  | { ok: false; error: string };

/** Can `amount` be received now? Never more than what's outstanding. */
export function planRepayment(state: ShortTermState, amount: Paise): RepaymentPlan {
  if (!Number.isSafeInteger(amount) || amount <= 0) return { ok: false, error: "Amount must be more than zero" };
  if (amount > state.outstanding) return { ok: false, error: `Only ${formatINR(state.outstanding)} is outstanding on this loan` };
  const after = paise(state.outstanding - amount);
  return { ok: true, closes: after === 0, outstandingAfter: after };
}

/** Settle & close: take `finalAmount` (may be 0) now and let the rest go. */
export function planSettlement(state: ShortTermState, finalAmount: Paise): { ok: true; waived: Paise } | { ok: false; error: string } {
  if (!Number.isSafeInteger(finalAmount) || finalAmount < 0) return { ok: false, error: "Amount can't be negative" };
  if (finalAmount > state.outstanding) return { ok: false, error: "That is more than what is outstanding" };
  return { ok: true, waived: paise(state.outstanding - finalAmount) };
}

/** Days the money has been out (given day = day 0). */
export function daysOutstanding(givenOn: BusinessDate, until: BusinessDate): number {
  return Math.max(0, diffDays(until, givenOn));
}
