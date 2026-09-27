import "server-only";
import { headers } from "next/headers";
import { redirect, unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { describeDbError } from "@/lib/db/describe-error";
import type { Actor } from "@/lib/services/actor";
import { auth, type SessionUser } from "./auth";

/**
 * Data Access Layer for authentication. Every protected page and every
 * server action calls one of these — Proxy only does an optimistic cookie
 * check, and layouts don't re-run on navigation, so neither is relied on.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  try {
    const session = await auth();
    const user = session?.user as Partial<SessionUser> | undefined;
    if (!user?.id || !user.role || !user.sessionRef || !user.mobileNumber) return null;
    return user as SessionUser;
  } catch (err) {
    unstable_rethrow(err); // Next's own control-flow errors (dynamic rendering, redirects) must propagate
    console.error(`[auth] session lookup failed → ${describeDbError(err)}`);
    return null;
  }
});

/** Pages: signed out → /login; signed in but not ADMIN → /access-denied. */
export async function requireAdmin(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.role !== "ADMIN") redirect("/access-denied");
  return user;
}

export class AuthorizationError extends Error {
  constructor(readonly reason: "UNAUTHENTICATED" | "FORBIDDEN") {
    super(reason === "UNAUTHENTICATED" ? "Your session has ended. Please sign in again." : "You do not have permission to do that.");
    this.name = "AuthorizationError";
  }
}

async function requestMeta() {
  const h = await headers();
  return {
    ipAddress: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null,
    userAgent: h.get("user-agent")?.slice(0, 500) ?? null,
  };
}

/**
 * Server actions: the authenticated ADMIN as an audit Actor. All financial
 * services take this Actor, so createdById / reversedById / cancelledById /
 * AuditLog.userId always identify the administrator who acted.
 */
export async function requireAdminActor(): Promise<{ user: SessionUser; actor: Actor }> {
  const user = await getSessionUser();
  if (!user) throw new AuthorizationError("UNAUTHENTICATED");
  if (user.role !== "ADMIN") throw new AuthorizationError("FORBIDDEN");
  return { user, actor: { userId: user.id, ...(await requestMeta()) } };
}

/** Server actions: like requireAdminActor(), but an expired session sends the browser to /login. */
export async function adminActorOrRedirect(): Promise<{ user: SessionUser; actor: Actor }> {
  try {
    return await requireAdminActor();
  } catch (err) {
    if (err instanceof AuthorizationError) redirect(err.reason === "UNAUTHENTICATED" ? "/login" : "/access-denied");
    throw err;
  }
}
