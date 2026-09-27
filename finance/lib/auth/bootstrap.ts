import "server-only";
import { prisma } from "@/lib/db/client";
import { SYSTEM_ACTOR } from "@/lib/services/actor";
import { writeAudit } from "@/lib/services/audit";
import { normalizeMobile } from "./mobile";
import { hashPassword, passwordPolicyError } from "./password";

export interface AdminSeed {
  label: string; // e.g. "INITIAL_ADMIN_1"
  mobile?: string;
  password?: string;
}

export type BootstrapResult =
  | { label: string; status: "created"; mobileNumber: string }
  | { label: string; status: "exists"; mobileNumber: string }
  | { label: string; status: "skipped"; reason: string };

/** Reads INITIAL_ADMIN_<n>_MOBILE / _PASSWORD for n = 1, 2, … until a gap. */
export function adminSeedsFromEnv(env: Record<string, string | undefined> = process.env): AdminSeed[] {
  const seeds: AdminSeed[] = [];
  for (let n = 1; n <= 20; n++) {
    const label = `INITIAL_ADMIN_${n}`;
    const mobile = env[`${label}_MOBILE`]?.trim();
    const password = env[`${label}_PASSWORD`];
    if (!mobile && !password) {
      if (n > 2) break;
      continue;
    }
    seeds.push({ label, mobile, password });
  }
  return seeds;
}

/**
 * Idempotent: creates missing ADMIN accounts, never touches existing ones
 * (in particular, never overwrites a password that may have been changed).
 * Passwords come only from the environment and are stored only as Argon2id.
 */
export async function bootstrapAdmins(seeds: AdminSeed[], now: Date = new Date()): Promise<BootstrapResult[]> {
  const results: BootstrapResult[] = [];
  for (const seed of seeds) {
    const mobileNumber = seed.mobile ? normalizeMobile(seed.mobile) : null;
    if (!mobileNumber) {
      results.push({ label: seed.label, status: "skipped", reason: `${seed.label}_MOBILE is missing or not a valid 10-digit Indian mobile number` });
      continue;
    }
    const existing = await prisma.user.findUnique({ where: { mobileNumber }, select: { id: true } });
    if (existing) {
      results.push({ label: seed.label, status: "exists", mobileNumber });
      continue;
    }
    if (!seed.password) {
      results.push({ label: seed.label, status: "skipped", reason: `${seed.label}_PASSWORD is not set` });
      continue;
    }
    const weak = passwordPolicyError(seed.password, { mobileNumber });
    if (weak) {
      results.push({ label: seed.label, status: "skipped", reason: `${seed.label}_PASSWORD rejected: ${weak}` });
      continue;
    }
    const passwordHash = await hashPassword(seed.password);
    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { mobileNumber },
        create: { mobileNumber, passwordHash, role: "ADMIN", createdAt: now },
        update: {}, // raced with another bootstrap: keep whatever exists
      });
      if (user.passwordHash === passwordHash) {
        await writeAudit(
          tx,
          SYSTEM_ACTOR,
          { action: "ACCOUNT_CREATED", entityType: "User", entityId: user.id, description: `Initial administrator ${mobileNumber} created by bootstrap`, after: { mobileNumber, role: "ADMIN" } },
          now,
        );
        return true;
      }
      return false;
    });
    results.push(created ? { label: seed.label, status: "created", mobileNumber } : { label: seed.label, status: "exists", mobileNumber });
  }
  return results;
}
