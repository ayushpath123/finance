import { randomUUID } from "node:crypto";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/client";
import { businessDate, type BusinessDate } from "@/lib/finance/dates";
import { paise, type Paise } from "@/lib/finance/money";
import type { PaymentMethod } from "@/lib/generated/prisma/client";
import type { Actor } from "@/lib/services/actor";
import { createContract } from "@/lib/services/contracts";
import { checkContractIntegrity } from "@/lib/services/integrity";
import { createPerson } from "@/lib/services/people";
import { recordPayment } from "@/lib/services/payments";

export const rs = (rupees: number): Paise => paise(Math.round(rupees * 100));
export const d = (s: string): BusinessDate => businessDate(s);
/** An instant given as IST wall-clock time. */
export const ist = (date: string, time = "10:00") => new Date(`${date}T${time}:00+05:30`);

/** Deliberately not one of the real admin numbers. */
export const FIXTURE_ADMIN_MOBILE = "9000000001";

let admin: Actor | null = null;
export async function adminActor(): Promise<Actor> {
  if (admin) return admin;
  const user = await prisma.user.upsert({
    where: { mobileNumber: FIXTURE_ADMIN_MOBILE },
    create: { mobileNumber: FIXTURE_ADMIN_MOBILE, passwordHash: await hashPassword("Fixture-Admin-Pass-42"), role: "ADMIN" },
    update: {},
  });
  await prisma.businessSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
  admin = { userId: user.id, ipAddress: "127.0.0.1", userAgent: "vitest" };
  return admin;
}

export async function newContract(opts: {
  name?: string;
  phone?: string;
  principal?: number;
  daily?: number;
  days?: number;
  start: string;
  first?: string;
  personId?: string;
}) {
  const actor = await adminActor();
  const personId =
    opts.personId ??
    (await createPerson({ fullName: opts.name ?? "Test Person", phoneNumber: opts.phone ?? "9876543210" }, actor, { now: ist(opts.start, "09:00") })).id;
  const { contract } = await createContract(
    {
      personId,
      principalAmount: rs(opts.principal ?? 50_000),
      dailyCollectionAmount: rs(opts.daily ?? 750),
      totalCollectionDays: opts.days ?? 100,
      startDate: d(opts.start),
      firstCollectionDate: d(opts.first ?? opts.start),
      disbursementMethod: "CASH",
      idempotencyKey: randomUUID(),
    },
    actor,
    { now: ist(opts.start, "09:30") },
  );
  return { contract, personId };
}

export async function pay(
  contractId: string,
  rupees: number,
  date: string,
  opts: { time?: string; method?: PaymentMethod; key?: string; now?: Date } = {},
) {
  return recordPayment(
    {
      contractId,
      amount: rs(rupees),
      paymentDate: d(date),
      paymentMethod: opts.method ?? "CASH",
      idempotencyKey: opts.key ?? randomUUID(),
    },
    await adminActor(),
    { now: opts.now ?? ist(date, opts.time ?? "18:00") },
  );
}

export async function schedulesOf(contractId: string) {
  const rows = await prisma.collectionSchedule.findMany({ where: { contractId }, orderBy: { sequence: "asc" } });
  return rows.map((r) => ({ ...r, date: r.scheduledDate.toISOString().slice(0, 10) }));
}

export async function statusMap(contractId: string, count?: number) {
  const s = await schedulesOf(contractId);
  return Object.fromEntries(s.slice(0, count ?? s.length).map((r) => [r.date, r.status]));
}

export async function expectClean(contractId: string, now: Date) {
  const issues = await checkContractIntegrity(contractId, { now });
  if (issues.length) throw new Error(`Integrity issues: ${JSON.stringify(issues)}`);
}
