import { describe, expect, it } from "vitest";
import {
  allocateOldestFirst,
  coverageAtClose,
  diffAllocations,
  explainPayment,
  type ExistingAllocation,
} from "@/lib/finance/allocation";
import { planContractState, summarizeContract, type ScheduleRecord } from "@/lib/finance/contract-state";
import { addDays } from "@/lib/finance/dates";
import { schedulesToCancel } from "@/lib/finance/schedule-status";
import { ctxOn, d, facts, makeContract, pay, rs } from "./helpers";

/** Apply a plan's projection to schedules/allocations, as the DB layer would. */
function applyPlan(
  schedules: ScheduleRecord[],
  active: ExistingAllocation[],
  plan: ReturnType<typeof planContractState>,
  nowIso = "2026-10-01T00:00:00Z",
) {
  const voided = new Set(plan.toVoid.map((a) => a.id));
  let n = active.length;
  const nextActive = [
    ...active.filter((a) => !voided.has(a.id)),
    ...plan.toCreate.map((a) => ({ ...a, id: `A${++n}-${a.paymentId}-${a.scheduleId}` })),
  ];
  const byId = new Map(plan.scheduleUpdates.map((u) => [u.id, u]));
  const nextSchedules = schedules.map((s) => {
    const u = byId.get(s.id);
    if (!u) return s;
    return {
      ...s,
      allocatedAmount: u.allocatedAmount,
      status: u.status,
      cancelled: s.cancelled || u.cancel,
      missedAt: s.missedAt ?? (u.markMissed ? nowIso : null),
    };
  });
  return { schedules: nextSchedules, active: nextActive };
}

const byDate = (schedules: ScheduleRecord[], date: string) => schedules.find((s) => s.scheduledDate === date)!;

describe("allocation engine — single day scenarios", () => {
  it("₹750 expected + ₹750 received → PAID", () => {
    const c = makeContract();
    const plan = planContractState(facts(c, [pay(750, "2026-09-27")]), ctxOn("2026-09-28"));
    const s = applyPlan(c.schedules, [], plan).schedules;
    expect(byDate(s, "2026-09-27")).toMatchObject({ allocatedAmount: rs(750), status: "PAID" });
    expect(plan.result.unallocatedByPayment.get(plan.toCreate[0].paymentId)).toBe(0);
  });

  it("₹750 expected + ₹0 → PENDING before cutoff, MISSED after", () => {
    const c = makeContract();
    const during = planContractState(facts(c, []), ctxOn("2026-09-27"));
    expect(during.scheduleUpdates.find((u) => u.id === "S001")).toBeUndefined(); // still PENDING

    const after = planContractState(facts(c, []), ctxOn("2026-09-28"));
    const u = after.scheduleUpdates.find((x) => x.id === "S001")!;
    expect(u.status).toBe("MISSED");
    expect(u.markMissed).toEqual({ shortfall: rs(750) });
    // Only the closed day is touched — 28 Sep is today and stays PENDING.
    expect(after.scheduleUpdates.map((x) => x.id)).toEqual(["S001"]);
  });

  it("₹750 expected + ₹500 → PARTIAL with ₹250 outstanding", () => {
    const c = makeContract();
    const today = planContractState(facts(c, [pay(500, "2026-09-27")]), ctxOn("2026-09-27"));
    expect(today.scheduleUpdates[0]).toMatchObject({ id: "S001", status: "PARTIAL", markMissed: null });

    const closed = planContractState(facts(c, [pay(500, "2026-09-27")]), ctxOn("2026-09-28"));
    expect(closed.scheduleUpdates[0]).toMatchObject({ status: "PARTIAL", markMissed: { shortfall: rs(250) } });
  });

  it("₹750 expected + ₹1,500 on the same day → today PAID, tomorrow prepaid (advance)", () => {
    const c = makeContract();
    const p = pay(1500, "2026-09-27");
    const plan = planContractState(facts(c, [p]), ctxOn("2026-09-27"));
    const s = applyPlan(c.schedules, [], plan).schedules;
    expect(byDate(s, "2026-09-27")).toMatchObject({ allocatedAmount: rs(750), status: "PAID" });
    expect(byDate(s, "2026-09-28")).toMatchObject({ allocatedAmount: rs(750), status: "PAID" });
    const why = explainPayment(p, plan.result, c.schedules);
    expect(why.lines.map((l) => [l.scheduledDate, l.amount, l.kind])).toEqual([
      ["2026-09-27", rs(750), "CURRENT"],
      ["2026-09-28", rs(750), "ADVANCE"],
    ]);
  });

  it("overpayment ₹1,000 on ₹750 → ₹250 carried to the next day, nothing lost", () => {
    const c = makeContract();
    const p = pay(1000, "2026-09-27");
    const plan = planContractState(facts(c, [p]), ctxOn("2026-09-27"));
    const why = explainPayment(p, plan.result, c.schedules);
    expect(why.lines.map((l) => [l.scheduledDate, l.amount, l.kind])).toEqual([
      ["2026-09-27", rs(750), "CURRENT"],
      ["2026-09-28", rs(250), "ADVANCE"],
    ]);
    expect(why.credit).toBe(0);
  });
});

describe("allocation engine — the brief's worked examples", () => {
  it("missed 28 Sep, ₹1,500 on 29 Sep → covers 28 (SETTLED_LATE) and 29 (PAID)", () => {
    const c = makeContract();
    let state = { schedules: c.schedules, active: [] as ExistingAllocation[] };
    const p27 = pay(750, "2026-09-27");

    // Night of 28 Sep: reconciliation closes 28 → MISSED.
    let plan = planContractState(facts({ ...c, schedules: state.schedules }, [p27], state.active), ctxOn("2026-09-29"));
    state = applyPlan(state.schedules, state.active, plan);
    expect(byDate(state.schedules, "2026-09-28")).toMatchObject({ status: "MISSED" });
    expect(byDate(state.schedules, "2026-09-28").missedAt).not.toBeNull();

    // 29 Sep: ₹1,500 received.
    const p29 = pay(1500, "2026-09-29");
    plan = planContractState(facts({ ...c, schedules: state.schedules }, [p27, p29], state.active), ctxOn("2026-09-29"));
    // Appending the newest payment never disturbs earlier rows.
    expect(plan.toVoid).toEqual([]);
    expect(plan.toCreate).toEqual([
      { paymentId: p29.id, scheduleId: "S002", amount: rs(750) },
      { paymentId: p29.id, scheduleId: "S003", amount: rs(750) },
    ]);
    state = applyPlan(state.schedules, state.active, plan);
    expect(byDate(state.schedules, "2026-09-27").status).toBe("PAID");
    expect(byDate(state.schedules, "2026-09-28").status).toBe("SETTLED_LATE"); // missed, later settled
    expect(byDate(state.schedules, "2026-09-29").status).toBe("PAID");

    const why = explainPayment(p29, plan.result, c.schedules);
    expect(why.lines.map((l) => [l.scheduledDate, l.kind])).toEqual([
      ["2026-09-28", "ARREARS"],
      ["2026-09-29", "CURRENT"],
    ]);
  });

  it("partial ₹500 then ₹1,000 next day → ₹250 to arrears, ₹750 to today, ₹0 left", () => {
    const c = makeContract();
    const p1 = pay(500, "2026-09-27");
    const p2 = pay(1000, "2026-09-28");
    const plan = planContractState(facts(c, [p1, p2]), ctxOn("2026-09-28"));
    const s = applyPlan(c.schedules, [], plan).schedules;
    expect(byDate(s, "2026-09-27")).toMatchObject({ allocatedAmount: rs(750), status: "SETTLED_LATE" });
    expect(byDate(s, "2026-09-28")).toMatchObject({ allocatedAmount: rs(750), status: "PAID" });
    const why = explainPayment(p2, plan.result, c.schedules);
    expect(why.lines.map((l) => [l.amount, l.kind])).toEqual([
      [rs(250), "ARREARS"],
      [rs(750), "CURRENT"],
    ]);
    expect(why.credit).toBe(0);
  });

  it("multiple missed days + large payment clears oldest first", () => {
    const c = makeContract();
    // Nothing for 27–30 Sep; ₹4,000 on 1 Oct.
    const p = pay(4000, "2026-10-01");
    const plan = planContractState(facts(c, [p]), ctxOn("2026-10-01"));
    const s = applyPlan(c.schedules, [], plan).schedules;
    for (const date of ["2026-09-27", "2026-09-28", "2026-09-29", "2026-09-30"]) {
      expect(byDate(s, date).status).toBe("SETTLED_LATE");
    }
    expect(byDate(s, "2026-10-01")).toMatchObject({ allocatedAmount: rs(750), status: "PAID" });
    expect(byDate(s, "2026-10-02")).toMatchObject({ allocatedAmount: rs(250) }); // advance
    // Those 4 days closed with no payment dated on/before them → flagged missed.
    expect(plan.scheduleUpdates.filter((u) => u.markMissed).map((u) => u.id)).toEqual(["S001", "S002", "S003", "S004"]);
  });

  it("several days paid in advance", () => {
    const c = makeContract();
    const plan = planContractState(facts(c, [pay(7500, "2026-09-27")]), ctxOn("2026-09-27"));
    const s = applyPlan(c.schedules, [], plan).schedules;
    expect(s.slice(0, 10).every((x) => x.allocatedAmount === rs(750))).toBe(true);
    expect(s[10].allocatedAmount).toBe(0);
    const sum = summarizeContract(
      { principalAmount: rs(50_000), expectedCollectionAmount: rs(75_000), activePaymentsTotal: rs(7500), schedules: s },
      ctxOn("2026-09-27"),
    );
    expect(sum.prepaid).toBe(rs(6750)); // 9 future days
    expect(sum.todayAllocated).toBe(rs(750));
    expect(sum.credit).toBe(0);
    expect(sum.outstanding).toBe(rs(67_500));
    expect(sum.overdue).toBe(0);
    expect(sum.daysSatisfied).toBe(10);
  });

  it("multiple payments on the same day are ordered by recordedAt", () => {
    const c = makeContract();
    const a = pay(300, "2026-09-27");
    const b = pay(450, "2026-09-27");
    const r = allocateOldestFirst(c.schedules, [b, a]);
    expect(r.allocations).toEqual([
      { paymentId: a.id, scheduleId: "S001", amount: rs(300) },
      { paymentId: b.id, scheduleId: "S001", amount: rs(450) },
    ]);
  });

  it("overpaying the whole contract leaves unallocated credit", () => {
    const c = makeContract({ days: 3 });
    const p = pay(3000, "2026-09-27");
    const r = allocateOldestFirst(c.schedules, [p]);
    expect(r.unallocatedByPayment.get(p.id)).toBe(rs(750));
    const plan = planContractState(facts(c, [p]), ctxOn("2026-09-27"));
    expect(plan.fullyCollected).toBe(true);
  });
});

describe("allocation engine — corrections, reversals, determinism", () => {
  it("reversal re-flows later payments so FIFO still holds", () => {
    const c = makeContract();
    const p1 = pay(750, "2026-09-27");
    const p2 = pay(750, "2026-09-28");
    let plan = planContractState(facts(c, [p1, p2]), ctxOn("2026-09-28"));
    let state = applyPlan(c.schedules, [], plan);

    // p1 was entered wrongly and is reversed.
    plan = planContractState(facts({ ...c, schedules: state.schedules }, [p2], state.active), ctxOn("2026-09-29"));
    expect(plan.toVoid.map((a) => a.paymentId).sort()).toEqual([p1.id, p2.id].sort());
    expect(plan.toCreate).toEqual([{ paymentId: p2.id, scheduleId: "S001", amount: rs(750) }]);
    state = applyPlan(state.schedules, state.active, plan);
    expect(byDate(state.schedules, "2026-09-27").status).toBe("SETTLED_LATE"); // now covered late, by p2 (dated 28)
    expect(byDate(state.schedules, "2026-09-28").status).toBe("MISSED");
  });

  it("correction ₹1,500 → ₹1,000: reverse + replace yields the same state as entering ₹1,000", () => {
    const c = makeContract();
    const wrong = pay(1500, "2026-09-27", "P-wrong");
    let plan = planContractState(facts(c, [wrong]), ctxOn("2026-09-27"));
    let state = applyPlan(c.schedules, [], plan);

    const right = pay(1000, "2026-09-27", "P-right");
    plan = planContractState(facts({ ...c, schedules: state.schedules }, [right], state.active), ctxOn("2026-09-27"));
    state = applyPlan(state.schedules, state.active, plan);

    const fresh = planContractState(facts(c, [right]), ctxOn("2026-09-27"));
    expect(state.active.map(({ paymentId, scheduleId, amount }) => ({ paymentId, scheduleId, amount }))).toEqual(
      fresh.result.allocations,
    );
    expect(byDate(state.schedules, "2026-09-28").allocatedAmount).toBe(rs(250));
  });

  it("back-dated payment yields the same coverage as in-order entry", () => {
    const c = makeContract();
    const late = pay(750, "2026-09-27");
    const early = pay(750, "2026-09-28");
    const r1 = allocateOldestFirst(c.schedules, [late, early]);
    const r2 = allocateOldestFirst(c.schedules, [early, late]);
    expect(r1).toEqual(r2);
  });

  it("re-planning an applied state is a no-op (idempotent reconciliation)", () => {
    const c = makeContract();
    const payments = [pay(750, "2026-09-27"), pay(1500, "2026-09-29")];
    const plan = planContractState(facts(c, payments), ctxOn("2026-09-30"));
    const state = applyPlan(c.schedules, [], plan);
    const again = planContractState(facts({ ...c, schedules: state.schedules }, payments, state.active), ctxOn("2026-09-30"));
    expect(again.toVoid).toEqual([]);
    expect(again.toCreate).toEqual([]);
    expect(again.scheduleUpdates).toEqual([]);
  });

  it("missed-at-close is independent of when reconciliation runs", () => {
    const c = makeContract();
    // Money for 28 Sep was collected on the 28th but only keyed in on the 30th (back-dated).
    const payments = [pay(750, "2026-09-27"), pay(750, "2026-09-28")];
    const onTime = coverageAtClose(c.schedules, payments);
    expect(onTime.get("S002")).toBe(rs(750));
    const plan = planContractState(facts(c, payments), ctxOn("2026-09-30"));
    expect(plan.scheduleUpdates.find((u) => u.id === "S002")).toMatchObject({ status: "PAID", markMissed: null });
    expect(plan.scheduleUpdates.find((u) => u.id === "S003")).toMatchObject({ status: "MISSED" });
  });

  it("diff treats duplicate identical rows as a multiset", () => {
    const line = { paymentId: "P", scheduleId: "S", amount: rs(1) };
    const active = [
      { ...line, id: "a" },
      { ...line, id: "b" },
    ];
    expect(diffAllocations(active, [line])).toEqual({ toVoid: [{ ...line, id: "b" }], toCreate: [] });
  });
});

describe("contract lifecycle", () => {
  it("cancellation: arrears stay owed, prepaid days stay paid, unpaid future days are CANCELLED", () => {
    const c = makeContract({ days: 6 });
    // 27 Sep: ₹750 · 28 Sep: nothing · 29 Sep: ₹2,000 (covers 28, 29, and ₹500 of 30).
    const payments = [pay(750, "2026-09-27"), pay(2000, "2026-09-29")];
    let plan = planContractState(facts(c, payments), ctxOn("2026-09-29"));
    let state = applyPlan(c.schedules, [], plan);
    expect(byDate(state.schedules, "2026-09-30").allocatedAmount).toBe(rs(500));

    // Cancelled on 29 Sep: 30 Sep (partly prepaid) + 1–2 Oct (unpaid) are cancelled.
    const cancelIds = new Set(schedulesToCancel(state.schedules, d("2026-09-29")));
    expect([...cancelIds]).toEqual(["S004", "S005", "S006"]);
    plan = planContractState(facts({ schedules: state.schedules }, payments, state.active), ctxOn("2026-09-29"), {
      cancelScheduleIds: cancelIds,
    });
    // The ₹500 on 30 Sep is released → unallocated credit. Nothing is lost.
    expect(plan.toVoid.map((a) => a.scheduleId)).toEqual(["S004"]);
    expect(plan.toCreate).toEqual([]);
    state = applyPlan(state.schedules, state.active, plan);
    expect(state.schedules.map((s) => s.status)).toEqual(["PAID", "SETTLED_LATE", "PAID", "CANCELLED", "CANCELLED", "CANCELLED"]);
    expect(plan.fullyCollected).toBe(true); // every remaining obligation is satisfied

    const sum = summarizeContract(
      { principalAmount: rs(3000), expectedCollectionAmount: rs(4500), activePaymentsTotal: rs(2750), schedules: state.schedules },
      ctxOn("2026-09-29"),
    );
    expect(sum).toMatchObject({ cancelledObligation: rs(2250), outstanding: 0, overdue: 0, credit: rs(500), daysCancelled: 3 });
  });

  it("cancellation with arrears: the missed day stays outstanding", () => {
    const c = makeContract({ days: 4 });
    const plan0 = planContractState(facts(c, [pay(750, "2026-09-27")]), ctxOn("2026-09-29"));
    const state = applyPlan(c.schedules, [], plan0);
    const cancelIds = new Set(schedulesToCancel(state.schedules, d("2026-09-29")));
    expect([...cancelIds]).toEqual(["S004"]); // 30 Sep only; 29 Sep is today → still owed
    const plan = planContractState(facts({ schedules: state.schedules }, [pay(750, "2026-09-27", plan0.toCreate[0].paymentId)], state.active), ctxOn("2026-09-29"), {
      cancelScheduleIds: cancelIds,
    });
    const next = applyPlan(state.schedules, state.active, plan).schedules;
    const sum = summarizeContract(
      { principalAmount: rs(2000), expectedCollectionAmount: rs(3000), activePaymentsTotal: rs(750), schedules: next },
      ctxOn("2026-09-29"),
    );
    expect(sum).toMatchObject({ overdue: rs(750), outstanding: rs(1500), cancelledObligation: rs(750) });
    expect(plan.fullyCollected).toBe(false);
  });

  it("does not complete just because a lot was paid — only when every obligation is satisfied", () => {
    const c = makeContract({ days: 3 });
    expect(planContractState(facts(c, [pay(1500, "2026-09-27")]), ctxOn("2026-09-27")).fullyCollected).toBe(false);
    expect(planContractState(facts(c, [pay(2250, "2026-09-27")]), ctxOn("2026-09-27")).fullyCollected).toBe(true);
  });

  it("multiple contracts never share money", () => {
    const a = makeContract({ daily: 750 });
    const b = makeContract({ daily: 500, days: 80, principal: 30_000 });
    const pa = pay(1500, "2026-09-27");
    const planA = planContractState(facts(a, [pa]), ctxOn("2026-09-28"));
    const planB = planContractState(facts(b, []), ctxOn("2026-09-28"));
    expect(planA.scheduleUpdates.find((u) => u.id === "S001")?.status).toBe("PAID");
    expect(planB.scheduleUpdates.find((u) => u.id === "S001")?.status).toBe("MISSED");
    expect(planB.toCreate).toEqual([]);
  });

  it("Sundays and public holidays are ordinary collection days", () => {
    const c = makeContract({ first: "2026-10-01", days: 5 }); // Thu 1 Oct … Mon 5 Oct; 2 Oct = Gandhi Jayanti, 4 Oct = Sunday
    expect(c.schedules.map((s) => s.scheduledDate)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
    const plan = planContractState(facts(c, [pay(750, "2026-10-01"), pay(750, "2026-10-03")]), ctxOn("2026-10-05"));
    const s = applyPlan(c.schedules, [], plan).schedules;
    expect(s.map((x) => x.status)).toEqual(["PAID", "SETTLED_LATE", "MISSED", "MISSED", "PENDING"]);
  });

  it("summary: 37 of 100 obligations satisfied on Dharmjit's contract", () => {
    const c = makeContract();
    const payments = Array.from({ length: 37 }, (_, i) => pay(750, addDays(d("2026-09-27"), i)));
    const today = addDays(d("2026-09-27"), 37); // day 38, still open
    const plan = planContractState(facts(c, payments), ctxOn(today));
    const s = applyPlan(c.schedules, [], plan).schedules;
    const sum = summarizeContract(
      { principalAmount: rs(50_000), expectedCollectionAmount: rs(75_000), activePaymentsTotal: rs(27_750), schedules: s },
      ctxOn(today),
    );
    expect(sum).toMatchObject({
      principal: rs(50_000),
      contractedCollection: rs(75_000),
      contractualMargin: rs(25_000),
      collected: rs(27_750),
      outstanding: rs(47_250),
      daysSatisfied: 37,
      daysTotal: 100,
      overdue: 0,
      todayExpected: rs(750),
      todayAllocated: 0,
      prepaid: 0,
      credit: 0,
    });
  });
});
