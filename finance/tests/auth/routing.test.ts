import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Proxy (optimistic gate) ──────────────────────────────────────────────
import { proxy } from "@/proxy";

const req = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

describe("proxy", () => {
  it.each(["/dashboard", "/people", "/contracts/abc", "/collections/missed", "/transactions", "/reports", "/admin/audit-log", "/settings/users", "/"])(
    "unauthenticated %s → /login",
    (path) => {
      const res = proxy(req(path));
      expect(res.status).toBe(307);
      expect(new URL(res.headers.get("location")!).pathname).toBe("/login");
    },
  );

  it.each(["/login", "/access-denied"])("%s is public", (path) => {
    const res = proxy(req(path));
    expect(res.headers.get("location")).toBeNull();
  });

  it("lets a request with a session cookie through and marks it no-store", () => {
    for (const cookie of ["authjs.session-token=abc", "__Secure-authjs.session-token=abc", "__Secure-authjs.session-token.0=abc"]) {
      const res = proxy(req("/dashboard", cookie));
      expect(res.headers.get("location")).toBeNull();
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
  });

  it("ignores look-alike cookies", () => {
    expect(proxy(req("/dashboard", "authjs.session-token-fake=1; next-auth.foo=1")).status).toBe(307);
  });
});

// ── DAL (authoritative check) ────────────────────────────────────────────
const authMock = vi.fn();
vi.mock("@/lib/auth/auth", () => ({ auth: () => authMock() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "user-agent": "vitest", "x-forwarded-for": "203.0.113.9, 10.0.0.1" }) }));
vi.mock("next/navigation", () => ({
  unstable_rethrow: () => undefined,
  redirect: (url: string) => {
    throw Object.assign(new Error(`REDIRECT:${url}`), { url });
  },
}));

const session = (role: string) => ({ expires: "x", user: { id: "u1", mobileNumber: "9316568042", role, sessionRef: "ref" } });

describe("requireAdmin / requireAdminActor", () => {
  beforeEach(() => {
    authMock.mockReset();
  });

  it("unauthenticated → /login", async () => {
    const { requireAdmin } = await import("@/lib/auth/dal");
    authMock.mockResolvedValue(null);
    await expect(requireAdmin()).rejects.toMatchObject({ url: "/login" });
  });

  it("authenticated non-admin → /access-denied", async () => {
    const { requireAdmin } = await import("@/lib/auth/dal");
    for (const role of ["OPERATOR", "VIEWER"]) {
      authMock.mockResolvedValue(session(role));
      await expect(requireAdmin()).rejects.toMatchObject({ url: "/access-denied" });
    }
  });

  it("authenticated ADMIN → allowed", async () => {
    const { requireAdmin } = await import("@/lib/auth/dal");
    authMock.mockResolvedValue(session("ADMIN"));
    await expect(requireAdmin()).resolves.toMatchObject({ id: "u1", role: "ADMIN" });
  });

  it("server actions get an audited actor for ADMIN only", async () => {
    const { requireAdminActor } = await import("@/lib/auth/dal");
    authMock.mockResolvedValue(session("ADMIN"));
    await expect(requireAdminActor()).resolves.toMatchObject({
      actor: { userId: "u1", ipAddress: "203.0.113.9", userAgent: "vitest" },
    });
    authMock.mockResolvedValue(session("VIEWER"));
    await expect(requireAdminActor()).rejects.toMatchObject({ reason: "FORBIDDEN" });
    authMock.mockResolvedValue(null);
    await expect(requireAdminActor()).rejects.toMatchObject({ reason: "UNAUTHENTICATED" });
  });

  it("a malformed session is treated as signed out", async () => {
    const { requireAdmin } = await import("@/lib/auth/dal");
    authMock.mockResolvedValue({ expires: "x", user: { name: "x" } });
    await expect(requireAdmin()).rejects.toMatchObject({ url: "/login" });
  });
});

// ── What the session exposes to the browser (/api/auth/session) ────────────
vi.mock("@/lib/auth/sessions", () => ({
  validateSessionToken: async (sid: string) =>
    sid === "good-token-good-token-good-token-1234"
      ? { sessionId: "hash-of-token", expiresAt: new Date(), user: { id: "u1", mobileNumber: "9316568042", role: "ADMIN" } }
      : null,
}));

describe("Auth.js callbacks", () => {
  it("session payload contains only display fields — never the session token", async () => {
    const { jwtCallback, sessionCallback } = await import("@/lib/auth/callbacks");
    const token = await jwtCallback({ token: { name: "n", email: "e" }, user: { id: "u1", sessionToken: "good-token-good-token-good-token-1234" } });
    expect(token).not.toBeNull();
    expect(token).not.toHaveProperty("email");
    const s = await sessionCallback({ session: { expires: "2026-09-28T00:00:00.000Z" }, token: token! });
    expect(s).toEqual({
      expires: "2026-09-28T00:00:00.000Z",
      user: { id: "u1", mobileNumber: "9316568042", role: "ADMIN", sessionRef: "hash-of-token" },
    });
    expect(JSON.stringify(s)).not.toContain("good-token");
  });

  it("an invalid/revoked session id signs the user out", async () => {
    const { jwtCallback } = await import("@/lib/auth/callbacks");
    expect(await jwtCallback({ token: { sid: "revoked-token-revoked-token-revoked" } })).toBeNull();
    expect(await jwtCallback({ token: {} })).toBeNull();
  });
});
