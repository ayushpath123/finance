/**
 * Zod schemas shared by forms (client) and server actions (server).
 * The server ALWAYS re-parses; client parsing is only for UX.
 * Money arrives as rupee strings ("1,500.50") and leaves as integer paise.
 */
import { z } from "zod";
import { MAX_COLLECTION_DAYS } from "@/lib/finance/contract-terms";
import { isBusinessDate, type BusinessDate } from "@/lib/finance/dates";
import { MAX_ROW_PAISE, parseRupees, type Paise } from "@/lib/finance/money";

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v ? v : undefined))
    .optional();

export const rupeesSchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx): Paise => {
    const p = parseRupees(v);
    if (p === null) {
      ctx.addIssue({ code: "custom", message: "Enter a valid amount (up to 2 decimal places)" });
      return z.NEVER;
    }
    return p;
  });

export const positiveRupeesSchema = rupeesSchema.refine((p) => p > 0, "Amount must be greater than zero").refine(
  (p) => p <= MAX_ROW_PAISE,
  "Amount is too large",
);

export const businessDateSchema = z
  .string()
  .refine(isBusinessDate, "Enter a valid date (YYYY-MM-DD)")
  .transform((v) => v as BusinessDate);

export const phoneSchema = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s-]/g, ""))
  .refine((v) => /^\+?\d{10,15}$/.test(v), "Enter a valid phone number");

export const idempotencyKeySchema = z.uuid();

export const paymentMethodSchema = z.enum(["CASH", "UPI", "BANK_TRANSFER", "OTHER"]);

export const personInputSchema = z.object({
  fullName: z.string().trim().min(2, "Name is required").max(120),
  phoneNumber: phoneSchema,
  alternatePhone: z
    .string()
    .trim()
    .transform((v) => (v ? v.replace(/[\s-]/g, "") : undefined))
    .refine((v) => v === undefined || /^\+?\d{10,15}$/.test(v), "Enter a valid phone number")
    .optional(),
  address: optionalText(500),
  notes: optionalText(2000),
});
export type PersonInput = z.output<typeof personInputSchema>;

export const personUpdateSchema = personInputSchema.partial().extend({
  status: z.enum(["ACTIVE", "INACTIVE", "COMPLETED", "DEFAULTED"]).optional(),
});
export type PersonUpdate = z.output<typeof personUpdateSchema>;

export const contractInputSchema = z.object({
  personId: z.uuid(),
  principalAmount: positiveRupeesSchema,
  dailyCollectionAmount: positiveRupeesSchema,
  totalCollectionDays: z.coerce.number().int().min(1).max(MAX_COLLECTION_DAYS),
  startDate: businessDateSchema,
  firstCollectionDate: businessDateSchema,
  disbursementMethod: paymentMethodSchema,
  disbursementReference: optionalText(100),
  /** Defaults to the start date (or today if the start date is in the future). */
  disbursedOn: businessDateSchema.optional(),
  notes: optionalText(2000),
  idempotencyKey: idempotencyKeySchema,
});
export type ContractInput = z.output<typeof contractInputSchema>;

export const paymentInputSchema = z.object({
  contractId: z.uuid(),
  amount: positiveRupeesSchema,
  paymentDate: businessDateSchema,
  paymentMethod: paymentMethodSchema,
  referenceNumber: optionalText(100),
  notes: optionalText(2000),
  idempotencyKey: idempotencyKeySchema,
});
export type PaymentInput = z.output<typeof paymentInputSchema>;

const reasonSchema = z.string().trim().min(3, "Please give a reason").max(500);

export const paymentReversalSchema = z.object({
  paymentId: z.uuid(),
  reason: reasonSchema,
});
export type PaymentReversalInput = z.output<typeof paymentReversalSchema>;

export const paymentCorrectionSchema = paymentInputSchema.extend({
  originalPaymentId: z.uuid(),
  reason: reasonSchema,
});
export type PaymentCorrectionInput = z.output<typeof paymentCorrectionSchema>;

export const contractCancellationSchema = z.object({
  contractId: z.uuid(),
  reason: reasonSchema,
});
export type ContractCancellationInput = z.output<typeof contractCancellationSchema>;

export const contractDefaultSchema = z.object({
  contractId: z.uuid(),
  defaulted: z.boolean(),
  reason: reasonSchema,
});
export type ContractDefaultInput = z.output<typeof contractDefaultSchema>;

export const disbursementReversalSchema = z.object({
  disbursementId: z.uuid(),
  reason: reasonSchema,
});
export type DisbursementReversalInput = z.output<typeof disbursementReversalSchema>;

export const settingsSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  timezone: z.string().refine((tz) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "Unknown timezone"),
  defaultPaymentMethod: paymentMethodSchema,
  dayCutoffTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:mm"),
  defaultAllocationPolicy: z.enum(["OLDEST_FIRST"]),
  notificationPrefs: z.record(z.string(), z.unknown()).default({}),
});
export type SettingsInput = z.output<typeof settingsSchema>;

// ─────────────────────────── Short-term loans ───────────────────────────

const nonNegativeRupeesSchema = rupeesSchema.refine((p) => p <= MAX_ROW_PAISE, "Amount is too large");

export const shortTermLoanInputSchema = z.object({
  personId: z.uuid(),
  /** LENT = you gave money; BORROWED = you received money and will pay it back. */
  direction: z.enum(["LENT", "BORROWED"]).default("LENT"),
  principalAmount: positiveRupeesSchema,
  interestAmount: nonNegativeRupeesSchema,
  givenOn: businessDateSchema,
  method: paymentMethodSchema,
  referenceNumber: optionalText(100),
  notes: optionalText(2000),
  idempotencyKey: idempotencyKeySchema,
});
export type ShortTermLoanInput = z.output<typeof shortTermLoanInputSchema>;

export const shortTermRepaymentSchema = z.object({
  loanId: z.uuid(),
  amount: positiveRupeesSchema,
  receivedOn: businessDateSchema,
  method: paymentMethodSchema,
  referenceNumber: optionalText(100),
  notes: optionalText(2000),
  idempotencyKey: idempotencyKeySchema,
});
export type ShortTermRepaymentInput = z.output<typeof shortTermRepaymentSchema>;

/** Close now, taking `finalAmount` (may be ₹0) and letting any remainder go. */
export const shortTermSettlementSchema = z.object({
  loanId: z.uuid(),
  finalAmount: nonNegativeRupeesSchema,
  receivedOn: businessDateSchema,
  method: paymentMethodSchema,
  referenceNumber: optionalText(100),
  note: optionalText(500),
  idempotencyKey: idempotencyKeySchema,
});
export type ShortTermSettlementInput = z.output<typeof shortTermSettlementSchema>;

export const shortTermRepaymentReversalSchema = z.object({ repaymentId: z.uuid(), reason: reasonSchema });
export type ShortTermRepaymentReversalInput = z.output<typeof shortTermRepaymentReversalSchema>;

export const shortTermCancellationSchema = z.object({ loanId: z.uuid(), reason: reasonSchema });
export type ShortTermCancellationInput = z.output<typeof shortTermCancellationSchema>;
