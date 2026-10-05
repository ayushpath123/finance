import { describe, expect, it } from "vitest";
import { d, rs } from "./helpers";
import { daysOutstanding, planRepayment, planSettlement, shortTermState, ShortTermError, validateShortTermTerms } from "@/lib/finance/short-term";
import { paise } from "@/lib/finance/money";

const open = (received: number) => shortTermState({ principalAmount: rs(10_000), interestAmount: rs(500), receivedTotal: rs(received), status: "OPEN" });

describe("short-term loans", () => {
  it("total due = principal + fixed interest", () => {
    expect(validateShortTermTerms({ principalAmount: rs(10_000), interestAmount: rs(500) })).toEqual({ totalDue: rs(10_500) });
    expect(validateShortTermTerms({ principalAmount: rs(5_000), interestAmount: rs(0) })).toEqual({ totalDue: rs(5_000) }); // interest-free allowed
  });

  it("rejects bad terms", () => {
    expect(() => validateShortTermTerms({ principalAmount: rs(0), interestAmount: rs(1) })).toThrow(ShortTermError);
    expect(() => validateShortTermTerms({ principalAmount: rs(1), interestAmount: paise(-1) })).toThrow(ShortTermError);
    expect(() => validateShortTermTerms({ principalAmount: paise(2_147_483_000), interestAmount: paise(1_000) })).toThrow(ShortTermError);
  });

  it("money back pays principal first, then interest", () => {
    expect(open(0)).toMatchObject({ totalDue: rs(10_500), outstanding: rs(10_500), principalRecovered: 0, interestRecovered: 0 });
    expect(open(6_000)).toMatchObject({ outstanding: rs(4_500), principalRecovered: rs(6_000), interestRecovered: 0 });
    expect(open(10_200)).toMatchObject({ outstanding: rs(300), principalRecovered: rs(10_000), interestRecovered: rs(200) });
  });

  it("full repayment closes the loan; partial keeps it open; over-repayment is refused", () => {
    expect(planRepayment(open(0), rs(10_500))).toEqual({ ok: true, closes: true, outstandingAfter: 0 });
    expect(planRepayment(open(0), rs(4_000))).toEqual({ ok: true, closes: false, outstandingAfter: rs(6_500) });
    expect(planRepayment(open(4_000), rs(6_500))).toEqual({ ok: true, closes: true, outstandingAfter: 0 });
    expect(planRepayment(open(4_000), rs(7_000)).ok).toBe(false);
    expect(planRepayment(open(0), rs(0)).ok).toBe(false);
  });

  it("settle for less records the waived amount", () => {
    expect(planSettlement(open(0), rs(10_000))).toEqual({ ok: true, waived: rs(500) }); // let the interest go
    expect(planSettlement(open(10_000), rs(0))).toEqual({ ok: true, waived: rs(500) });
    expect(planSettlement(open(0), rs(11_000)).ok).toBe(false);
  });

  it("closed and cancelled loans have nothing outstanding", () => {
    expect(shortTermState({ principalAmount: rs(10_000), interestAmount: rs(500), receivedTotal: rs(10_000), waivedAmount: rs(500), status: "CLOSED" })).toMatchObject({ outstanding: 0, waived: rs(500) });
    expect(shortTermState({ principalAmount: rs(10_000), interestAmount: rs(500), receivedTotal: rs(0), status: "CANCELLED" }).outstanding).toBe(0);
  });

  it("counts days the money has been out", () => {
    expect(daysOutstanding(d("2026-10-01"), d("2026-10-05"))).toBe(4);
    expect(daysOutstanding(d("2026-10-05"), d("2026-10-05"))).toBe(0);
  });
});
