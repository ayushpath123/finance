import { AuthError, CredentialsSignin } from "next-auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const signIn = vi.fn();
vi.mock("@/lib/auth/auth", () => ({ signIn: (...args: unknown[]) => signIn(...args) }));

const form = (mobileNumber: string, password: string) => {
  const f = new FormData();
  f.set("mobileNumber", mobileNumber);
  f.set("password", password);
  return f;
};
const rejected = (code: string) => Object.assign(new CredentialsSignin(), { code });

describe("loginAction", () => {
  beforeEach(() => {
    signIn.mockReset();
  });

  it("validates before touching auth and never echoes the password", async () => {
    const { loginAction } = await import("@/app/login/actions");
    const s = await loginAction({}, form("12345", "secret-value"));
    expect(s.fieldErrors?.mobileNumber).toBe("Enter a valid 10-digit mobile number.");
    expect(JSON.stringify(s)).not.toContain("secret-value");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("passes the normalised number to Auth.js and redirects to /dashboard", async () => {
    const { loginAction } = await import("@/app/login/actions");
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/dashboard;307;" });
    signIn.mockImplementation(async () => {
      throw redirect;
    });
    await expect(loginAction({}, form("+91 93165 68042", "pw"))).rejects.toBe(redirect);
    expect(signIn).toHaveBeenCalledWith("credentials", { mobileNumber: "9316568042", password: "pw", redirectTo: "/dashboard" });
  });

  it.each([
    ["invalid_credentials", "Invalid mobile number or password."],
    ["account_disabled", "This account is currently disabled. Please contact an administrator."],
    ["rate_limited", "Too many sign-in attempts. Please wait 15 minutes and try again."],
    ["something_else", "Invalid mobile number or password."],
  ])("maps %s to a safe message", async (code, message) => {
    const { loginAction } = await import("@/app/login/actions");
    signIn.mockImplementation(async () => {
      throw rejected(code);
    });
    const s = await loginAction({}, form("9316568042", "pw"));
    expect(s).toEqual({ mobileNumber: "9316568042", error: message });
  });

  it("hides database/internal failures behind a generic message", async () => {
    const { loginAction } = await import("@/app/login/actions");
    signIn.mockImplementation(async () => {
      throw new AuthError('connect ECONNREFUSED — prisma: relation "users" does not exist');
    });
    const s = await loginAction({}, form("9316568042", "pw"));
    expect(s.error).toBe("Unable to sign in right now. Please try again.");
    expect(JSON.stringify(s)).not.toMatch(/ECONNREFUSED|prisma|relation/);
  });
});
