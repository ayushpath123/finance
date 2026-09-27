import type { JWT } from "next-auth/jwt";
import type { UserRole } from "@/lib/generated/prisma/client";
import { validateSessionToken } from "./sessions";

/** What server code gets from `auth()`. Deliberately minimal: no token, no hash of the password, no secrets. */
export interface SessionUser {
  id: string;
  mobileNumber: string;
  role: UserRole;
  /** sha256 of the session token (the DB key) — lets logout revoke this exact session; not a credential. */
  sessionRef: string;
}

/**
 * Runs on sign-in and on every `auth()` call. Re-validates the DB session each
 * time; returning null makes Auth.js treat the request as signed out and
 * clear the cookie (where it can).
 */
export async function jwtCallback({ token, user }: { token: JWT; user?: unknown }): Promise<JWT | null> {
  if (user) {
    token.sid = (user as { sessionToken?: string }).sessionToken;
    delete token.name;
    delete token.email;
    delete token.picture;
  }
  if (typeof token.sid !== "string") return null;
  const session = await validateSessionToken(token.sid);
  if (!session) return null;
  token.sub = session.user.id;
  token.uid = session.user.id;
  token.mobileNumber = session.user.mobileNumber;
  token.role = session.user.role;
  token.sessionRef = session.sessionId;
  return token;
}

/** Builds the session object. This is also what /api/auth/session returns, so `sid` must never appear here. */
export async function sessionCallback<S extends { expires: string | Date }>({ session, token }: { session: S; token: JWT }): Promise<S> {
  const user: SessionUser = {
    id: token.uid as string,
    mobileNumber: token.mobileNumber as string,
    role: token.role as UserRole,
    sessionRef: token.sessionRef as string,
  };
  return { expires: session.expires, user } as unknown as S;
}
