import "server-only";
import { prisma } from "@/lib/db/client";
import type { UserRole } from "@/lib/generated/prisma/client";
import { writeAudit } from "@/lib/services/audit";
import { normalizeMobile } from "./mobile";
import { dummyHash, MAX_PASSWORD_LENGTH, verifyPassword } from "./password";
import { createSession, type RequestMeta } from "./sessions";
import { LOGIN_WINDOW_MS, MAX_FAILURES_PER_IP, MAX_FAILURES_PER_MOBILE } from "./tokens";

export type AuthFailure = "invalid_credentials" | "account_disabled" | "rate_limited";

export type AuthOutcome =
  | { ok: true; sessionToken: string; user: { id: string; mobileNumber: string; role: UserRole } }
  | { ok: false; reason: AuthFailure };

/**
 * Mobile + password login. Framework-independent (Auth.js calls it from
 * `authorize`), so it is tested directly against a real database.
 *
 * Enumeration-safe: unknown number and wrong password are indistinguishable
 * (same message, same Argon2 work). "Disabled" is only revealed to someone
 * who knows the correct password.
 */
export async function authenticateWithPassword(
  input: { mobileNumber: string; password: string } & RequestMeta,
  now: Date = new Date(),
): Promise<AuthOutcome> {
  const mobile = normalizeMobile(input.mobileNumber);
  const identifier = mobile ?? "invalid";
  const meta = { ipAddress: input.ipAddress ?? null, userAgent: input.userAgent?.slice(0, 500) ?? null };

  const fail = async (reason: AuthFailure, user: { id: string } | null) => {
    await prisma.$transaction(async (tx) => {
      await tx.loginAttempt.create({ data: { identifier, ipAddress: meta.ipAddress, succeeded: false, createdAt: now } });
      await writeAudit(
        tx,
        { userId: null, ...meta }, // nobody is authenticated; the target account (if any) is the entity
        {
          action: "LOGIN_FAILED",
          entityType: "User",
          entityId: user?.id ?? "unknown",
          description: `Failed sign-in (${reason.replace("_", " ")})`,
          // Only a well-formed number is recorded; raw input could be anything (even a pasted password).
          metadata: { reason, attemptedMobile: mobile ?? undefined },
        },
        now,
      );
    });
    return { ok: false as const, reason };
  };

  if (await isRateLimited(identifier, meta.ipAddress, now)) return fail("rate_limited", null);

  const password = typeof input.password === "string" ? input.password : "";
  const user = mobile ? await prisma.user.findUnique({ where: { mobileNumber: mobile } }) : null;
  const passwordOk = password.length > 0 && password.length <= MAX_PASSWORD_LENGTH
    ? await verifyPassword(password, user?.passwordHash ?? (await dummyHash()))
    : false;

  if (!user || !passwordOk) return fail("invalid_credentials", user);
  if (!user.isActive) return fail("account_disabled", user);

  const session = await prisma.$transaction(async (tx) => {
    const s = await createSession(tx, user.id, meta, now);
    await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: now } });
    await tx.loginAttempt.create({ data: { identifier, ipAddress: meta.ipAddress, succeeded: true, createdAt: now } });
    await writeAudit(
      tx,
      { userId: user.id, ...meta },
      { action: "LOGIN_SUCCESS", entityType: "User", entityId: user.id, description: `Signed in (${user.role})` },
      now,
    );
    return s;
  });

  return { ok: true, sessionToken: session.token, user: { id: user.id, mobileNumber: user.mobileNumber, role: user.role } };
}

async function isRateLimited(identifier: string, ipAddress: string | null, now: Date): Promise<boolean> {
  const windowStart = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const lastSuccess = await prisma.loginAttempt.findFirst({
    where: { identifier, succeeded: true, createdAt: { gte: windowStart } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const since = lastSuccess?.createdAt ?? windowStart;
  const [byMobile, byIp] = await Promise.all([
    prisma.loginAttempt.count({ where: { identifier, succeeded: false, createdAt: { gt: since, lte: now } } }),
    ipAddress
      ? prisma.loginAttempt.count({ where: { ipAddress, succeeded: false, createdAt: { gte: windowStart, lte: now } } })
      : Promise.resolve(0),
  ]);
  return byMobile >= MAX_FAILURES_PER_MOBILE || byIp >= MAX_FAILURES_PER_IP;
}
