import { describe, expect, it } from "vitest";
import { addDays, businessDate, closedThrough, diffDays, fromDbDate, todayIn, toDbDate } from "@/lib/finance/dates";
import { formatINR, paise, parseRupees, prorate } from "@/lib/finance/money";
import { buildContractTerms, ContractTermsError } from "@/lib/finance/contract-terms";
import { d, rs } from "./helpers";

describe("money", () => {
  it("formats Indian grouping", () => {
    expect(formatINR(rs(50_000))).toBe("₹50,000");
    expect(formatINR(rs(125_000))).toBe("₹1,25,000");
    expect(formatINR(rs(1_250_000))).toBe("₹12,50,000");
    expect(formatINR(paise(75_050))).toBe("₹750.50");
    expect(formatINR(paise(-25_000))).toBe("-₹250");
    expect(formatINR(rs(0))).toBe("₹0");
  });

  it("parses rupee input without floating point", () => {
    expect(parseRupees("1500")).toBe(150_000);
    expect(parseRupees("1,500.5")).toBe(150_050);
    expect(parseRupees("₹1,50,000.00")).toBe(15_000_000);
    expect(parseRupees("0.1")).toBe(10);
    expect(parseRupees(1500.5)).toBe(150_050);
    expect(parseRupees(0.1 + 0.2)).toBeNull(); // 0.30000000000000004
    expect(parseRupees("-5")).toBeNull();
    expect(parseRupees("1.234")).toBeNull();
    expect(parseRupees("abc")).toBeNull();
  });

  it("rejects non-integer paise", () => {
    expect(() => paise(1.5)).toThrow();
  });

  it("prorates exactly", () => {
    // 30 days × ₹750 of a ₹50,000 / ₹75,000 contract → ₹15,000 principal
    expect(prorate(rs(22_500), rs(50_000), rs(75_000))).toBe(rs(15_000));
    expect(prorate(paise(100), paise(1), paise(3))).toBe(33);
  });
});

describe("dates", () => {
  it("handles month, year and leap-year boundaries", () => {
    expect(addDays(d("2026-09-30"), 1)).toBe("2026-10-01");
    expect(addDays(d("2026-12-31"), 1)).toBe("2027-01-01");
    expect(addDays(d("2028-02-28"), 1)).toBe("2028-02-29");
    expect(addDays(d("2027-02-28"), 1)).toBe("2027-03-01");
    expect(diffDays(d("2027-01-04"), d("2026-09-27"))).toBe(99);
  });

  it("rejects impossible dates", () => {
    expect(() => businessDate("2027-02-29")).toThrow();
    expect(() => businessDate("2026-13-01")).toThrow();
    expect(() => businessDate("27/09/2026")).toThrow();
  });

  it("round-trips Postgres DATE values", () => {
    expect(fromDbDate(toDbDate(d("2028-02-29")))).toBe("2028-02-29");
  });

  it("uses the business timezone, not UTC", () => {
    // 20:00 UTC on 28 Sep = 01:30 IST on 29 Sep
    const now = new Date("2026-09-28T20:00:00Z");
    expect(todayIn("Asia/Kolkata", now)).toBe("2026-09-29");
    expect(todayIn("UTC", now)).toBe("2026-09-28");
  });

  it("only closes a day at the cutoff in IST", () => {
    const clock = { timeZone: "Asia/Kolkata", cutoff: "23:59" };
    // 23:58 IST on 28 Sep → 28th still open
    expect(closedThrough(new Date("2026-09-28T18:28:00Z"), clock)).toBe("2026-09-27");
    // 23:59 IST on 28 Sep → 28th closed
    expect(closedThrough(new Date("2026-09-28T18:29:00Z"), clock)).toBe("2026-09-28");
    // 00:05 IST on 29 Sep → 28th closed, 29th open
    expect(closedThrough(new Date("2026-09-28T18:35:00Z"), clock)).toBe("2026-09-28");
  });
});

describe("contract terms", () => {
  it("derives Dharmjit's contract", () => {
    const t = buildContractTerms({
      principalAmount: rs(50_000),
      dailyCollectionAmount: rs(750),
      totalCollectionDays: 100,
      startDate: d("2026-09-26"),
      firstCollectionDate: d("2026-09-27"),
    });
    expect(t.expectedCollectionAmount).toBe(rs(75_000));
    expect(t.expectedMargin).toBe(rs(25_000));
    expect(t.schedule).toHaveLength(100);
    expect(t.schedule[0].scheduledDate).toBe("2026-09-27");
    // 100th collection day, inclusive. (The brief says 5 Jan — see ARCHITECTURE.md §2.)
    expect(t.expectedEndDate).toBe("2027-01-04");
  });

  it("rejects invalid terms", () => {
    const base = {
      principalAmount: rs(50_000),
      dailyCollectionAmount: rs(750),
      totalCollectionDays: 100,
      startDate: d("2026-09-26"),
      firstCollectionDate: d("2026-09-27"),
    };
    expect(() => buildContractTerms({ ...base, principalAmount: paise(-1) })).toThrow(ContractTermsError);
    expect(() => buildContractTerms({ ...base, dailyCollectionAmount: paise(0) })).toThrow(ContractTermsError);
    expect(() => buildContractTerms({ ...base, totalCollectionDays: 0 })).toThrow(ContractTermsError);
    expect(() => buildContractTerms({ ...base, totalCollectionDays: 1.5 })).toThrow(ContractTermsError);
    expect(() => buildContractTerms({ ...base, firstCollectionDate: d("2026-09-25") })).toThrow(ContractTermsError);
  });
});
