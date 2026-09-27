import type { Tx } from "@/lib/db/client";
import { prisma } from "@/lib/db/client";
import { closedThrough, todayIn, type BusinessClock, type BusinessDate } from "@/lib/finance/dates";
import type { BusinessSettings } from "@/lib/generated/prisma/client";

export async function getSettings(db: Tx | typeof prisma = prisma): Promise<BusinessSettings> {
  const existing = await db.businessSettings.findUnique({ where: { id: 1 } });
  if (existing) return existing;
  return db.businessSettings.upsert({ where: { id: 1 }, create: { id: 1 }, update: {} });
}

export interface BusinessNow {
  now: Date;
  clock: BusinessClock;
  today: BusinessDate;
  closedThrough: BusinessDate;
}

export function businessNow(settings: Pick<BusinessSettings, "timezone" | "dayCutoffTime">, now: Date = new Date()): BusinessNow {
  const clock = { timeZone: settings.timezone, cutoff: settings.dayCutoffTime };
  return { now, clock, today: todayIn(clock.timeZone, now), closedThrough: closedThrough(now, clock) };
}
