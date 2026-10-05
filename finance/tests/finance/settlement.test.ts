import { describe, expect, it } from "vitest";
import { ageing, netByPerson, overallPosition, type OpenLoanFacts } from "@/lib/finance/settlement";
import { d, rs } from "./helpers";

const loan = (o: Partial<OpenLoanFacts> & Pick<OpenLoanFacts, "direction" | "personId">): OpenLoanFacts => ({
  status: "OPEN",
  givenOn: d("2026-10-01"),
  outstanding: rs(0),
  principalOutstanding: rs(0),
  interestOutstanding: rs(0),
  ...o,
});

const input = {
  contractOutstandingByPerson: new Map([
    ["dharmjit", rs(52_500)],
    ["sunita", rs(0)],
  ]),
  loans: [
    loan({ direction: "LENT", personId: "dharmjit", outstanding: rs(10_500), principalOutstanding: rs(10_000), interestOutstanding: rs(500) }),
    loan({ direction: "LENT", personId: "sunita", outstanding: rs(13_000), principalOutstanding: rs(12_000), interestOutstanding: rs(1_000), givenOn: d("2026-06-01") }),
    loan({ direction: "BORROWED", personId: "sunita", outstanding: rs(42_000), principalOutstanding: rs(40_000), interestOutstanding: rs(2_000) }),
    loan({ direction: "BORROWED", personId: "lalit", outstanding: rs(5_000), principalOutstanding: rs(5_000), interestOutstanding: rs(0), givenOn: d("2026-03-01") }),
    loan({ direction: "LENT", personId: "closed-guy", status: "CLOSED", outstanding: rs(0) }),
  ],
};

describe("overall settlement position", () => {
  it("receivable − payable, with principal and interest separated", () => {
    expect(overallPosition(input)).toEqual({
      receivable: { contracts: rs(52_500), lentPrincipal: rs(22_000), lentInterest: rs(1_500), total: rs(76_000) },
      payable: { borrowedPrincipal: rs(45_000), borrowedInterest: rs(2_000), total: rs(47_000) },
      net: rs(29_000), // you will receive ₹29,000 more than you pay
      netInterest: rs(-500), // you'll pay ₹500 more interest than you earn
    });
  });

  it("nets each person across both directions, largest first", () => {
    expect(netByPerson(input)).toEqual([
      { personId: "dharmjit", theyOweMe: rs(63_000), iOweThem: rs(0), net: rs(63_000) },
      { personId: "sunita", theyOweMe: rs(13_000), iOweThem: rs(42_000), net: rs(-29_000) }, // you owe Sunita ₹29,000 overall
      { personId: "lalit", theyOweMe: rs(0), iOweThem: rs(5_000), net: rs(-5_000) },
    ]);
  });

  it("buckets open money by how long it has been out", () => {
    const today = d("2026-10-05");
    expect(ageing(input.loans, "LENT", today).map((b) => [b.key, b.count, b.outstanding])).toEqual([
      ["0-30", 1, rs(10_500)],
      ["31-90", 0, 0],
      ["91-180", 1, rs(13_000)], // 126 days
      ["180+", 0, 0],
    ]);
    expect(ageing(input.loans, "BORROWED", today).map((b) => [b.key, b.count])).toEqual([
      ["0-30", 1],
      ["31-90", 0],
      ["91-180", 0],
      ["180+", 1], // 218 days
    ]);
  });

  it("an empty book is all zeros", () => {
    const p = overallPosition({ contractOutstandingByPerson: new Map(), loans: [] });
    expect(p.net).toBe(0);
    expect(netByPerson({ contractOutstandingByPerson: new Map(), loans: [] })).toEqual([]);
  });
});
