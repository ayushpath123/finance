/**
 * Short-term loans against a real Postgres (2060 era).
 * Money out → money back (whole or in parts) → closes; settle for less; reverse; cancel.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db/client";
import { createPerson } from "@/lib/services/people";
import { getPeopleDirectory, getPersonDashboard, getPersonLedger } from "@/lib/services/read-models";
import { checkShortTermIntegrity } from "@/lib/services/integrity";
import {
  cancelShortTermLoan,
  createShortTermLoan,
  recordShortTermRepayment,
  reverseShortTermRepayment,
  settleShortTermLoan,
} from "@/lib/services/short-term";
import type { Actor } from "@/lib/services/actor";
import { adminActor, d, ist, rs } from "./fixtures";

const domainCode = (code: string) => expect.objectContaining({ name: "DomainError", code });
let actor: Actor;
let personId: string;

beforeAll(async () => {
  actor = await adminActor();
  personId = (await createPerson({ fullName: "Shortterm Suresh", phoneNumber: "9811100001" }, actor, { now: ist("2060-01-01", "09:00") })).id;
});

const give = (principal: number, interest: number, date: string, key = randomUUID()) =>
  createShortTermLoan(
    { personId, direction: "LENT", principalAmount: rs(principal), interestAmount: rs(interest), givenOn: d(date), method: "CASH", idempotencyKey: key },
    actor,
    { now: ist(date, "10:00") },
  );
const back = (loanId: string, amount: number, date: string, opts: { key?: string; time?: string } = {}) =>
  recordShortTermRepayment(
    { loanId, amount: rs(amount), receivedOn: d(date), method: "UPI", idempotencyKey: opts.key ?? randomUUID() },
    actor,
    { now: ist(date, opts.time ?? "18:00") },
  );
const clean = async (loanId: string) => expect(await checkShortTermIntegrity(loanId)).toEqual([]);

describe("short-term loans", () => {
  it("giving money creates the loan, a ledger entry and an audit event; double submit is recorded once", async () => {
    const key = randomUUID();
    const { loan, duplicate } = await give(10_000, 500, "2060-01-02", key);
    expect(duplicate).toBe(false);
    expect(loan).toMatchObject({ status: "OPEN", principalAmount: rs(10_000), interestAmount: rs(500), createdById: actor.userId });
    expect(await prisma.ledgerEntry.findMany({ where: { shortTermLoanId: loan.id } })).toEqual([
      expect.objectContaining({ entryType: "SHORT_TERM_GIVEN", amount: -rs(10_000), contractId: null }),
    ]);
    expect(await prisma.auditLog.count({ where: { entityId: loan.id, action: "SHORT_TERM_LOAN_CREATED", userId: actor.userId } })).toBe(1);

    const again = await give(10_000, 500, "2060-01-02", key);
    expect(again).toMatchObject({ duplicate: true, loan: { id: loan.id } });
    await clean(loan.id);
  });

  it("getting the full amount back closes the loan", async () => {
    const { loan } = await give(5_000, 250, "2060-01-03");
    const r = await back(loan.id, 5_250, "2060-01-10");
    expect(r.closed).toBe(true);
    const closed = await prisma.shortTermLoan.findUniqueOrThrow({ where: { id: loan.id } });
    expect(closed).toMatchObject({ status: "CLOSED", closedById: actor.userId, waivedAmount: null });
    expect(closed.closedOn?.toISOString().slice(0, 10)).toBe("2060-01-10");
    expect(await prisma.auditLog.count({ where: { entityId: loan.id, action: "SHORT_TERM_LOAN_CLOSED" } })).toBe(1);
    await expect(back(loan.id, 1, "2060-01-11")).rejects.toEqual(domainCode("INVALID_STATE"));
    await clean(loan.id);
  });

  it("money can come back in parts; it closes on the last part; more than outstanding is refused", async () => {
    const { loan } = await give(10_000, 1_000, "2060-01-04");
    expect((await back(loan.id, 4_000, "2060-01-05")).closed).toBe(false);
    await expect(back(loan.id, 8_000, "2060-01-06")).rejects.toEqual(domainCode("INVALID_INPUT")); // only 7,000 left
    expect((await back(loan.id, 3_000, "2060-01-06")).closed).toBe(false);
    expect((await back(loan.id, 4_000, "2060-01-07")).closed).toBe(true);
    expect((await prisma.shortTermLoan.findUniqueOrThrow({ where: { id: loan.id } })).status).toBe("CLOSED");
    await clean(loan.id);
  });

  it("settle for less: records what was let go, and needs a reason when waiving", async () => {
    const { loan } = await give(8_000, 800, "2060-01-08");
    await back(loan.id, 8_000, "2060-01-09");
    const input = { loanId: loan.id, finalAmount: rs(0), receivedOn: d("2060-01-09"), method: "CASH" as const, idempotencyKey: randomUUID() };
    await expect(settleShortTermLoan(input, actor, { now: ist("2060-01-09", "19:00") })).rejects.toEqual(domainCode("INVALID_INPUT"));
    const r = await settleShortTermLoan({ ...input, note: "Interest forgiven — family emergency" }, actor, { now: ist("2060-01-09", "19:00") });
    expect(r.waived).toBe(rs(800));
    expect(await prisma.shortTermLoan.findUniqueOrThrow({ where: { id: loan.id } })).toMatchObject({ status: "CLOSED", waivedAmount: rs(800) });

    // settle with a final partial amount
    const l2 = (await give(3_000, 300, "2060-01-08")).loan;
    const r2 = await settleShortTermLoan(
      { loanId: l2.id, finalAmount: rs(3_100), receivedOn: d("2060-01-10"), method: "UPI", note: "Rounded down", idempotencyKey: randomUUID() },
      actor,
      { now: ist("2060-01-10", "12:00") },
    );
    expect(r2.waived).toBe(rs(200));
    expect(await prisma.shortTermRepayment.count({ where: { loanId: l2.id, status: "ACTIVE" } })).toBe(1);
    await clean(loan.id);
    await clean(l2.id);
  });

  it("reversing a repayment on a closed loan reopens it (and undoes any waiver)", async () => {
    const { loan } = await give(2_000, 200, "2060-01-11");
    const r = await back(loan.id, 2_200, "2060-01-12");
    const { reopened } = await reverseShortTermRepayment({ repaymentId: r.repayment.id, reason: "Entered against the wrong loan" }, actor, {
      now: ist("2060-01-12", "20:00"),
    });
    expect(reopened).toBe(true);
    expect(await prisma.shortTermLoan.findUniqueOrThrow({ where: { id: loan.id } })).toMatchObject({ status: "OPEN", closedAt: null, waivedAmount: null });
    expect(await prisma.shortTermRepayment.findUniqueOrThrow({ where: { id: r.repayment.id } })).toMatchObject({ status: "REVERSED", reversedById: actor.userId });
    expect(await prisma.ledgerEntry.count({ where: { shortTermRepaymentId: r.repayment.id } })).toBe(2); // original + reversal, both kept
    await expect(reverseShortTermRepayment({ repaymentId: r.repayment.id, reason: "again" }, actor)).rejects.toEqual(domainCode("INVALID_STATE"));
    await clean(loan.id);
  });

  it("cancel (entered by mistake) only while nothing has been received", async () => {
    const { loan } = await give(1_500, 100, "2060-01-13");
    const r = await back(loan.id, 500, "2060-01-13");
    await expect(cancelShortTermLoan({ loanId: loan.id, reason: "wrong person" }, actor)).rejects.toEqual(domainCode("INVALID_STATE"));
    await reverseShortTermRepayment({ repaymentId: r.repayment.id, reason: "wrong person" }, actor, { now: ist("2060-01-13", "19:00") });
    await cancelShortTermLoan({ loanId: loan.id, reason: "Entered for the wrong person" }, actor, { now: ist("2060-01-13", "19:05") });
    expect((await prisma.shortTermLoan.findUniqueOrThrow({ where: { id: loan.id } })).status).toBe("CANCELLED");
    expect(await prisma.ledgerEntry.findFirst({ where: { shortTermLoanId: loan.id, entryType: "SHORT_TERM_CANCELLED" } })).toMatchObject({ amount: rs(1_500) });
    await expect(back(loan.id, 1, "2060-01-14")).rejects.toEqual(domainCode("INVALID_STATE"));
    await clean(loan.id);
  });

  it("date rules: nothing in the future, nothing before the money was given", async () => {
    await expect(give(1_000, 0, "2060-01-20").then(() => undefined)).resolves.toBeUndefined(); // interest-free is fine
    await expect(
      createShortTermLoan({ personId, direction: "LENT", principalAmount: rs(1), interestAmount: rs(0), givenOn: d("2060-02-01"), method: "CASH", idempotencyKey: randomUUID() }, actor, {
        now: ist("2060-01-20", "10:00"),
      }),
    ).rejects.toEqual(domainCode("INVALID_INPUT"));
    const { loan } = await give(1_000, 50, "2060-01-21");
    await expect(back(loan.id, 100, "2060-01-20")).rejects.toEqual(domainCode("INVALID_INPUT"));
  });

  it("two repayments at the same moment can never over-collect", async () => {
    const { loan } = await give(10_000, 500, "2060-01-22");
    const results = await Promise.allSettled([back(loan.id, 6_000, "2060-01-23", { time: "10:00" }), back(loan.id, 6_000, "2060-01-23", { time: "10:00" })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const sum = await prisma.shortTermRepayment.aggregate({ where: { loanId: loan.id, status: "ACTIVE" }, _sum: { amount: true } });
    expect(sum._sum.amount).toBe(rs(6_000));
    await clean(loan.id);
  });

  it("the person's dashboard, search and statement include short-term loans", async () => {
    const now = ist("2060-01-23", "20:00");
    const dash = (await getPersonDashboard(personId, { now }))!;
    const open = dash.shortTermLoans.filter((l) => l.status === "OPEN");
    expect(dash.shortTerm.open).toBe(open.length);
    expect(dash.shortTerm.outstanding).toBe(open.reduce((t, l) => t + l.outstanding, 0));
    expect(dash.totalOutstanding).toBe(dash.totals.outstanding + dash.shortTerm.outstanding);

    const label = dash.shortTermLoans[0].label;
    expect((await getPeopleDirectory({ q: label, now })).items.map((i) => i.id)).toEqual([personId]);

    const ledger = await getPersonLedger(personId);
    expect(ledger.some((e) => e.type === "SHORT_TERM_GIVEN" && e.contractLabel.startsWith("ST-") && e.href.startsWith("/short-term/"))).toBe(true);
  });
});

describe("short-term loans — database guarantees", () => {
  let loanId: string;
  let repaymentId: string;
  beforeAll(async () => {
    loanId = (await give(9_000, 900, "2060-02-01")).loan.id;
    repaymentId = (await back(loanId, 1_000, "2060-02-02")).repayment.id;
  });
  const rejects = (sql: string) => expect(prisma.$executeRawUnsafe(sql)).rejects.toThrow();

  it("terms and repayments are immutable; nothing can be deleted", async () => {
    await rejects(`UPDATE short_term_loans SET "principalAmount" = 1 WHERE id = '${loanId}'`);
    await rejects(`UPDATE short_term_loans SET "interestAmount" = 0 WHERE id = '${loanId}'`);
    await rejects(`UPDATE short_term_loans SET "givenOn" = '2059-01-01' WHERE id = '${loanId}'`);
    await rejects(`DELETE FROM short_term_loans WHERE id = '${loanId}'`);
    await rejects(`UPDATE short_term_repayments SET amount = 1 WHERE id = '${repaymentId}'`);
    await rejects(`DELETE FROM short_term_repayments WHERE id = '${repaymentId}'`);
  });

  it("balance rules hold at commit: no over-repayment, no 'fully repaid but open', no fake close", async () => {
    const admin = actor.userId;
    await rejects(
      `INSERT INTO short_term_repayments (id,"loanId","personId",amount,"receivedOn",method,"idempotencyKey","createdById") VALUES (gen_random_uuid(),'${loanId}','${personId}',${rs(50_000)},'2060-02-02','CASH','${randomUUID()}','${admin}')`,
    );
    await rejects(
      `INSERT INTO short_term_repayments (id,"loanId","personId",amount,"receivedOn",method,"idempotencyKey","createdById") VALUES (gen_random_uuid(),'${loanId}','${personId}',${rs(8_900)},'2060-02-02','CASH','${randomUUID()}','${admin}')`,
    ); // exactly fully repaid but loan left OPEN
    await rejects(`UPDATE short_term_loans SET status='CLOSED', "closedOn"='2060-02-02', "closedAt"=now(), "closedById"='${admin}' WHERE id='${loanId}'`); // 1,000 of 9,900 back
    await rejects(`UPDATE short_term_loans SET status='CANCELLED', "cancelledAt"=now(), "cancelledById"='${admin}' WHERE id='${loanId}'`); // has a repayment
  });

  it("a repayment can't name another person, and a ledger row can't belong to both a contract and a loan", async () => {
    const other = await createPerson({ fullName: "Someone Else ST", phoneNumber: "9811100002" }, actor);
    await rejects(
      `INSERT INTO short_term_repayments (id,"loanId","personId",amount,"receivedOn",method,"idempotencyKey","createdById") VALUES (gen_random_uuid(),'${loanId}','${other.id}',100,'2060-02-02','CASH','${randomUUID()}','${actor.userId}')`,
    );
    const anyContract = await prisma.contract.findFirst({ where: { personId }, select: { id: true } });
    await rejects(
      `INSERT INTO ledger_entries (id,"personId","contractId","shortTermLoanId","entryType",amount,"effectiveDate",description) VALUES (gen_random_uuid(),'${personId}',${anyContract ? `'${anyContract.id}'` : "NULL"},'${loanId}','SHORT_TERM_GIVEN',-1,'2060-02-02','x')`,
    );
    await rejects(
      `INSERT INTO ledger_entries (id,"personId","shortTermLoanId","entryType",amount,"effectiveDate",description) VALUES (gen_random_uuid(),'${personId}','${loanId}','COLLECTION',1,'2060-02-02','x')`,
    );
  });
});

describe("borrowings (money I borrowed and pay back)", () => {
  let lenderId: string;
  beforeAll(async () => {
    lenderId = (await createPerson({ fullName: "Lender Lalit", phoneNumber: "9811100003" }, actor, { now: ist("2060-03-01", "09:00") })).id;
  });
  const borrow = (principal: number, interest: number, date: string) =>
    createShortTermLoan(
      { personId: lenderId, direction: "BORROWED", principalAmount: rs(principal), interestAmount: rs(interest), givenOn: d(date), method: "BANK_TRANSFER", idempotencyKey: randomUUID() },
      actor,
      { now: ist(date, "10:00") },
    );

  it("money in is +, paying back is −; it closes when fully paid back", async () => {
    const { loan } = await borrow(50_000, 2_000, "2060-03-02");
    expect(loan.direction).toBe("BORROWED");
    expect(await prisma.ledgerEntry.findMany({ where: { shortTermLoanId: loan.id } })).toEqual([
      expect.objectContaining({ entryType: "BORROWING_RECEIVED", amount: rs(50_000) }),
    ]);
    await back(loan.id, 20_000, "2060-03-05");
    const last = await back(loan.id, 32_000, "2060-03-10");
    expect(last.closed).toBe(true);
    const ledger = await prisma.ledgerEntry.findMany({ where: { shortTermLoanId: loan.id }, orderBy: { createdAt: "asc" } });
    expect(ledger.map((l) => [l.entryType, l.amount])).toEqual([
      ["BORROWING_RECEIVED", rs(50_000)],
      ["BORROWING_REPAID", -rs(20_000)],
      ["BORROWING_REPAID", -rs(32_000)],
    ]);
    await clean(loan.id);
  });

  it("the lender letting you off the rest, reversal and cancellation all keep the right signs", async () => {
    const { loan } = await borrow(10_000, 1_000, "2060-03-11");
    const r = await back(loan.id, 10_000, "2060-03-12");
    await settleShortTermLoan(
      { loanId: loan.id, finalAmount: rs(0), receivedOn: d("2060-03-12"), method: "CASH", note: "Lender waived the interest", idempotencyKey: randomUUID() },
      actor,
      { now: ist("2060-03-12", "19:00") },
    );
    expect(await prisma.shortTermLoan.findUniqueOrThrow({ where: { id: loan.id } })).toMatchObject({ status: "CLOSED", waivedAmount: rs(1_000) });
    await reverseShortTermRepayment({ repaymentId: r.repayment.id, reason: "wrong amount" }, actor, { now: ist("2060-03-12", "20:00") });
    expect(await prisma.ledgerEntry.findFirst({ where: { shortTermRepaymentId: r.repayment.id, entryType: "BORROWING_REPAID_REVERSAL" } })).toMatchObject({ amount: rs(10_000) });

    const mistake = (await borrow(500, 0, "2060-03-13")).loan;
    await cancelShortTermLoan({ loanId: mistake.id, reason: "typed twice" }, actor, { now: ist("2060-03-13", "12:00") });
    expect(await prisma.ledgerEntry.findFirst({ where: { shortTermLoanId: mistake.id, entryType: "BORROWING_CANCELLED" } })).toMatchObject({ amount: -rs(500) });
    await clean(loan.id);
    await clean(mistake.id);
  });

  it("what you owe is shown separately and never reduces what they owe you", async () => {
    await createShortTermLoan(
      { personId: lenderId, direction: "LENT", principalAmount: rs(3_000), interestAmount: rs(300), givenOn: d("2060-03-14"), method: "CASH", idempotencyKey: randomUUID() },
      actor,
      { now: ist("2060-03-14", "10:00") },
    );
    const now = ist("2060-03-14", "20:00");
    const dash = (await getPersonDashboard(lenderId, { now }))!;
    expect(dash.shortTerm.outstanding).toBe(rs(3_300)); // they owe you
    expect(dash.borrowed.outstanding).toBe(rs(11_000)); // you owe them (10,000 + 1,000 reopened)
    expect(dash.totalOutstanding).toBe(rs(3_300)); // not netted
    expect(dash.borrowings.every((b) => b.label.startsWith("BR-"))).toBe(true);
    expect(dash.shortTermLoans.every((b) => b.label.startsWith("ST-"))).toBe(true);
    const listed = (await getPeopleDirectory({ q: dash.borrowings[0].label, now })).items;
    expect(listed.map((i) => i.id)).toEqual([lenderId]);
    expect(listed[0].borrowed.outstanding).toBe(rs(11_000));
  });

  it("the database rejects wrong-direction ledger entries and direction changes", async () => {
    const { loan } = await borrow(1_000, 0, "2060-03-15");
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO ledger_entries (id,"personId","shortTermLoanId","entryType",amount,"effectiveDate",description) VALUES (gen_random_uuid(),'${lenderId}','${loan.id}','SHORT_TERM_CANCELLED',100000,'2060-03-15','x')`,
      ),
    ).rejects.toThrow();
    await expect(prisma.$executeRawUnsafe(`UPDATE short_term_loans SET direction = 'LENT' WHERE id = '${loan.id}'`)).rejects.toThrow();
  });
});
