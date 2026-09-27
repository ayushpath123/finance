/**
 * End-to-end financial behaviour against a real Postgres.
 *
 * Scenarios run sequentially and each lives in its own calendar year, so the
 * business clock only moves forward (reconciliation in a later scenario may
 * legitimately close days of earlier scenarios' contracts; assertions are
 * always scoped to the scenario's own contracts).
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { cancelContract, createContract, reverseDisbursement } from "@/lib/services/contracts";
import { correctPayment, reversePayment } from "@/lib/services/payments";
import { createPerson } from "@/lib/services/people";
import { getContractSummary } from "@/lib/services/read-models";
import { reconcileDailyCollections } from "@/lib/services/reconciliation";
import { personInputSchema } from "@/lib/validation/schemas";
import { adminActor, d, expectClean, ist, newContract, pay, rs, schedulesOf, statusMap } from "./fixtures";

const domainCode = (code: string) => expect.objectContaining({ name: "DomainError", code });

beforeAll(async () => {
  await adminActor();
});

describe("1 · Dharmjit Pandey — the brief's worked example (2026)", () => {
  let contractId: string;

  it("creates the person with a readable slug; duplicates get a suffix", async () => {
    const actor = await adminActor();
    // Input goes through the same zod schema the server action uses.
    const p1 = await createPerson(personInputSchema.parse({ fullName: "Mr. Dharmjit Pandey", phoneNumber: "98765 43210", address: "Varanasi" }), actor);
    const p2 = await createPerson(personInputSchema.parse({ fullName: "Dharmjit Pandey", phoneNumber: "9123456780" }), actor);
    expect(p1.slug).toBe("dharmjit-pandey");
    expect(p2.slug).toBe("dharmjit-pandey-2");
    expect(p1.phoneNumber).toBe("9876543210");
    const audit = await prisma.auditLog.findMany({ where: { entityId: p1.id } });
    expect(audit.map((a) => a.action)).toEqual(["PERSON_CREATED"]);
  });

  it("creates the contract, 100-day schedule, disbursement, ledger and audit atomically", async () => {
    const actor = await adminActor();
    const person = await prisma.person.findUniqueOrThrow({ where: { slug: "dharmjit-pandey" } });
    const key = randomUUID();
    const input = {
      personId: person.id,
      principalAmount: rs(50_000),
      dailyCollectionAmount: rs(750),
      totalCollectionDays: 100,
      startDate: d("2026-09-26"),
      firstCollectionDate: d("2026-09-27"),
      disbursementMethod: "CASH" as const,
      idempotencyKey: key,
    };
    const { contract, disbursement, duplicate } = await createContract(input, actor, { now: ist("2026-09-26", "11:00") });
    contractId = contract.id;
    expect(duplicate).toBe(false);
    expect(contract.expectedCollectionAmount).toBe(rs(75_000));
    expect(contract.expectedEndDate.toISOString().slice(0, 10)).toBe("2027-01-04"); // Case 9
    expect(disbursement).toMatchObject({ amount: rs(50_000), method: "CASH", status: "ACTIVE" });
    expect(disbursement.disbursedOn.toISOString().slice(0, 10)).toBe("2026-09-26");

    const schedules = await schedulesOf(contractId);
    expect(schedules).toHaveLength(100);
    expect(schedules[0].date).toBe("2026-09-27");
    expect(schedules[99].date).toBe("2027-01-04");
    expect(schedules.every((s) => s.expectedAmount === rs(750) && s.status === "PENDING")).toBe(true);

    const ledger = await prisma.ledgerEntry.findMany({ where: { contractId } });
    expect(ledger).toEqual([expect.objectContaining({ entryType: "DISBURSEMENT", amount: -rs(50_000) })]);
    const actions = (await prisma.auditLog.findMany({ where: { contractId }, orderBy: { timestamp: "asc" } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["CONTRACT_CREATED", "DISBURSEMENT_CREATED"]));

    // Double-submitted form → same contract, nothing duplicated.
    const again = await createContract(input, actor, { now: ist("2026-09-26", "11:01") });
    expect(again.duplicate).toBe(true);
    expect(again.contract.id).toBe(contractId);
    expect(await prisma.contract.count({ where: { personId: person.id } })).toBe(1);
  });

  it("27 Sep: ₹750 received → PAID (Case 1)", async () => {
    const r = await pay(contractId, 750, "2026-09-27");
    expect(r.explanation.lines.map((l) => [l.scheduledDate, l.amount, l.kind])).toEqual([["2026-09-27", rs(750), "CURRENT"]]);
    expect((await statusMap(contractId, 2))["2026-09-27"]).toBe("PAID");
  });

  it("28 Sep: nothing → still PENDING at 23:58 IST, MISSED after the cutoff (Case 2)", async () => {
    await reconcileDailyCollections("MANUAL", { now: ist("2026-09-28", "23:58") });
    expect((await statusMap(contractId, 2))["2026-09-28"]).toBe("PENDING");

    const run = await reconcileDailyCollections("CRON", { now: ist("2026-09-29", "00:05") });
    expect(run.closedThrough).toBe("2026-09-28");
    const s28 = (await schedulesOf(contractId))[1];
    expect(s28).toMatchObject({ status: "MISSED", allocatedAmount: 0, shortfallAtClose: rs(750) });
    expect(s28.missedAt).not.toBeNull();

    const memo = await prisma.ledgerEntry.findMany({ where: { scheduleId: s28.id } });
    expect(memo).toEqual([expect.objectContaining({ entryType: "SCHEDULE_MISSED", amount: 0, memoAmount: rs(750) })]);
  });

  it("reconciliation is idempotent: re-runs create no duplicate ledger or audit rows", async () => {
    const s28 = (await schedulesOf(contractId))[1];
    const second = await reconcileDailyCollections("CRON", { now: ist("2026-09-29", "00:05") });
    const third = await reconcileDailyCollections("DASHBOARD", { now: ist("2026-09-29", "08:00") });
    expect(second.schedulesMarkedMissed).toBe(0);
    expect(third.schedulesMarkedMissed).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { scheduleId: s28.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { action: "SCHEDULE_MARKED_MISSED", entityId: s28.id } })).toBe(1);
  });

  it("29 Sep: ₹1,500 → ₹750 settles 28 Sep (SETTLED_LATE), ₹750 pays 29 Sep (Case 5)", async () => {
    const r = await pay(contractId, 1500, "2026-09-29", { time: "09:42" });
    expect(r.explanation.lines.map((l) => [l.scheduledDate, l.amount, l.kind])).toEqual([
      ["2026-09-28", rs(750), "ARREARS"],
      ["2026-09-29", rs(750), "CURRENT"],
    ]);
    expect(r.explanation.credit).toBe(0);
    expect(await statusMap(contractId, 3)).toEqual({
      "2026-09-27": "PAID",
      "2026-09-28": "SETTLED_LATE",
      "2026-09-29": "PAID",
    });
    // The miss stays on record after settlement.
    const s28 = (await schedulesOf(contractId))[1];
    expect(s28.missedAt).not.toBeNull();
    expect(s28.settledAt).not.toBeNull();
  });

  it("ledger tells the story; summary explains what is owed", async () => {
    const ledger = await prisma.ledgerEntry.findMany({ where: { contractId }, orderBy: [{ effectiveDate: "asc" }, { createdAt: "asc" }] });
    expect(ledger.map((l) => [l.effectiveDate.toISOString().slice(0, 10), l.entryType, l.amount, l.memoAmount])).toEqual([
      ["2026-09-26", "DISBURSEMENT", -rs(50_000), null],
      ["2026-09-27", "COLLECTION", rs(750), null],
      ["2026-09-28", "SCHEDULE_MISSED", 0, rs(750)],
      ["2026-09-29", "COLLECTION", rs(1500), null],
    ]);

    const sum = await getContractSummary(contractId, { now: ist("2026-09-29", "20:00") });
    expect(sum).toMatchObject({
      principal: rs(50_000),
      contractedCollection: rs(75_000),
      contractualMargin: rs(25_000),
      collected: rs(2250),
      outstanding: rs(72_750),
      overdue: 0,
      prepaid: 0,
      credit: 0,
      daysSatisfied: 3,
      daysEverMissed: 1,
    });
    await expectClean(contractId, ist("2026-09-29", "20:00"));
  });
});

describe("2 · partial, same-day, overpayment, prepaid, completion (2027)", () => {
  let contractId: string;
  const S = async (i: number) => (await schedulesOf(contractId))[i];

  it("₹500 of ₹750 → PARTIAL, ₹250 short at close (Case 3)", async () => {
    ({ contract: { id: contractId } } = await newContract({ name: "Ramesh Yadav", days: 10, start: "2027-03-01" }));
    await pay(contractId, 500, "2027-03-01");
    expect((await S(0)).status).toBe("PARTIAL");
    await reconcileDailyCollections("CRON", { now: ist("2027-03-02", "00:05") });
    expect(await S(0)).toMatchObject({ status: "PARTIAL", allocatedAmount: rs(500), shortfallAtClose: rs(250) });
    const sum = await getContractSummary(contractId, { now: ist("2027-03-02", "08:00") });
    expect(sum.overdue).toBe(rs(250));
  });

  it("next day ₹1,000 → ₹250 to arrears, ₹750 to today", async () => {
    const r = await pay(contractId, 1000, "2027-03-02");
    expect(r.explanation.lines.map((l) => [l.amount, l.kind])).toEqual([
      [rs(250), "ARREARS"],
      [rs(750), "CURRENT"],
    ]);
    expect((await S(0)).status).toBe("SETTLED_LATE");
    expect((await S(1)).status).toBe("PAID");
  });

  it("₹300 at 10 AM + ₹450 at 5 PM on one day → both kept, day PAID", async () => {
    await pay(contractId, 300, "2027-03-03", { time: "10:00" });
    await pay(contractId, 450, "2027-03-03", { time: "17:00" });
    const s3 = await S(2);
    expect(s3.status).toBe("PAID");
    const allocs = await prisma.paymentAllocation.findMany({ where: { scheduleId: s3.id, voidedAt: null }, include: { payment: true } });
    expect(allocs.map((a) => [a.payment.amount, a.amount]).sort()).toEqual([
      [rs(300), rs(300)],
      [rs(450), rs(450)],
    ]);
  });

  it("₹2,000 on a ₹750 day → today paid, ₹1,250 prepaid, nothing lost (Case 4)", async () => {
    const r = await pay(contractId, 2000, "2027-03-04");
    expect(r.explanation.lines.map((l) => [l.scheduledDate, l.amount, l.kind])).toEqual([
      ["2027-03-04", rs(750), "CURRENT"],
      ["2027-03-05", rs(750), "ADVANCE"],
      ["2027-03-06", rs(500), "ADVANCE"],
    ]);
    const sum = await getContractSummary(contractId, { now: ist("2027-03-04", "20:00") });
    expect(sum).toMatchObject({ todayExpected: rs(750), todayAllocated: rs(750), prepaid: rs(1250), credit: 0, overdue: 0 });
  });

  it("a prepaid day passes without being marked missed", async () => {
    await reconcileDailyCollections("CRON", { now: ist("2027-03-06", "00:05") });
    expect(await S(4)).toMatchObject({ status: "PAID", missedAt: null });
    expect((await S(5)).status).toBe("PARTIAL"); // today, ₹500 of ₹750 already prepaid
  });

  it("paying ahead fills future days; completion only when every obligation is met", async () => {
    await pay(contractId, 3000, "2027-03-06"); // 250 + 3×750 + 500 → day 10 still ₹250 short
    let contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe("ACTIVE");
    const statuses = Object.values(await statusMap(contractId));
    expect(statuses.slice(6, 9)).toEqual(["PAID", "PAID", "PAID"]); // prepaid future days
    expect(statuses[9]).toBe("PENDING");

    const r = await pay(contractId, 250, "2027-03-06", { time: "18:30" });
    expect(r.contractCompleted).toBe(true);
    contract = await prisma.contract.findUniqueOrThrow({ where: { id: contractId } });
    expect(contract.status).toBe("COMPLETED");
    expect(await prisma.auditLog.count({ where: { contractId, action: "CONTRACT_COMPLETED" } })).toBe(1);

    await expect(pay(contractId, 100, "2027-03-06", { time: "19:00" })).rejects.toEqual(domainCode("INVALID_STATE"));
    await expectClean(contractId, ist("2027-03-06", "20:00"));
  });
});

describe("3 · multiple missed days, reversal, correction, reopen (2028, leap day)", () => {
  let contractId: string;

  it("schedule crosses 29 Feb 2028 without skipping it", async () => {
    ({ contract: { id: contractId } } = await newContract({ name: "Sunita Devi", daily: 1000, days: 5, principal: 3500, start: "2028-02-27" }));
    expect(Object.keys(await statusMap(contractId))).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01", "2028-03-02"]);
  });

  it("three missed days then ₹3,500 → oldest first (Case 6)", async () => {
    await reconcileDailyCollections("CRON", { now: ist("2028-03-01", "00:05") });
    expect(Object.values(await statusMap(contractId, 3))).toEqual(["MISSED", "MISSED", "MISSED"]);
    await pay(contractId, 3500, "2028-03-01");
    expect(Object.values(await statusMap(contractId))).toEqual(["SETTLED_LATE", "SETTLED_LATE", "SETTLED_LATE", "PARTIAL", "PENDING"]);
  });

  it("reversal keeps the payment, voids its allocations, restores MISSED", async () => {
    const p = await prisma.payment.findFirstOrThrow({ where: { contractId } });
    await reversePayment({ paymentId: p.id, reason: "Entered twice by mistake" }, await adminActor(), { now: ist("2028-03-01", "19:00") });

    const after = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(after).toMatchObject({ status: "REVERSED", amount: rs(3500), reversalReason: "Entered twice by mistake" });
    expect(await prisma.paymentAllocation.count({ where: { paymentId: p.id, voidedAt: null } })).toBe(0);
    expect(await prisma.paymentAllocation.count({ where: { paymentId: p.id } })).toBe(4); // history kept
    expect(Object.values(await statusMap(contractId))).toEqual(["MISSED", "MISSED", "MISSED", "PENDING", "PENDING"]);
    expect(await prisma.ledgerEntry.findFirst({ where: { paymentId: p.id, entryType: "COLLECTION_REVERSAL" } })).toMatchObject({ amount: -rs(3500) });

    await expect(
      reversePayment({ paymentId: p.id, reason: "again" }, await adminActor(), { now: ist("2028-03-01", "19:01") }),
    ).rejects.toEqual(domainCode("INVALID_STATE"));
  });

  it("correction ₹1,500 → ₹5,000: original reversed and visible, replacement linked (Case 7)", async () => {
    const wrong = await pay(contractId, 1500, "2028-03-01", { time: "19:10" });
    const { original, replacement, explanation } = await correctPayment(
      {
        originalPaymentId: wrong.payment.id,
        contractId,
        amount: rs(5000),
        paymentDate: d("2028-03-01"),
        paymentMethod: "UPI",
        referenceNumber: "UPI-778899",
        reason: "Typed wrong amount",
        idempotencyKey: randomUUID(),
      },
      await adminActor(),
      { now: ist("2028-03-01", "19:20") },
    );
    expect(original.status).toBe("REVERSED");
    expect(replacement).toMatchObject({ status: "ACTIVE", amount: rs(5000), correctsPaymentId: wrong.payment.id });
    expect(explanation.lines).toHaveLength(5);
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })).status).toBe("COMPLETED");

    const actions = (await prisma.auditLog.findMany({ where: { contractId, action: { in: ["PAYMENT_REVERSED", "PAYMENT_CORRECTED"] } } })).map((a) => a.action);
    expect(actions.filter((a) => a === "PAYMENT_CORRECTED")).toHaveLength(1);
    expect(await prisma.payment.count({ where: { contractId } })).toBe(3); // nothing deleted
  });

  it("reversing the replacement reopens the COMPLETED contract", async () => {
    const replacement = await prisma.payment.findFirstOrThrow({ where: { contractId, status: "ACTIVE" } });
    await reversePayment({ paymentId: replacement.id, reason: "Bounced UPI" }, await adminActor(), { now: ist("2028-03-02", "10:00") });
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contractId } })).status).toBe("ACTIVE");
    expect(await prisma.auditLog.count({ where: { contractId, action: "CONTRACT_REOPENED" } })).toBe(1);
    await expectClean(contractId, ist("2028-03-02", "10:00"));
  });
});

describe("4 · multiple contracts for one person; payment on the wrong contract (2029)", () => {
  it("keeps contracts separate and moves a mis-posted payment (Case 8)", async () => {
    const a = await newContract({ name: "Mohan Lal", daily: 750, days: 10, start: "2029-06-01" });
    const b = await newContract({ personId: a.personId, daily: 500, days: 10, principal: 3500, start: "2029-06-01" });

    const wrong = await pay(a.contract.id, 750, "2029-06-01", { time: "11:00" });
    await correctPayment(
      {
        originalPaymentId: wrong.payment.id,
        contractId: b.contract.id,
        amount: rs(750),
        paymentDate: d("2029-06-01"),
        paymentMethod: "CASH",
        reason: "Posted to the wrong contract",
        idempotencyKey: randomUUID(),
      },
      await adminActor(),
      { now: ist("2029-06-01", "12:00") },
    );

    const sa = await getContractSummary(a.contract.id, { now: ist("2029-06-01", "12:00") });
    const sb = await getContractSummary(b.contract.id, { now: ist("2029-06-01", "12:00") });
    expect(sa).toMatchObject({ collected: 0, allocated: 0, todayAllocated: 0 });
    expect(sb).toMatchObject({ collected: rs(750), todayAllocated: rs(500), prepaid: rs(250) });

    const aLedger = await prisma.ledgerEntry.findMany({ where: { contractId: a.contract.id, paymentId: { not: null } } });
    expect(aLedger.map((l) => l.entryType).sort()).toEqual(["COLLECTION", "COLLECTION_REVERSAL"]);
    const cross = await prisma.paymentAllocation.count({
      where: { contractId: b.contract.id, payment: { contractId: a.contract.id } },
    });
    expect(cross).toBe(0);
    await expectClean(a.contract.id, ist("2029-06-01", "12:00"));
    await expectClean(b.contract.id, ist("2029-06-01", "12:00"));
  });
});

describe("5 · cancellation (2030)", () => {
  it("prepaid/paid days stay, future unpaid days become CANCELLED, released money becomes credit", async () => {
    const { contract } = await newContract({ name: "Kavita Singh", days: 10, start: "2030-01-01" });
    await pay(contract.id, 750, "2030-01-01");
    await pay(contract.id, 2000, "2030-01-03", { time: "10:00" }); // 2 Jan arrears, 3 Jan, ₹500 of 4 Jan

    const res = await cancelContract({ contractId: contract.id, reason: "Customer relocated" }, await adminActor(), {
      now: ist("2030-01-03", "12:00"),
    });
    expect(res.cancelledDays).toBe(7);
    expect(res.cancelledObligation).toBe(rs(5250));
    const st = Object.values(await statusMap(contract.id));
    expect(st.slice(0, 3)).toEqual(["PAID", "SETTLED_LATE", "PAID"]);
    expect(st.slice(3).every((s) => s === "CANCELLED")).toBe(true);

    const sum = await getContractSummary(contract.id, { now: ist("2030-01-03", "12:00") });
    expect(sum).toMatchObject({ cancelledObligation: rs(5250), outstanding: 0, overdue: 0, credit: rs(500), collected: rs(2750) });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { contractId: contract.id, action: "CONTRACT_CANCELLED" } });
    expect(audit.metadata).toMatchObject({ cancelledObligation: rs(5250), releasedToCredit: rs(500) });
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).status).toBe("CANCELLED");

    await expect(
      cancelContract({ contractId: contract.id, reason: "again" }, await adminActor(), { now: ist("2030-01-03", "12:05") }),
    ).rejects.toEqual(domainCode("INVALID_STATE"));

    // Wrong-terms path: cancel → reverse disbursement.
    const disb = await prisma.disbursement.findFirstOrThrow({ where: { contractId: contract.id } });
    await reverseDisbursement({ disbursementId: disb.id, reason: "Contract entered with wrong terms" }, await adminActor(), {
      now: ist("2030-01-03", "12:10"),
    });
    expect(await prisma.ledgerEntry.findFirst({ where: { disbursementId: disb.id, entryType: "DISBURSEMENT_REVERSAL" } })).toMatchObject({ amount: rs(50_000) });
    await expectClean(contract.id, ist("2030-01-03", "12:10"));
  });

  it("arrears stay owed after cancellation and keep being reconciled", async () => {
    const { contract } = await newContract({ name: "Vijay Kumar", days: 5, start: "2030-02-01" });
    await cancelContract({ contractId: contract.id, reason: "Stopped paying" }, await adminActor(), { now: ist("2030-02-03", "12:00") });
    expect(Object.values(await statusMap(contract.id))).toEqual(["MISSED", "MISSED", "PENDING", "CANCELLED", "CANCELLED"]);
    let sum = await getContractSummary(contract.id, { now: ist("2030-02-03", "12:00") });
    expect(sum).toMatchObject({ overdue: rs(1500), outstanding: rs(2250), cancelledObligation: rs(1500) });

    await reconcileDailyCollections("CRON", { now: ist("2030-02-04", "00:05") });
    expect((await statusMap(contract.id))["2030-02-03"]).toBe("MISSED");

    const disb = await prisma.disbursement.findFirstOrThrow({ where: { contractId: contract.id } });
    expect(disb.status).toBe("ACTIVE");
    await pay(contract.id, 1500, "2030-02-05"); // arrears can still be collected
    sum = await getContractSummary(contract.id, { now: ist("2030-02-05", "20:00") });
    expect(sum).toMatchObject({ overdue: rs(750), outstanding: rs(750) });
  });

  it("disbursement reversal requires a cancelled contract", async () => {
    const { contract } = await newContract({ name: "Asha Rani", days: 5, start: "2030-03-01" });
    const disb = await prisma.disbursement.findFirstOrThrow({ where: { contractId: contract.id } });
    await expect(
      reverseDisbursement({ disbursementId: disb.id, reason: "no" }, await adminActor(), { now: ist("2030-03-01", "12:00") }),
    ).rejects.toEqual(domainCode("INVALID_STATE"));
  });
});

describe("6 · duplicates and concurrency (2031)", () => {
  it("duplicate payment submission is recorded exactly once", async () => {
    const { contract } = await newContract({ name: "Deepak Gupta", days: 10, start: "2031-01-01" });
    const key = randomUUID();
    const first = await pay(contract.id, 750, "2031-01-01", { key });
    const second = await pay(contract.id, 750, "2031-01-01", { key });
    expect(second.duplicate).toBe(true);
    expect(second.payment.id).toBe(first.payment.id);
    expect(second.explanation.lines).toHaveLength(1);
    await expect(pay(contract.id, 1000, "2031-01-01", { key })).rejects.toEqual(domainCode("IDEMPOTENCY_CONFLICT"));

    // Five tabs / retries firing the same submission at once.
    const key2 = randomUUID();
    const results = await Promise.all(Array.from({ length: 5 }, () => pay(contract.id, 750, "2031-01-01", { key: key2 })));
    expect(new Set(results.map((r) => r.payment.id)).size).toBe(1);
    expect(await prisma.payment.count({ where: { contractId: contract.id } })).toBe(2);
    await expectClean(contract.id, ist("2031-01-01", "20:00"));
  });

  it("concurrent different payments on one contract serialise correctly", async () => {
    const { contract } = await newContract({ name: "Pooja Sharma", days: 10, start: "2031-02-01" });
    await Promise.all(Array.from({ length: 6 }, (_, i) => pay(contract.id, 750, "2031-02-01", { time: `12:0${i}` })));
    const sum = await getContractSummary(contract.id, { now: ist("2031-02-01", "20:00") });
    expect(sum).toMatchObject({ collected: rs(4500), allocated: rs(4500), daysSatisfied: 6, prepaid: rs(3750) });
    await expectClean(contract.id, ist("2031-02-01", "20:00"));
  });

  it("concurrent reconciliation runs never duplicate history", async () => {
    const { contract } = await newContract({ name: "Rajesh Verma", days: 10, start: "2031-03-01" });
    const now = ist("2031-03-04", "00:05");
    await Promise.all([1, 2, 3].map(() => reconcileDailyCollections("CRON", { now })));
    const s = await schedulesOf(contract.id);
    const missedIds = s.filter((x) => x.status === "MISSED").map((x) => x.id);
    expect(missedIds).toHaveLength(3);
    expect(await prisma.ledgerEntry.count({ where: { scheduleId: { in: missedIds } } })).toBe(3);
    expect(await prisma.auditLog.count({ where: { action: "SCHEDULE_MARKED_MISSED", entityId: { in: missedIds } } })).toBe(3);
  });
});

describe("7 · database invariants and rollback (2032)", () => {
  let contractId: string;
  let personId: string;
  let paymentId: string;

  beforeAll(async () => {
    const c = await newContract({ name: "Invariant Tester", days: 10, start: "2032-05-01" });
    contractId = c.contract.id;
    personId = c.personId;
    paymentId = (await pay(contractId, 750, "2032-05-01")).payment.id;
  });

  const rejects = (sql: string) => expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();

  it("financial rows cannot be edited or deleted", async () => {
    await rejects(`UPDATE payments SET amount = 1 WHERE id = '${paymentId}'`);
    await rejects(`DELETE FROM payments WHERE id = '${paymentId}'`);
    await rejects(`UPDATE ledger_entries SET amount = 1 WHERE "contractId" = '${contractId}'`);
    await rejects(`DELETE FROM ledger_entries WHERE "contractId" = '${contractId}'`);
    await rejects(`DELETE FROM audit_logs`);
    await rejects(`UPDATE audit_logs SET description = 'x'`);
    await rejects(`TRUNCATE audit_logs`);
    await rejects(`UPDATE payment_allocations SET amount = 1 WHERE "paymentId" = '${paymentId}'`);
    await rejects(`DELETE FROM payment_allocations WHERE "paymentId" = '${paymentId}'`);
    await rejects(`UPDATE disbursements SET amount = 1 WHERE "contractId" = '${contractId}'`);
  });

  it("contract terms and schedule expectations are immutable", async () => {
    await rejects(`UPDATE contracts SET "principalAmount" = 1 WHERE id = '${contractId}'`);
    await rejects(`UPDATE contracts SET "expectedEndDate" = '2040-01-01' WHERE id = '${contractId}'`);
    await rejects(`UPDATE collection_schedules SET "scheduledDate" = '2040-01-01' WHERE "contractId" = '${contractId}' AND sequence = 5`);
    await rejects(`UPDATE collection_schedules SET "expectedAmount" = 1 WHERE "contractId" = '${contractId}'`);
    await rejects(`DELETE FROM collection_schedules WHERE "contractId" = '${contractId}'`);
    await rejects(`DELETE FROM contracts WHERE id = '${contractId}'`);
  });

  it("negative amounts, cross-person payments and cross-contract allocations are rejected", async () => {
    const other = await createPerson({ fullName: "Someone Else", phoneNumber: "9000000000" }, await adminActor());
    const admin = (await adminActor()).userId;
    await rejects(
      `INSERT INTO payments (id,"contractId","personId",amount,"paymentDate","paymentMethod","idempotencyKey","createdById") VALUES (gen_random_uuid(),'${contractId}','${personId}',-100,'2032-05-01','CASH','${randomUUID()}','${admin}')`,
    );
    await rejects(
      `INSERT INTO payments (id,"contractId","personId",amount,"paymentDate","paymentMethod","idempotencyKey","createdById") VALUES (gen_random_uuid(),'${contractId}','${other.id}',100,'2032-05-01','CASH','${randomUUID()}','${admin}')`,
    );

    const b = await newContract({ personId, days: 5, start: "2032-05-01" });
    const bSchedule = (await schedulesOf(b.contract.id))[0];
    const run = await prisma.allocationRun.findFirstOrThrow({ where: { contractId } });
    await rejects(
      `INSERT INTO payment_allocations (id,"contractId","paymentId","scheduleId",amount,"createdRunId") VALUES (gen_random_uuid(),'${contractId}','${paymentId}','${bSchedule.id}',100,'${run.id}')`,
    );
  });

  it("over-allocation or an allocation without its projection rolls back the whole transaction", async () => {
    const small = await pay(contractId, 100, "2032-05-02");
    const s3 = (await schedulesOf(contractId))[2];
    const run = await prisma.allocationRun.findFirstOrThrow({ where: { contractId } });
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.payment.create({
          data: {
            id: randomUUID(),
            contractId,
            personId,
            amount: 5,
            paymentDate: new Date("2032-05-02T00:00:00Z"),
            paymentMethod: "CASH",
            idempotencyKey: "rollback-probe",
            createdById: (await adminActor()).userId!,
          },
        });
        // ₹750 against a ₹1 payment, projection updated to look consistent
        await tx.paymentAllocation.create({ data: { contractId, paymentId: small.payment.id, scheduleId: s3.id, amount: rs(750), createdRunId: run.id } });
        await tx.collectionSchedule.update({ where: { id: s3.id }, data: { allocatedAmount: rs(750), status: "PAID" } });
      }),
    ).rejects.toThrow(/over-allocated/);
    expect(await prisma.payment.findUnique({ where: { idempotencyKey: "rollback-probe" } })).toBeNull();
    expect((await schedulesOf(contractId))[2].allocatedAmount).toBe(0);
  });

  it("a failing step inside a service rolls back earlier steps (correction onto a completed contract)", async () => {
    const done = await newContract({ personId, days: 1, daily: 500, principal: 400, start: "2032-05-02" });
    await pay(done.contract.id, 500, "2032-05-02");
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: done.contract.id } })).status).toBe("COMPLETED");

    const ledgerBefore = await prisma.ledgerEntry.count();
    await expect(
      correctPayment(
        {
          originalPaymentId: paymentId,
          contractId: done.contract.id, // insert step will throw INVALID_STATE after the reversal step ran
          amount: rs(750),
          paymentDate: d("2032-05-02"),
          paymentMethod: "CASH",
          reason: "move it",
          idempotencyKey: randomUUID(),
        },
        await adminActor(),
        { now: ist("2032-05-02", "15:00") },
      ),
    ).rejects.toEqual(domainCode("INVALID_STATE"));

    expect((await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("ACTIVE");
    expect(await prisma.ledgerEntry.count()).toBe(ledgerBefore);
    expect(await prisma.paymentAllocation.count({ where: { paymentId, voidedAt: null } })).toBe(1);
    await expectClean(contractId, ist("2032-05-02", "15:00"));
  });

  it("payments cannot be future-dated or predate the contract", async () => {
    await expect(pay(contractId, 750, "2032-05-10", { now: ist("2032-05-02", "15:00") })).rejects.toEqual(domainCode("INVALID_INPUT"));
    await expect(pay(contractId, 750, "2032-04-30", { now: ist("2032-05-02", "15:00") })).rejects.toEqual(domainCode("INVALID_INPUT"));
  });
});

describe("8 · Sunday / public holiday (2033)", () => {
  it("is an ordinary collection day and is marked missed if unpaid (Case 10)", async () => {
    // 15 Aug 2033 is Independence Day; 14 Aug 2033 is a Sunday.
    const { contract } = await newContract({ name: "Holiday Test", days: 3, start: "2033-08-14" });
    await reconcileDailyCollections("CRON", { now: ist("2033-08-16", "00:05") });
    expect(await statusMap(contract.id)).toEqual({ "2033-08-14": "MISSED", "2033-08-15": "MISSED", "2033-08-16": "PENDING" });
  });
});
