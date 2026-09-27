/**
 * Realistic demo data, produced by REPLAYING history through the real
 * services day by day (contract creation → payments → nightly reconciliation),
 * so every schedule status, allocation, ledger row and audit event is exactly
 * what production would have produced.
 *
 *   npm run db:seed        # first: creates the administrators
 *   npm run db:seed:demo   # then: demo customers/contracts, acting as the first admin
 *
 * Development only. Refuses to run in production or if contracts already exist.
 */
import "../scripts/load-env";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { addDays, businessDate, compareDates, diffDays, todayIn, type BusinessDate } from "@/lib/finance/dates";
import { paise } from "@/lib/finance/money";
import type { PaymentMethod } from "@/lib/generated/prisma/client";
import type { Actor } from "@/lib/services/actor";
import { cancelContract, createContract, setContractDefaulted } from "@/lib/services/contracts";
import { recordPayment } from "@/lib/services/payments";
import { createPerson } from "@/lib/services/people";
import { reconcileDailyCollections } from "@/lib/services/reconciliation";
import { personInputSchema } from "@/lib/validation/schemas";

const TZ = "Asia/Kolkata";
const ist = (date: BusinessDate, time: string) => new Date(`${date}T${time}:00+05:30`);
const rs = (r: number) => paise(Math.round(r * 100));

/** Deterministic PRNG so the seed is reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Pattern = (dayIndex: number, daily: number, rand: () => number) => { amount: number; method?: PaymentMethod }[];

const reliable: Pattern = (_i, daily, rand) => [{ amount: daily, method: rand() < 0.3 ? "UPI" : "CASH" }];
const occasionalMiss: Pattern = (i, daily, rand) => {
  const r = rand();
  if (r < 0.12) return []; // miss
  if (r < 0.2 && i > 0) return [{ amount: daily * 2 }]; // catch up
  if (r < 0.27) return [{ amount: Math.round(daily * 0.6) }]; // partial
  return [{ amount: daily }];
};
const frequentMiss: Pattern = (_i, daily, rand) => {
  const r = rand();
  if (r < 0.35) return [];
  if (r < 0.45) return [{ amount: daily * 2 }];
  return [{ amount: daily }];
};
const weeklyLump: Pattern = (i, daily) => ((i + 1) % 7 === 0 ? [{ amount: daily * 7, method: "BANK_TRANSFER" }] : []);
const splitPayer: Pattern = (_i, daily, rand) =>
  rand() < 0.4 ? [{ amount: Math.round(daily * 0.4) }, { amount: daily - Math.round(daily * 0.4), method: "UPI" }] : [{ amount: daily }];
const prepayer: Pattern = (i, daily) => (i % 10 === 0 ? [{ amount: daily * 10, method: "UPI" }] : []);

interface Plan {
  person: { fullName: string; phoneNumber: string; address: string; notes?: string };
  contracts: {
    principal: number;
    daily: number;
    days: number;
    start: string;
    first: string;
    pattern: Pattern;
    /** Stop paying after this many days (for defaults/cancellations). */
    payDays?: number;
    cancelOn?: string;
    defaultOn?: string;
    notes?: string;
  }[];
}

const PLANS: Plan[] = [
  {
    person: { fullName: "Dharmjit Pandey", phoneNumber: "9839012345", address: "B-14 Lanka, Varanasi, UP 221005", notes: "Kirana store owner" },
    contracts: [
      { principal: 30_000, daily: 500, days: 80, start: "2026-08-09", first: "2026-08-10", pattern: occasionalMiss, notes: "Stock purchase" },
      { principal: 50_000, daily: 750, days: 100, start: "2026-09-26", first: "2026-09-27", pattern: reliable, notes: "Shop renovation" },
    ],
  },
  {
    person: { fullName: "Sunita Devi", phoneNumber: "9450123456", address: "Sigra, Varanasi" },
    contracts: [{ principal: 20_000, daily: 300, days: 90, start: "2026-06-30", first: "2026-07-01", pattern: prepayer }],
  },
  {
    person: { fullName: "Ramesh Yadav", phoneNumber: "9935567890", address: "Mahmoorganj, Varanasi", notes: "Auto-rickshaw driver" },
    contracts: [{ principal: 40_000, daily: 600, days: 90, start: "2026-08-19", first: "2026-08-20", pattern: frequentMiss }],
  },
  {
    person: { fullName: "Anil Kumar", phoneNumber: "9721234567", address: "Bhelupur, Varanasi" },
    contracts: [{ principal: 10_000, daily: 250, days: 50, start: "2026-06-01", first: "2026-06-02", pattern: reliable }],
  },
  {
    person: { fullName: "Kavita Singh", phoneNumber: "9616345678", address: "Nadesar, Varanasi", notes: "Tailoring business" },
    contracts: [{ principal: 25_000, daily: 400, days: 80, start: "2026-08-31", first: "2026-09-01", pattern: splitPayer }],
  },
  {
    person: { fullName: "Mohan Lal", phoneNumber: "9807456789", address: "Chowk, Varanasi" },
    contracts: [
      { principal: 15_000, daily: 500, days: 40, start: "2026-07-14", first: "2026-07-15", pattern: occasionalMiss, payDays: 30, cancelOn: "2026-08-20", notes: "Cancelled: moved to Delhi" },
    ],
  },
  {
    person: { fullName: "Pooja Sharma", phoneNumber: "9369567890", address: "Assi Ghat, Varanasi" },
    contracts: [{ principal: 60_000, daily: 1000, days: 80, start: "2026-09-09", first: "2026-09-10", pattern: weeklyLump }],
  },
  {
    person: { fullName: "Vijay Verma", phoneNumber: "9161678901", address: "Pandeypur, Varanasi" },
    contracts: [
      { principal: 35_000, daily: 550, days: 90, start: "2026-07-31", first: "2026-08-01", pattern: occasionalMiss, payDays: 35, defaultOn: "2026-09-20" },
    ],
  },
];

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL_ENV === "production") {
    console.error("Demo data must never be loaded into production.");
    process.exit(1);
  }
  if ((await prisma.contract.count()) > 0) {
    console.error("Contracts already exist — refusing to seed. Use a fresh database.");
    process.exit(1);
  }

  const user = await prisma.user.findFirst({ where: { role: "ADMIN", isActive: true }, orderBy: { createdAt: "asc" } });
  if (!user) {
    console.error("No administrator exists. Run `npm run db:seed` first.");
    process.exit(1);
  }
  await prisma.businessSettings.upsert({ where: { id: 1 }, create: { id: 1, businessName: "ARTI FINANCE", timezone: TZ }, update: {} });
  const actor: Actor = { userId: user.id, userAgent: "seed" };

  const today = todayIn(TZ);
  const rand = mulberry32(20260926);
  const earliest = PLANS.flatMap((p) => p.contracts.map((c) => businessDate(c.start))).sort()[0];

  const people = new Map<string, string>();
  const live: { id: string; plan: Plan["contracts"][number] }[] = [];

  for (let day = earliest; compareDates(day, today) <= 0; day = addDays(day, 1)) {
    // 1. contracts starting today
    for (const plan of PLANS) {
      for (const c of plan.contracts) {
        if (c.start !== day) continue;
        let personId = people.get(plan.person.fullName);
        if (!personId) {
          personId = (await createPerson(personInputSchema.parse(plan.person), actor, { now: ist(day, "09:00") })).id;
          people.set(plan.person.fullName, personId);
        }
        const { contract } = await createContract(
          {
            personId,
            principalAmount: rs(c.principal),
            dailyCollectionAmount: rs(c.daily),
            totalCollectionDays: c.days,
            startDate: businessDate(c.start),
            firstCollectionDate: businessDate(c.first),
            disbursementMethod: c.principal >= 30_000 ? "BANK_TRANSFER" : "CASH",
            notes: c.notes,
            idempotencyKey: randomUUID(),
          },
          actor,
          { now: ist(day, "10:00") },
        );
        live.push({ id: contract.id, plan: c });
      }
    }

    // 2. the day's collections
    for (const { id, plan } of live) {
      const i = diffDays(day, businessDate(plan.first));
      if (i < 0 || i >= plan.days || (plan.payDays !== undefined && i >= plan.payDays)) continue;
      const status = (await prisma.contract.findUniqueOrThrow({ where: { id }, select: { status: true } })).status;
      if (status !== "ACTIVE") continue;
      let minute = 0;
      for (const p of plan.pattern(i, plan.daily, rand)) {
        if (p.amount <= 0) continue;
        await recordPayment(
          {
            contractId: id,
            amount: rs(p.amount),
            paymentDate: day,
            paymentMethod: p.method ?? "CASH",
            referenceNumber: p.method === "UPI" ? `UPI${Math.floor(rand() * 1e10)}` : undefined,
            idempotencyKey: randomUUID(),
          },
          actor,
          { now: ist(day, `1${7 + (minute++ % 2)}:${String(10 + Math.floor(rand() * 49)).padStart(2, "0")}`) },
        );
      }
    }

    // 3. lifecycle events
    for (const { id, plan } of live) {
      if (plan.cancelOn === day) {
        await cancelContract({ contractId: id, reason: plan.notes ?? "Cancelled" }, actor, { now: ist(day, "19:00") });
      }
      if (plan.defaultOn === day) {
        await setContractDefaulted({ contractId: id, defaulted: true, reason: "No payment for over two weeks" }, actor, { now: ist(day, "19:00") });
      }
    }

    // 4. the nightly job (except for tonight, which hasn't happened yet)
    if (compareDates(day, today) < 0) {
      await reconcileDailyCollections("CRON", { now: ist(addDays(day, 1), "00:05") });
    }
  }

  const counts = {
    people: await prisma.person.count(),
    contracts: await prisma.contract.count(),
    payments: await prisma.payment.count(),
    allocations: await prisma.paymentAllocation.count(),
    missedDays: await prisma.collectionSchedule.count({ where: { missedAt: { not: null } } }),
    auditEvents: await prisma.auditLog.count(),
  };
  console.log("Seeded:", counts);
  console.log(`Recorded as administrator ${user.mobileNumber}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
