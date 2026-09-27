import "server-only";
import { prisma, type Tx } from "@/lib/db/client";
import type { UserRole } from "@/lib/generated/prisma/client";
import { hashToken, newSessionToken, SESSION_TTL_MS } from "./tokens";

export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

export interface ValidSession {
  /** sha256 of the token — the DB key; safe to reference, useless to an attacker. */
  sessionId: string;
  expiresAt: Date;
  user: { id: string; mobileNumber: string; role: UserRole };
}

export async function createSession(tx: Tx, userId: string, meta: RequestMeta, now: Date): Promise<{ token: string; sessionId: string; expiresAt: Date }> {
  const token = newSessionToken();
  const sessionId = hashToken(token);
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS);
  await tx.session.create({
    data: {
      id: sessionId,
      userId,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
      ipAddress: meta.ipAddress ?? null,
      userAgent: meta.userAgent?.slice(0, 500) ?? null,
    },
  });
  return { token, sessionId, expiresAt };
}

/**
 * The server-side check behind every authenticated request: the session row
 * must exist, be unrevoked and unexpired, and its user must still be active.
 */
export async function validateSessionToken(token: string, now: Date = new Date()): Promise<ValidSession | null> {
  if (typeof token !== "string" || token.length < 32 || token.length > 128) return null;
  const sessionId = hashToken(token);
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    include: { user: { select: { id: true, mobileNumber: true, role: true, isActive: true } } },
  });
  if (!session || session.revokedAt || session.expiresAt <= now || !session.user.isActive) return null;

  if (now.getTime() - session.lastSeenAt.getTime() > 5 * 60 * 1000) {
    await prisma.session.update({ where: { id: sessionId }, data: { lastSeenAt: now } }).catch(() => undefined);
  }
  const { id, mobileNumber, role } = session.user;
  return { sessionId, expiresAt: session.expiresAt, user: { id, mobileNumber, role } };
}

export async function revokeSession(tx: Tx, sessionId: string, reason: string, now: Date): Promise<boolean> {
  const r = await tx.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now, revokedReason: reason } });
  return r.count > 0;
}

export async function revokeUserSessions(tx: Tx, userId: string, reason: string, now: Date, exceptSessionId?: string): Promise<number> {
  const r = await tx.session.updateMany({
    where: { userId, revokedAt: null, ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}) },
    data: { revokedAt: now, revokedReason: reason },
  });
  return r.count;
}
