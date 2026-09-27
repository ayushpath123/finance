import { describe, expect, it } from "vitest";
import { contractInputSchema, paymentInputSchema, personInputSchema } from "@/lib/validation/schemas";

const uuid = "0190a0b0-0000-7000-8000-000000000000";

describe("validation schemas", () => {
  it("converts rupee strings to integer paise", () => {
    const p = paymentInputSchema.parse({
      contractId: uuid,
      amount: "1,500.50",
      paymentDate: "2026-09-29",
      paymentMethod: "CASH",
      idempotencyKey: uuid,
    });
    expect(p.amount).toBe(150_050);
    expect(p.referenceNumber).toBeUndefined();
  });

  it("rejects zero, negative and malformed amounts and impossible dates", () => {
    const base = { contractId: uuid, paymentDate: "2026-09-29", paymentMethod: "CASH", idempotencyKey: uuid };
    for (const amount of ["0", "-5", "12.345", "abc", ""]) {
      expect(paymentInputSchema.safeParse({ ...base, amount }).success).toBe(false);
    }
    expect(paymentInputSchema.safeParse({ ...base, amount: "750", paymentDate: "2027-02-29" }).success).toBe(false);
  });

  it("normalises phone numbers and blank optionals", () => {
    const p = personInputSchema.parse({ fullName: " Dharmjit Pandey ", phoneNumber: "98390-12345", address: "  ", alternatePhone: "" });
    expect(p).toEqual({ fullName: "Dharmjit Pandey", phoneNumber: "9839012345", address: undefined, alternatePhone: undefined });
    expect(personInputSchema.safeParse({ fullName: "A B", phoneNumber: "123" }).success).toBe(false);
  });

  it("parses contract input", () => {
    const c = contractInputSchema.parse({
      personId: uuid,
      principalAmount: "50000",
      dailyCollectionAmount: "750",
      totalCollectionDays: "100",
      startDate: "2026-09-26",
      firstCollectionDate: "2026-09-27",
      disbursementMethod: "CASH",
      idempotencyKey: uuid,
    });
    expect(c).toMatchObject({ principalAmount: 5_000_000, dailyCollectionAmount: 75_000, totalCollectionDays: 100 });
  });
});
