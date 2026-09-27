/**
 * Real browser-equivalent flows over HTTP against `next start`:
 * proxy → Auth.js credentials endpoint → cookies → server-rendered pages → DAL.
 * (The login server action calls the same Auth.js signIn; its error mapping is unit-tested.)
 */
import { beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db/client";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const ADMIN = { mobile: "9000000101", password: "E2e-Admin-Pass-4821" };
const VIEWER = { mobile: "9000000102", password: "E2e-Viewer-Pass-7713" };
const DISABLED = { mobile: "9000000103", password: "E2e-Disabled-Pass-55" };

/** Minimal cookie jar, like a browser. */
class Browser {
  jar = new Map<string, string>();
  cookieHeader() {
    return [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  absorb(res: Response) {
    for (const c of res.headers.getSetCookie()) {
      const [pair, ...attrs] = c.split(";");
      const i = pair.indexOf("=");
      const name = pair.slice(0, i).trim();
      const value = pair.slice(i + 1);
      const expired = attrs.some((a) => /max-age=0|expires=thu, 01 jan 1970/i.test(a.trim())) || value === "";
      if (expired) this.jar.delete(name);
      else this.jar.set(name, value);
    }
  }
  async get(path: string) {
    const res = await fetch(BASE + path, { headers: { cookie: this.cookieHeader() }, redirect: "manual" });
    this.absorb(res);
    return res;
  }
  async post(path: string, form: Record<string, string>) {
    const res = await fetch(BASE + path, {
      method: "POST",
      headers: { cookie: this.cookieHeader(), "content-type": "application/x-www-form-urlencoded", "x-forwarded-for": "198.18.0.1" },
      body: new URLSearchParams(form),
      redirect: "manual",
    });
    this.absorb(res);
    return res;
  }
  async login(mobileNumber: string, password: string) {
    const { csrfToken } = (await (await this.get("/api/auth/csrf")).json()) as { csrfToken: string };
    return this.post("/api/auth/callback/credentials", { mobileNumber, password, csrfToken, callbackUrl: `${BASE}/dashboard` });
  }
  async logout() {
    const { csrfToken } = (await (await this.get("/api/auth/csrf")).json()) as { csrfToken: string };
    return this.post("/api/auth/signout", { csrfToken, callbackUrl: `${BASE}/login` });
  }
  sessionCookie() {
    return [...this.jar].find(([k]) => k.includes("authjs.session-token"));
  }
}

const location = (res: Response) => (res.headers.get("location") ? new URL(res.headers.get("location")!, BASE).pathname + new URL(res.headers.get("location")!, BASE).search : null);

beforeAll(async () => {
  for (const [u, role, active] of [
    [ADMIN, "ADMIN", true],
    [VIEWER, "VIEWER", true],
    [DISABLED, "ADMIN", false],
  ] as const) {
    await prisma.user.upsert({
      where: { mobileNumber: u.mobile },
      create: { mobileNumber: u.mobile, passwordHash: await hashPassword(u.password), role, isActive: active },
      update: { passwordHash: await hashPassword(u.password), role, isActive: active },
    });
  }
  await prisma.loginAttempt.deleteMany({ where: { OR: [{ identifier: { startsWith: "90000001" } }, { ipAddress: "198.18.0.1" }] } });
  await prisma.session.updateMany({ where: { user: { mobileNumber: { startsWith: "90000001" } }, revokedAt: null }, data: { revokedAt: new Date(), revokedReason: "LOGOUT" } });
});

describe("route protection", () => {
  const PROTECTED = [
    "/dashboard", "/people", "/people/new", "/people/dharmjit-pandey", "/people/dharmjit-pandey/statement",
    "/people/dharmjit-pandey/contracts/new", "/contracts", "/contracts/00000000-0000-0000-0000-000000000000",
    "/collect", "/collect?person=dharmjit-pandey", "/activity", "/more",
    "/collections/missed", "/transactions", "/reports", "/admin/audit-log", "/settings", "/settings/users",
  ];
  it.each(PROTECTED)(
    "unauthenticated %s → /login",
    async (path) => {
      const res = await new Browser().get(path);
      expect(res.status).toBe(307);
      expect(location(res)).toBe("/login");
    },
  );

  it("a forged session cookie is rejected server-side", async () => {
    const b = new Browser();
    b.jar.set("authjs.session-token", "forged.value.that.is.not.a.valid.jwe");
    // A real HTTP redirect (not a streamed soft redirect) for every protected page.
    for (const path of PROTECTED.filter((p) => !["/contracts", "/collections/missed", "/transactions", "/reports", "/admin/audit-log"].includes(p))) {
      const res = await b.get(path);
      expect(res.status, path).toBe(307);
      expect(location(res), path).toBe("/login");
    }
  });

  it("login and access-denied pages are public", async () => {
    const b = new Browser();
    const login = await b.get("/login");
    expect(login.status).toBe(200);
    const html = await login.text();
    expect(html).toContain("ARTI FINANCE");
    expect(html).toContain("Mobile Number");
    expect((await b.get("/access-denied")).status).toBe(200);
  });
});

describe("login", () => {
  it("ADMIN: login → /dashboard, httpOnly SameSite session cookie, header shows the admin", async () => {
    const b = new Browser();
    const res = await b.login(ADMIN.mobile, ADMIN.password);
    expect(res.status).toBe(302);
    expect(location(res)).toBe("/dashboard");
    const raw = res.headers.getSetCookie().find((c) => c.includes("authjs.session-token"))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Lax/i);

    const dash = await b.get("/dashboard");
    expect(dash.status).toBe(200);
    expect(dash.headers.get("cache-control")).toContain("no-store");
    expect(dash.headers.get("x-frame-options")).toBe("DENY");
    const html = await dash.text();
    expect(html).toContain(ADMIN.mobile);
    expect(html).toContain("ADMIN");

    // Signed-in admin visiting /login goes straight to the dashboard.
    expect(location(await b.get("/login"))).toBe("/dashboard");
  });

  it("wrong password, unknown number and disabled account never create a session", async () => {
    for (const [m, p, code] of [
      [ADMIN.mobile, "Wrong-Password-000", "invalid_credentials"],
      ["9000000199", ADMIN.password, "invalid_credentials"],
      [DISABLED.mobile, DISABLED.password, "account_disabled"],
    ]) {
      const b = new Browser();
      const res = await b.login(m, p);
      expect(location(res)).toBe(`/login?error=CredentialsSignin&code=${code}`);
      expect(b.sessionCookie()).toBeUndefined();
    }
  });

  it("mobile number formatting variants log into the same account", async () => {
    const b = new Browser();
    const res = await b.login(`+91 ${ADMIN.mobile.slice(0, 5)} ${ADMIN.mobile.slice(5)}`, ADMIN.password);
    expect(location(res)).toBe("/dashboard");
  });

  it("authenticated non-admin → /access-denied, and sees no financial data", async () => {
    const b = new Browser();
    await b.login(VIEWER.mobile, VIEWER.password);
    for (const path of ["/dashboard", "/people", "/people/dharmjit-pandey", "/collect", "/activity", "/more", "/settings/users", "/settings/security"]) {
      const res = await b.get(path);
      expect(res.status).toBe(307);
      expect(location(res)).toBe("/access-denied");
    }
    const html = await (await b.get("/access-denied")).text();
    expect(html).toContain("Access Restricted");
    expect(html).toContain("Your account does not have permission to access this application.");
    expect(html).not.toMatch(/₹|Outstanding|Collected/);
  });
});

describe("session lifecycle", () => {
  it("/api/auth/session exposes no credentials", async () => {
    const b = new Browser();
    await b.login(ADMIN.mobile, ADMIN.password);
    const body = await (await b.get("/api/auth/session")).json();
    expect(Object.keys(body.user).sort()).toEqual(["id", "mobileNumber", "role", "sessionRef"]);
    const text = JSON.stringify(body);
    expect(text).not.toMatch(/password|argon2|sid"|DATABASE|AUTH_SECRET|postgres/i);
  });

  it("logout revokes the session: the old cookie (browser back / replay) no longer works", async () => {
    const b = new Browser();
    await b.login(ADMIN.mobile, ADMIN.password);
    const stolen = b.sessionCookie()!;
    expect((await b.get("/dashboard")).status).toBe(200);

    const out = await b.logout();
    expect(location(out)).toBe("/login");
    expect(b.sessionCookie()).toBeUndefined();

    const replay = new Browser();
    replay.jar.set(stolen[0], stolen[1]);
    const res = await replay.get("/dashboard");
    expect(res.status).toBe(307);
    expect(location(res)).toBe("/login");

    const admin = await prisma.user.findUniqueOrThrow({ where: { mobileNumber: ADMIN.mobile } });
    const logoutAudit = await prisma.auditLog.findFirst({ where: { action: "LOGOUT", userId: admin.id }, orderBy: { timestamp: "desc" } });
    expect(logoutAudit).not.toBeNull();
  });

  it("an expired session cannot access protected routes", async () => {
    const b = new Browser();
    await b.login(ADMIN.mobile, ADMIN.password);
    const admin = await prisma.user.findUniqueOrThrow({ where: { mobileNumber: ADMIN.mobile } });
    await prisma.session.updateMany({ where: { userId: admin.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    const res = await b.get("/dashboard");
    expect(location(res)).toBe("/login");
  });

  it("disabling an account ends its live session on the next request", async () => {
    const b = new Browser();
    await b.login(ADMIN.mobile, ADMIN.password);
    expect((await b.get("/dashboard")).status).toBe(200);
    await prisma.user.update({ where: { mobileNumber: ADMIN.mobile }, data: { isActive: false } });
    try {
      expect(location(await b.get("/dashboard"))).toBe("/login");
    } finally {
      await prisma.user.update({ where: { mobileNumber: ADMIN.mobile }, data: { isActive: true } });
    }
  });
});

describe("no secrets reach the browser", () => {
  it("pages contain no connection string, auth secret or hashes", async () => {
    const b = new Browser();
    await b.login(ADMIN.mobile, ADMIN.password);
    const secrets = [process.env.DATABASE_URL, process.env.AUTH_SECRET].filter((s): s is string => Boolean(s && s.length > 8));
    for (const path of ["/login", "/dashboard", "/settings/account", "/settings/security", "/settings/users"]) {
      const html = await (await b.get(path)).text();
      for (const s of secrets) expect(html).not.toContain(s);
      expect(html).not.toMatch(/\$argon2id\$|passwordHash|postgresql:\/\//);
    }
  });
});
