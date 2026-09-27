/**
 * The UI's aggregate SQL must agree, rupee for rupee, with the finance
 * engine's summarizeContract for every contract state. (2050 era.)
 */
import { describe, expect, it } from "vitest";
import { cancelContract } from "@/lib/services/contracts";
import {
  contractAggregates,
  getContractDetail,
  getContractSummary,
  getPeopleDirectory,
  getPersonDashboard,
  totalsOf,
} from "@/lib/services/read-models";
import { reconcileDailyCollections } from "@/lib/services/reconciliation";
import { businessNow, getSettings } from "@/lib/services/settings";
import { adminActor, ist, newContract, pay, rs } from "./fixtures";

describe("read models agree with the finance engine", () => {
  it("across paid, missed, partial, prepaid, cancelled and completed contracts", async () => {
    const a = await newContract({ name: "Readmodel Anand", phone: "9812300001", days: 10, start: "2050-03-01" });
    const b = await newContract({ personId: a.personId, daily: 500, days: 6, principal: 2500, start: "2050-03-01" });
    const c = await newContract({ name: "Readmodel Bhavna", phone: "9812300002", days: 5, start: "2050-03-01" });
    const done = await newContract({ personId: c.personId, days: 2, daily: 400, principal: 600, start: "2050-03-01" });

    await pay(a.contract.id, 750, "2050-03-01");
    await pay(a.contract.id, 300, "2050-03-02"); // partial
    await pay(a.contract.id, 3000, "2050-03-04"); // settles arrears, prepays
    await pay(b.contract.id, 500, "2050-03-01");
    await pay(c.contract.id, 1500, "2050-03-02");
    await pay(done.contract.id, 800, "2050-03-01"); // completes
    await cancelContract({ contractId: c.contract.id, reason: "test" }, await adminActor(), { now: ist("2050-03-03", "12:00") });
    await reconcileDailyCollections("CRON", { now: ist("2050-03-05", "00:05") });

    const now = ist("2050-03-05", "15:00");
    const bn = businessNow(await getSettings(), now);
    const ids = [a, b, c, done].map((x) => x.contract.id);
    const aggs = await contractAggregates({ contractIds: ids }, bn);
    expect(aggs).toHaveLength(4);

    for (const agg of aggs) {
      const s = await getContractSummary(agg.contractId, { now });
      expect({
        collected: agg.collected,
        allocated: agg.allocated,
        outstanding: agg.outstanding,
        overdue: agg.overdue,
        todayExpected: agg.todayExpected,
        todayAllocated: agg.todayAllocated,
        prepaid: agg.prepaid,
        credit: agg.credit,
        cancelledObligation: agg.cancelledObligation,
        daysSatisfied: agg.daysSatisfied,
        daysOverdue: agg.overdueDays,
        daysEverMissed: agg.daysEverMissed,
        contracted: agg.contractedCollection,
      }).toEqual({
        collected: s.collected,
        allocated: s.allocated,
        outstanding: s.outstanding,
        overdue: s.overdue,
        todayExpected: s.todayExpected,
        todayAllocated: s.todayAllocated,
        prepaid: s.prepaid,
        credit: s.credit,
        cancelledObligation: s.cancelledObligation,
        daysSatisfied: s.daysSatisfied,
        daysOverdue: s.daysOverdue,
        daysEverMissed: s.daysEverMissed,
        contracted: s.contractedCollection,
      });
    }

    // Person totals are sums of independent contracts.
    const dash = await getPersonDashboard(a.personId, { now });
    expect(dash!.contracts.map((x) => x.contractId).sort()).toEqual([a.contract.id, b.contract.id].sort());
    const expected = totalsOf(aggs.filter((x) => x.personId === a.personId));
    expect(dash!.totals).toEqual(expected);
    expect(dash!.totals.principalGiven).toBe(rs(50_000 + 2_500));
    expect(dash!.totals.todayExpected).toBe(rs(750 + 500));

    // Cancelled obligations are excluded from the valid contracted total.
    const cAgg = aggs.find((x) => x.contractId === c.contract.id)!;
    expect(cAgg.validContracted).toBe(cAgg.contractedCollection - cAgg.cancelledObligation);
  });

  it("contract detail explains each day: on-time vs late settlement, allocations, money received that day", async () => {
    const { contract } = await newContract({ name: "Readmodel Chetan", phone: "9812300003", days: 5, start: "2050-04-01" });
    await pay(contract.id, 750, "2050-04-01");
    await reconcileDailyCollections("CRON", { now: ist("2050-04-03", "00:05") }); // 2 Apr missed
    await pay(contract.id, 1500, "2050-04-03"); // settles 2 Apr late + pays 3 Apr

    const detail = (await getContractDetail(contract.id, { now: ist("2050-04-03", "20:00") }))!;
    const d2 = detail.days.find((d) => d.date === "2050-04-02")!;
    expect(d2).toMatchObject({ status: "SETTLED_LATE", wasMissed: true, paidOnTime: 0, allocated: rs(750), shortfallAtClose: rs(750) });
    expect(d2.allocations).toEqual([expect.objectContaining({ amount: rs(750), paymentDate: "2050-04-03", paymentAmount: rs(1500) })]);
    expect(d2.receivedThisDay).toEqual([]);
    const d3 = detail.days.find((d) => d.date === "2050-04-03")!;
    expect(d3).toMatchObject({ status: "PAID", display: "PAID", paidOnTime: rs(750) });
    expect(d3.receivedThisDay.map((p) => p.amount)).toEqual([rs(1500)]);
    expect(detail.days.find((d) => d.date === "2050-04-05")!.display).toBe("FUTURE");
  });
});

describe("people search", () => {
  it("finds by name, mobile number fragment and contract number", async () => {
    const { contract, personId } = await newContract({ name: "Searchable Dharmesh", phone: "9812399999", days: 3, start: "2050-05-01" });
    const now = ist("2050-05-01", "12:00");
    const ids = async (q: string) => (await getPeopleDirectory({ q, now })).items.map((i) => i.id);

    expect(await ids("dharm")).toContain(personId);
    expect(await ids("SEARCHABLE")).toContain(personId);
    expect(await ids("99999")).toContain(personId);
    expect(await ids("98123 99999")).toContain(personId);
    expect(await ids(`AF-${String(contract.contractNumber).padStart(4, "0")}`)).toEqual([personId]);
    expect(await ids(`#${contract.contractNumber}`)).toEqual([personId]);
    expect(await ids("zzz-no-such-person")).toEqual([]);

    const me = (await getPeopleDirectory({ q: "Searchable Dharmesh", now })).items[0];
    expect(me.totals).toMatchObject({ activeContracts: 1, todayExpected: rs(750), outstanding: rs(2250) });
    expect(me.paidToday).toBe(false);
  });
});
