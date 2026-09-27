import { hash, verify } from "@node-rs/argon2";

/**
 * Argon2id with OWASP-recommended parameters (19 MiB, t=2, p=1).
 * `algorithm: 2` is Algorithm.Argon2id (a const enum that isolatedModules can't import).
 * The database additionally rejects any passwordHash that isn't an Argon2id PHC string.
 */
const ARGON2ID = { algorithm: 2, memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

/** Upper bound before hashing, so a megabyte "password" can't be used to burn CPU. */
export const MAX_PASSWORD_LENGTH = 128;
export const MIN_PASSWORD_LENGTH = 12;

export async function hashPassword(password: string): Promise<string> {
  if (password.length > MAX_PASSWORD_LENGTH) throw new RangeError("Password too long");
  return hash(password.normalize("NFKC"), ARGON2ID);
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  if (password.length > MAX_PASSWORD_LENGTH || !storedHash.startsWith("$argon2id$")) return false;
  try {
    return await verify(storedHash, password.normalize("NFKC"));
  } catch {
    return false;
  }
}

/** A real hash to verify against when the account doesn't exist, so response time doesn't reveal it. */
let dummy: Promise<string> | null = null;
export function dummyHash(): Promise<string> {
  return (dummy ??= hashPassword(`dummy-${Math.random()}-${Date.now()}`));
}

const COMMON = new Set([
  "password", "password1", "password123", "passw0rd", "qwerty", "qwerty123", "123456789012", "admin", "admin123",
  "welcome", "welcome123", "letmein", "iloveyou", "finance", "finance123", "arti", "artifinance",
]);

/** Returns a user-facing reason the password is too weak, or null if acceptable. */
export function passwordPolicyError(password: string, opts: { mobileNumber?: string } = {}): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "Include at least one letter and one number.";
  if (new Set(password).size < 6) return "Use more varied characters.";
  const lower = password.toLowerCase();
  if (COMMON.has(lower) || [...COMMON].some((w) => w.length >= 6 && lower.includes(w))) return "This password is too common.";
  if (opts.mobileNumber && password.replace(/\D/g, "").includes(opts.mobileNumber.slice(-6))) {
    return "Don't include your mobile number.";
  }
  return null;
}
