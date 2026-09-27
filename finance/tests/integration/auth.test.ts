/**
 * Authentication against a real Postgres: bootstrap, login, rate limiting,
 * sessions, password change, account enable/disable, audit, and financial
 * ownership. Test passwords exist only in this file; the real admin
 * passwords come from the environment and are never in the repository.
 */
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { changePassword, logoutSession, setUserActive } from "@/lib/auth/account";
import { authenticateWithPassword } from "@/lib/auth/authenticate";
import { adminSeedsFromEnv, bootstrapAdmins } from "@/lib/auth/bootstrap";
import { hashPassword } from "@/lib/auth/password";
import { validateSessionToken } from "@/lib/auth/sessions";
import { hashToken } from "@/lib/auth/tokens";
import { prisma } from "@/lib/db/client";
import { SYSTEM_ACTOR, type Actor } from "@/lib/services/actor";
import { cancelContract, reverseDisbursement } from "@/lib/services/contracts";
import { reversePayment } from "@/lib/services/payments";
import { ist, newContract, pay, rs } from "./fixtures";

const ADMIN_1 = "9316568042";
const ADMIN_2 = "9662400965";
const PW_1 = "Ledger-Kite-Harbor-58";
const PW_2 = "Monsoon-Abacus-Tiller-73";
const domainCode = (code: string) => expect.objectContaining({ name: "DomainError", code });

/** Each test gets its own clock far from the others so rate-limit windows never overlap. */
let clock = new Date("2040-01-01T00:00:00Z").getTime();
const tick = (hours = 6) => new Date((clock += hours * 3_600_000));

async function makeUser(mobileNumber: string, password: string, role: "ADMIN" | "VIEWER" = "ADMIN") {
  return prisma.user.create({ data: { mobileNumber, passwordHash: await hashPassword(password), role } });
}
const login = (mobileNumber: string, password: string, now: Date, ipAddress = "198.51.100.7") =>
  authenticateWithPassword({ mobileNumber, password, ipAddress, userAgent: "vitest-browser" }, now);

describe("bootstrap of the two initial administrators", () => {
  const env = {
    INITIAL_ADMIN_1_MOBILE: ADMIN_1,
    INITIAL_ADMIN_1_PASSWORD: PW_1,
    INITIAL_ADMIN_2_MOBILE: "+91 96624 00965", // formatting variant normalises to the same account
    INITIAL_ADMIN_2_PASSWORD: PW_2,
  };

  it("creates both as ADMIN with Argon2id hashes", async () => {
    const results = await bootstrapAdmins(adminSeedsFromEnv(env));
    expect(results.map((r) => r.status)).toEqual(["created", "created"]);
    const users = await prisma.user.findMany({ where: { mobileNumber: { in: [ADMIN_1, ADMIN_2] } }, orderBy: { mobileNumber: "asc" } });
    expect(users.map((u) => [u.mobileNumber, u.role, u.isActive])).toEqual([
      [ADMIN_1, "ADMIN", true],
      [ADMIN_2, "ADMIN", true],
    ]);
    for (const u of users) {
      expect(u.passwordHash).toMatch(/^\$argon2id\$/);
      expect(u.passwordHash).not.toContain(PW_1);
      expect(u.passwordHash).not.toContain(PW_2);
    }
    expect(await prisma.auditLog.count({ where: { action: "ACCOUNT_CREATED", entityId: { in: users.map((u) => u.id) } } })).toBe(2);
  });

  it("is idempotent and never overwrites an existing password", async () => {
    const before = await prisma.user.findUniqueOrThrow({ where: { mobileNumber: ADMIN_1 } });
    const results = await bootstrapAdmins(adminSeedsFromEnv({ ...env, INITIAL_ADMIN_1_PASSWORD: "Different-Password-99" }));
    expect(results.map((r) => r.status)).toEqual(["exists", "exists"]);
    expect(await prisma.user.count({ where: { mobileNumber: { in: [ADMIN_1, ADMIN_2] } } })).toBe(2);
    expect((await prisma.user.findUniqueOrThrow({ where: { mobileNumber: ADMIN_1 } })).passwordHash).toBe(before.passwordHash);
  });

  it("skips invalid numbers, weak or missing passwords without creating anything", async () => {
    const results = await bootstrapAdmins([
      { label: "A", mobile: "12345", password: PW_1 },
      { label: "B", mobile: "9800000001", password: "weak" },
      { label: "C", mobile: "9800000002" },
    ]);
    expect(results.every((r) => r.status === "skipped")).toBe(true);
    expect(await prisma.user.count({ where: { mobileNumber: { in: ["9800000001", "9800000002"] } } })).toBe(0);
  });

  it("both administrators can sign in", async () => {
    const now = tick();
    for (const [m, pw] of [
      [ADMIN_1, PW_1],
      [ADMIN_2, PW_2],
    ]) {
      const r = await login(m, pw, now);
      expect(r).toMatchObject({ ok: true, user: { mobileNumber: m, role: "ADMIN" } });
    }
  });
});

describe("login", () => {
  it("correct mobile + password → session, lastLoginAt, LOGIN_SUCCESS audit", async () => {
    const now = tick();
    const r = await login(ADMIN_1, PW_1, now);
    if (!r.ok) throw new Error(r.reason);

    const session = await prisma.session.findUniqueOrThrow({ where: { id: hashToken(r.sessionToken) } });
    expect(session).toMatchObject({ userId: r.user.id, revokedAt: null, ipAddress: "198.51.100.7", userAgent: "vitest-browser" });
    expect(session.expiresAt.getTime() - now.getTime()).toBe(12 * 3_600_000);
    expect(await prisma.session.findUnique({ where: { id: r.sessionToken } })).toBeNull(); // raw token never stored

    const user = await prisma.user.findUniqueOrThrow({ where: { id: r.user.id } });
    expect(user.lastLoginAt?.getTime()).toBe(now.getTime());
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "LOGIN_SUCCESS", userId: r.user.id, timestamp: now } });
    expect(audit).toMatchObject({ ipAddress: "198.51.100.7", userAgent: "vitest-browser" });
  });

  it("wrong password and unknown mobile fail identically", async () => {
    const now = tick();
    const wrong = await login(ADMIN_1, "Not-The-Password-1", now);
    const unknown = await login("9123400000", PW_1, now);
    expect(wrong).toEqual({ ok: false, reason: "invalid_credentials" });
    expect(unknown).toEqual({ ok: false, reason: "invalid_credentials" });

    const failed = await prisma.auditLog.findMany({ where: { action: "LOGIN_FAILED", timestamp: now } });
    expect(failed).toHaveLength(2);
    expect(failed.every((a) => a.userId === null)).toBe(true); // nobody was authenticated
    expect(failed.map((a) => (a.metadata as { attemptedMobile?: string }).attemptedMobile).sort()).toEqual(["9123400000", ADMIN_1]);
  });

  it("normalises the mobile number", async () => {
    const now = tick();
    for (const variant of ["+91 93165 68042", "+919316568042", "093165-68042"]) {
      expect((await login(variant, PW_1, now)).ok).toBe(true);
    }
  });

  it("disabled account: only someone with the right password learns it is disabled", async () => {
    await makeUser("9811111111", "Disabled-Account-Pass-9");
    await prisma.user.update({ where: { mobileNumber: "9811111111" }, data: { isActive: false } });
    const now = tick();
    expect(await login("9811111111", "Disabled-Account-Pass-9", now)).toEqual({ ok: false, reason: "account_disabled" });
    expect(await login("9811111111", "Wrong-Pass-12345", now)).toEqual({ ok: false, reason: "invalid_credentials" });
  });

  it("non-admin accounts can authenticate (authorization then sends them to /access-denied)", async () => {
    await makeUser("9822222222", "Viewer-Account-Pass-4", "VIEWER");
    const r = await login("9822222222", "Viewer-Account-Pass-4", tick());
    expect(r).toMatchObject({ ok: true, user: { role: "VIEWER" } });
  });
});

describe("brute-force protection", () => {
  it("locks a mobile number after 5 failures — even the right password is refused", async () => {
    await makeUser("9833333333", "Rate-Limited-Pass-77");
    const t0 = tick();
    for (let i = 0; i < 5; i++) await login("9833333333", `wrong-${i}-password`, new Date(t0.getTime() + i * 1000), `192.0.2.${i}`);
    expect(await login("9833333333", "Rate-Limited-Pass-77", new Date(t0.getTime() + 10_000), "192.0.2.99")).toEqual({
      ok: false,
      reason: "rate_limited",
    });
    // …and unlocks once the 15-minute window has passed.
    expect((await login("9833333333", "Rate-Limited-Pass-77", new Date(t0.getTime() + 16 * 60_000), "192.0.2.99")).ok).toBe(true);
  });

  it("a successful login resets the per-number counter (typos don't accumulate)", async () => {
    await makeUser("9844444444", "Typo-Prone-Pass-31");
    const t0 = tick().getTime();
    let t = t0;
    for (let i = 0; i < 4; i++) await login("9844444444", "typo-typo-1", new Date((t += 1000)));
    expect((await login("9844444444", "Typo-Prone-Pass-31", new Date((t += 1000)))).ok).toBe(true);
    for (let i = 0; i < 4; i++) await login("9844444444", "typo-typo-2", new Date((t += 1000)));
    expect((await login("9844444444", "Typo-Prone-Pass-31", new Date((t += 1000)))).ok).toBe(true);
  });

  it("limits a single IP spraying many numbers", async () => {
    const t0 = tick().getTime();
    for (let i = 0; i < 10; i++) await login(`97000000${String(i).padStart(2, "0")}`, "spray-spray-1", new Date(t0 + i * 1000), "203.0.113.50");
    expect(await login(ADMIN_2, PW_2, new Date(t0 + 20_000), "203.0.113.50")).toEqual({ ok: false, reason: "rate_limited" });
    expect((await login(ADMIN_2, PW_2, new Date(t0 + 20_000), "203.0.113.51")).ok).toBe(true);
  });
});

describe("sessions", () => {
  it("valid → user; logout → revoked + LOGOUT audit; expired → rejected", async () => {
    const now = tick();
    const r = await login(ADMIN_2, PW_2, now);
    if (!r.ok) throw new Error(r.reason);
    const v = await validateSessionToken(r.sessionToken, now);
    expect(v).toMatchObject({ user: { mobileNumber: ADMIN_2, role: "ADMIN" }, sessionId: hashToken(r.sessionToken) });

    // Expiry is absolute (12h).
    expect(await validateSessionToken(r.sessionToken, new Date(now.getTime() + 12 * 3_600_000 + 1))).toBeNull();

    await logoutSession(v!.sessionId, { userId: r.user.id }, now);
    expect(await validateSessionToken(r.sessionToken, now)).toBeNull();
    expect(await prisma.session.findUniqueOrThrow({ where: { id: v!.sessionId } })).toMatchObject({ revokedReason: "LOGOUT" });
    expect(await prisma.auditLog.count({ where: { action: "LOGOUT", userId: r.user.id, timestamp: now } })).toBe(1);

    // Logging out twice (double click, back button) doesn't double-audit.
    await logoutSession(v!.sessionId, { userId: r.user.id }, now);
    expect(await prisma.auditLog.count({ where: { action: "LOGOUT", userId: r.user.id, timestamp: now } })).toBe(1);
  });

  it("garbage tokens are rejected without a lookup", async () => {
    expect(await validateSessionToken("short")).toBeNull();
    expect(await validateSessionToken("x".repeat(500))).toBeNull();
  });
});

describe("password change", () => {
  it("validates, re-hashes, signs out other sessions, audits without secrets", async () => {
    const user = await makeUser("9855555555", "Original-Pass-Word-1");
    const now = tick();
    const here = await login("9855555555", "Original-Pass-Word-1", now);
    const elsewhere = await login("9855555555", "Original-Pass-Word-1", now, "198.51.100.200");
    if (!here.ok || !elsewhere.ok) throw new Error("login failed");
    const hereId = hashToken(here.sessionToken);
    const actor: Actor = { userId: user.id };
    const base = { userId: user.id, currentSessionId: hereId };

    expect(await changePassword({ ...base, currentPassword: "nope", newPassword: "New-Strong-Pass-22", confirmPassword: "New-Strong-Pass-22" }, actor, now)).toMatchObject({ ok: false, field: "currentPassword" });
    expect(await changePassword({ ...base, currentPassword: "Original-Pass-Word-1", newPassword: "New-Strong-Pass-22", confirmPassword: "different" }, actor, now)).toMatchObject({ ok: false, field: "confirmPassword" });
    expect(await changePassword({ ...base, currentPassword: "Original-Pass-Word-1", newPassword: "short", confirmPassword: "short" }, actor, now)).toMatchObject({ ok: false, field: "newPassword" });
    expect(await changePassword({ ...base, currentPassword: "Original-Pass-Word-1", newPassword: "Original-Pass-Word-1", confirmPassword: "Original-Pass-Word-1" }, actor, now)).toMatchObject({ ok: false, field: "newPassword" });

    const ok = await changePassword({ ...base, currentPassword: "Original-Pass-Word-1", newPassword: "New-Strong-Pass-22", confirmPassword: "New-Strong-Pass-22" }, actor, now);
    expect(ok).toEqual({ ok: true, otherSessionsRevoked: 1 });

    expect(await validateSessionToken(here.sessionToken, now)).not.toBeNull(); // current device stays signed in
    expect(await validateSessionToken(elsewhere.sessionToken, now)).toBeNull();
    const later = tick();
    expect((await login("9855555555", "Original-Pass-Word-1", later)).ok).toBe(false);
    expect((await login("9855555555", "New-Strong-Pass-22", later)).ok).toBe(true);

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: "PASSWORD_CHANGED", entityId: user.id } });
    const text = JSON.stringify(audit);
    expect(text).not.toContain("Original-Pass-Word-1");
    expect(text).not.toContain("New-Strong-Pass-22");
    expect(text).not.toContain("$argon2id$");
  });
});

describe("account enable / disable", () => {
  it("disabling revokes sessions immediately and is audited; enabling restores access", async () => {
    const a = await prisma.user.findUniqueOrThrow({ where: { mobileNumber: ADMIN_1 } });
    const target = await makeUser("9866666666", "Target-Account-Pass-5");
    const now = tick();
    const s = await login("9866666666", "Target-Account-Pass-5", now);
    if (!s.ok) throw new Error(s.reason);

    expect(await setUserActive({ targetUserId: target.id, active: false }, { userId: a.id }, now)).toEqual({ changed: true, sessionsRevoked: 1 });
    expect(await validateSessionToken(s.sessionToken, now)).toBeNull();
    expect(await prisma.auditLog.count({ where: { action: "ACCOUNT_DISABLED", entityId: target.id, userId: a.id } })).toBe(1);

    await setUserActive({ targetUserId: target.id, active: true }, { userId: a.id }, now);
    expect(await prisma.auditLog.count({ where: { action: "ACCOUNT_ENABLED", entityId: target.id, userId: a.id } })).toBe(1);
    expect((await login("9866666666", "Target-Account-Pass-5", tick())).ok).toBe(true);
  });

  it("an administrator cannot disable their own account", async () => {
    const a = await prisma.user.findUniqueOrThrow({ where: { mobileNumber: ADMIN_1 } });
    await expect(setUserActive({ targetUserId: a.id, active: false }, { userId: a.id })).rejects.toEqual(domainCode("INVALID_STATE"));
  });

  it("two admins disabling each other at the same moment can never leave zero active admins", async () => {
    const a = await prisma.user.findUniqueOrThrow({ where: { mobileNumber: ADMIN_1 } });
    const b = await prisma.user.findUniqueOrThrow({ where: { mobileNumber: ADMIN_2 } });
    // Make A and B the only active admins.
    const others = await prisma.user.findMany({ where: { role: "ADMIN", isActive: true, id: { notIn: [a.id, b.id] } } });
    await prisma.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: false } });
    try {
      const results = await Promise.allSettled([
        setUserActive({ targetUserId: b.id, active: false }, { userId: a.id }),
        setUserActive({ targetUserId: a.id, active: false }, { userId: b.id }),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: domainCode("INVALID_STATE") });
      expect(await prisma.user.count({ where: { role: "ADMIN", isActive: true } })).toBe(1);
    } finally {
      await prisma.user.updateMany({ where: { id: { in: [a.id, b.id, ...others.map((o) => o.id)] } }, data: { isActive: true } });
    }
  });
});

describe("database guarantees", () => {
  it("rejects plaintext passwords and non-canonical mobile numbers", async () => {
    await expect(prisma.user.create({ data: { mobileNumber: "9877777777", passwordHash: "hunter2hunter2" } })).rejects.toThrow();
    await expect(prisma.user.create({ data: { mobileNumber: "+91 9877777777", passwordHash: await hashPassword("Valid-Pass-Word-8") } })).rejects.toThrow();
    await expect(prisma.user.create({ data: { mobileNumber: ADMIN_1, passwordHash: await hashPassword("Valid-Pass-Word-8") } })).rejects.toThrow(); // unique
  });

  it("no audit row anywhere contains a password or hash", async () => {
    const rows = await prisma.auditLog.findMany();
    const text = JSON.stringify(rows);
    for (const secret of [PW_1, PW_2, "Original-Pass-Word-1", "New-Strong-Pass-22", "$argon2id$"]) expect(text).not.toContain(secret);
  });
});

describe("financial ownership", () => {
  let a: Actor;
  let b: Actor;
  beforeAll(async () => {
    a = { userId: (await prisma.user.findUniqueOrThrow({ where: { mobileNumber: ADMIN_1 } })).id };
    b = { userId: (await prisma.user.findUniqueOrThrow({ where: { mobileNumber: ADMIN_2 } })).id };
  });

  it("every financial action records the administrator who performed it", async () => {
    // Contract created by the fixture admin; actions below by the two real admins.
    const { contract } = await newContract({ name: "Ownership Test", days: 5, start: "2041-01-01" });
    const { recordPayment } = await import("@/lib/services/payments");
    const p1 = await recordPayment(
      { contractId: contract.id, amount: rs(750), paymentDate: "2041-01-01" as never, paymentMethod: "CASH", idempotencyKey: randomUUID() },
      a,
      { now: ist("2041-01-01", "11:00") },
    );
    const p2 = await recordPayment(
      { contractId: contract.id, amount: rs(750), paymentDate: "2041-01-01" as never, paymentMethod: "UPI", idempotencyKey: randomUUID() },
      b,
      { now: ist("2041-01-01", "12:00") },
    );
    expect(p1.payment.createdById).toBe(a.userId);
    expect(p2.payment.createdById).toBe(b.userId);

    await reversePayment({ paymentId: p2.payment.id, reason: "Duplicate entry" }, a, { now: ist("2041-01-01", "13:00") });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: p2.payment.id } })).reversedById).toBe(a.userId);

    await cancelContract({ contractId: contract.id, reason: "Test cancellation" }, b, { now: ist("2041-01-01", "14:00") });
    expect((await prisma.contract.findUniqueOrThrow({ where: { id: contract.id } })).cancelledById).toBe(b.userId);

    const disb = await prisma.disbursement.findFirstOrThrow({ where: { contractId: contract.id } });
    await reverseDisbursement({ disbursementId: disb.id, reason: "Wrong terms" }, a, { now: ist("2041-01-01", "15:00") });
    expect((await prisma.disbursement.findUniqueOrThrow({ where: { id: disb.id } })).reversedById).toBe(a.userId);

    const byAction = await prisma.auditLog.findMany({
      where: { contractId: contract.id, action: { in: ["PAYMENT_CREATED", "PAYMENT_REVERSED", "CONTRACT_CANCELLED", "DISBURSEMENT_REVERSED"] } },
      orderBy: { timestamp: "asc" },
    });
    expect(byAction.map((x) => [x.action, x.userId])).toEqual([
      ["PAYMENT_CREATED", a.userId],
      ["PAYMENT_CREATED", b.userId],
      ["PAYMENT_REVERSED", a.userId],
      ["CONTRACT_CANCELLED", b.userId],
      ["DISBURSEMENT_REVERSED", a.userId],
    ]);
  });

  it("financial mutations are refused without an authenticated administrator", async () => {
    const { contract } = await newContract({ name: "No Actor", days: 3, start: "2041-02-01" });
    await expect(pay(contract.id, 100, "2041-02-01").then(() => undefined)).resolves.toBeUndefined(); // sanity: with actor OK
    const { recordPayment } = await import("@/lib/services/payments");
    await expect(
      recordPayment(
        { contractId: contract.id, amount: rs(100), paymentDate: "2041-02-01" as never, paymentMethod: "CASH", idempotencyKey: randomUUID() },
        SYSTEM_ACTOR,
        { now: ist("2041-02-01", "12:00") },
      ),
    ).rejects.toEqual(domainCode("FORBIDDEN"));
    await expect(cancelContract({ contractId: contract.id, reason: "no actor" }, SYSTEM_ACTOR)).rejects.toEqual(domainCode("FORBIDDEN"));
  });
});
