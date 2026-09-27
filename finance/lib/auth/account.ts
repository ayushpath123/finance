import "server-only";
import { prisma, TX_OPTIONS } from "@/lib/db/client";
import type { Actor } from "@/lib/services/actor";
import { writeAudit } from "@/lib/services/audit";
import { DomainError } from "@/lib/services/errors";
import { hashPassword, passwordPolicyError, verifyPassword } from "./password";
import { revokeSession, revokeUserSessions } from "./sessions";

export async function logoutSession(sessionId: string, actor: Actor, now: Date = new Date()): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const revoked = await revokeSession(tx, sessionId, "LOGOUT", now);
    if (revoked && actor.userId) {
      await writeAudit(tx, actor, { action: "LOGOUT", entityType: "User", entityId: actor.userId, description: "Signed out" }, now);
    }
  });
}

export type ChangePasswordResult =
  | { ok: true; otherSessionsRevoked: number }
  | { ok: false; field: "currentPassword" | "newPassword" | "confirmPassword"; error: string };

/** Verifies the current password, enforces policy, re-hashes, and signs out every OTHER session. */
export async function changePassword(
  input: { userId: string; currentSessionId: string; currentPassword: string; newPassword: string; confirmPassword: string },
  actor: Actor,
  now: Date = new Date(),
): Promise<ChangePasswordResult> {
  const user = await prisma.user.findUnique({ where: { id: input.userId } });
  if (!user || !user.isActive) throw new DomainError("FORBIDDEN", "Account not available");

  if (!(await verifyPassword(input.currentPassword, user.passwordHash))) {
    return { ok: false, field: "currentPassword", error: "Current password is incorrect." };
  }
  if (input.newPassword !== input.confirmPassword) {
    return { ok: false, field: "confirmPassword", error: "Passwords do not match." };
  }
  const weak = passwordPolicyError(input.newPassword, { mobileNumber: user.mobileNumber });
  if (weak) return { ok: false, field: "newPassword", error: weak };
  if (await verifyPassword(input.newPassword, user.passwordHash)) {
    return { ok: false, field: "newPassword", error: "Choose a password different from the current one." };
  }

  const passwordHash = await hashPassword(input.newPassword);
  const revoked = await prisma.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, updatedAt: now } });
    const n = await revokeUserSessions(tx, user.id, "PASSWORD_CHANGED", now, input.currentSessionId);
    await writeAudit(
      tx,
      actor,
      {
        action: "PASSWORD_CHANGED",
        entityType: "User",
        entityId: user.id,
        description: `Password changed; ${n} other session(s) signed out`,
        metadata: { otherSessionsRevoked: n },
      },
      now,
    );
    return n;
  }, TX_OPTIONS);
  return { ok: true, otherSessionsRevoked: revoked };
}

/**
 * Enable/disable an account. Rules:
 *  - you cannot disable your own account;
 *  - the last active ADMIN can never be disabled.
 * Admin rows are locked so two admins disabling each other at once can't leave zero admins.
 * Disabling revokes all of the account's sessions immediately.
 */
export async function setUserActive(input: { targetUserId: string; active: boolean }, actor: Actor, now: Date = new Date()) {
  if (!actor.userId) throw new DomainError("FORBIDDEN", "A signed-in administrator is required");
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "users" WHERE "role" = 'ADMIN' ORDER BY "id" FOR UPDATE`;
    const target = await tx.user.findUnique({ where: { id: input.targetUserId } });
    if (!target) throw new DomainError("NOT_FOUND", "User not found");
    if (target.isActive === input.active) return { changed: false, sessionsRevoked: 0 };

    let sessionsRevoked = 0;
    if (!input.active) {
      if (target.id === actor.userId) throw new DomainError("INVALID_STATE", "You cannot disable your own account.");
      if (target.role === "ADMIN") {
        const otherActiveAdmins = await tx.user.count({ where: { role: "ADMIN", isActive: true, id: { not: target.id } } });
        if (otherActiveAdmins === 0) throw new DomainError("INVALID_STATE", "The last active administrator cannot be disabled.");
      }
      sessionsRevoked = await revokeUserSessions(tx, target.id, "ACCOUNT_DISABLED", now);
    }

    await tx.user.update({ where: { id: target.id }, data: { isActive: input.active, updatedAt: now } });
    await writeAudit(
      tx,
      actor,
      {
        action: input.active ? "ACCOUNT_ENABLED" : "ACCOUNT_DISABLED",
        entityType: "User",
        entityId: target.id,
        description: `${input.active ? "Enabled" : "Disabled"} account ${target.mobileNumber}`,
        before: { isActive: target.isActive },
        after: { isActive: input.active },
        metadata: input.active ? undefined : { sessionsRevoked },
      },
      now,
    );
    return { changed: true, sessionsRevoked };
  }, TX_OPTIONS);
}

export async function listUsers() {
  return prisma.user.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, mobileNumber: true, role: true, isActive: true, lastLoginAt: true, createdAt: true },
  });
}
