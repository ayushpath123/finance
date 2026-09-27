import { createHash, randomBytes } from "node:crypto";

/** Absolute session lifetime. Sessions are never extended silently. */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

/** 256-bit random session id; lives only inside the encrypted Auth.js cookie. */
export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The DB stores only this hash, so a leaked sessions table can't be replayed. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Brute-force limits. Two admins log in a few times a day, so these are
 * strict but a user who mistypes and then succeeds is reset immediately
 * (only failures since the last success count).
 */
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILURES_PER_MOBILE = 5;
export const MAX_FAILURES_PER_IP = 10;
