/** Settlements read model against real Postgres (2070 era). */
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { contractAggregates } from "@/lib/services/read-models";
import { getSettlementOverview, getShortTermBook, monthFlows } from "@/lib/services/settlement-read";
import { businessNow, getSettings } from "@/lib/services/settings";
import { createShortTermLoan, recordShortTermRepayment } from "@/lib/services/short-term";
import { shortTermLoans } from "@/lib/services/short-term-read";
import { adminActor, d, ist, newContract, pay, rs } from "./fixtures";

describe("settlements", () => {
  it("net position = owed to you − you owe; each person netted across both directions", async () => {
    const actor = await adminActor();
    const { contract, personId } = await newContract({ name: "Settle Sameer", phone: "9812370001", days: 10, daily: 1_000, principal: 8_000, start: "2070-05-01" });
    await pay(contract.id, 2_000, "2070-05-02"); // contract outstanding 8,000
    const lent = await createShortTermLoan(
      { personId, direction: "LENT", principalAmount: rs(5_000), interestAmount: rs(500), givenOn: d("2070-05-03"), method: "CASH", idempotencyKey: randomUUID() },
      actor,
      { now: ist("2070-05-03", "10:00") },
    );
    await recordShortTermRepayment(
      { loanId: lent.loan.id, amount: rs(5_200), receivedOn: d("2070-05-04"), method: "UPI", idempotencyKey: randomUUID() },
      actor,
      { now: ist("2070-05-04", "10:00") },
    ); // 300 interest still to come
    await createShortTermLoan(
      { personId, direction: "BORROWED", principalAmount: rs(20_000), interestAmount: rs(1_000), givenOn: d("2070-05-04"), method: "BANK_TRANSFER", idempotencyKey: randomUUID() },
      actor,
      { now: ist("2070-05-04", "11:00") },
    );

    const now = ist("2070-05-04", "20:00");
    const bn = businessNow(await getSettings(), now);
    const o = await getSettlementOverview(bn);

    // Totals agree with their independent sources.
    const aggs = await contractAggregates({}, bn);
    const open = await shortTermLoans({ status: "OPEN" }, bn);
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    expect(o.position.receivable.contracts).toBe(sum(aggs.map((a) => a.outstanding)));
    expect(o.position.receivable.lentPrincipal + o.position.receivable.lentInterest).toBe(sum(open.filter((l) => l.direction === "LENT").map((l) => l.outstanding)));
    expect(o.position.payable.total).toBe(sum(open.filter((l) => l.direction === "BORROWED").map((l) => l.outstanding)));
    expect(o.position.net).toBe(o.position.receivable.total - o.position.payable.total);

    // This person: owes 8,000 (contract) + 300 (short-term interest); I owe 21,000 → I owe them 12,700 overall.
    const me = o.people.find((p) => p.personId === personId)!;
    expect(me).toMatchObject({ theyOweMe: rs(8_300), iOweThem: rs(21_000), net: -rs(12_700), fullName: "Settle Sameer" });

    // The 300 left on the lent loan is all interest (money back paid principal first).
    const lentBook = await getShortTermBook("LENT", "OPEN", bn);
    const row = lentBook.rows.find((r) => r.id === lent.loan.id)!;
    expect(row).toMatchObject({ outstanding: rs(300), principalOutstanding: 0, interestOutstanding: rs(300) });
    const borrowBook = await getShortTermBook("BORROWED", "OPEN", bn);
    expect(borrowBook.rows.some((r) => r.personId === personId && r.label.startsWith("BR-"))).toBe(true);

    // Month flows include this month's movements.
    const m = await monthFlows(bn);
    expect(m.from).toBe("2070-05-01");
    expect(m.lent.given).toBeGreaterThanOrEqual(rs(5_000));
    expect(m.lent.back).toBeGreaterThanOrEqual(rs(5_200));
    expect(m.borrowed.received).toBeGreaterThanOrEqual(rs(20_000));
    expect(m.moneyIn).toBe(m.contracts.collected + m.lent.back + m.borrowed.received);
    expect(m.moneyOut).toBe(m.contracts.given + m.lent.given + m.borrowed.paidBack);
  });
});
