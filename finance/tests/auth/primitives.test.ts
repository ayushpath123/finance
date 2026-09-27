import { describe, expect, it } from "vitest";
import { formatMobile, normalizeMobile } from "@/lib/auth/mobile";
import { hashPassword, passwordPolicyError, verifyPassword } from "@/lib/auth/password";
import { hashToken, newSessionToken } from "@/lib/auth/tokens";
import { snapshot } from "@/lib/services/audit";
import { loginSchema } from "@/lib/validation/auth";

describe("mobile normalisation", () => {
  it.each([
    ["9316568042", "9316568042"],
    ["93165 68042", "9316568042"],
    ["+91 9316568042", "9316568042"],
    ["+919316568042", "9316568042"],
    ["+91-93165-68042", "9316568042"],
    ["919662400965", "9662400965"],
    ["09662400965", "9662400965"],
    ["  9662400965  ", "9662400965"],
  ])("%s → %s", (input, expected) => expect(normalizeMobile(input)).toBe(expected));

  it.each(["", "12345", "5316568042", "93165680421", "+1 9316568042", "93165abc42", "9316568042; DROP TABLE users", "٩٣١٦٥٦٨٠٤٢"])(
    "rejects %j",
    (input) => expect(normalizeMobile(input)).toBeNull(),
  );

  it("formats for display", () => expect(formatMobile("9316568042")).toBe("93165 68042"));
});

describe("Argon2id passwords", () => {
  it("hashes with Argon2id (PHC string) and never contains the plaintext", async () => {
    const h = await hashPassword("Collection-Ledger-2026");
    expect(h).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(h).not.toContain("Collection-Ledger-2026");
    expect(await verifyPassword("Collection-Ledger-2026", h)).toBe(true);
    expect(await verifyPassword("collection-ledger-2026", h)).toBe(false);
    expect(await hashPassword("Collection-Ledger-2026")).not.toBe(h); // salted
  });

  it("refuses non-Argon2id hashes and oversized input", async () => {
    expect(await verifyPassword("x", "scrypt$1$2$3$a$b")).toBe(false);
    expect(await verifyPassword("x", "plaintext")).toBe(false);
    expect(await verifyPassword("a".repeat(129), await hashPassword("Some-Valid-Pass-1"))).toBe(false);
    await expect(hashPassword("a".repeat(129))).rejects.toThrow();
  });

  it("enforces the password policy", () => {
    expect(passwordPolicyError("short1")).toMatch(/12 characters/);
    expect(passwordPolicyError("onlyletterslong")).toMatch(/letter and one number/);
    expect(passwordPolicyError("111111111111a")).toMatch(/varied/);
    expect(passwordPolicyError("MyPassword123!")).toMatch(/common/);
    expect(passwordPolicyError("Arti-9316568042", { mobileNumber: "9316568042" })).toMatch(/mobile/);
    expect(passwordPolicyError("Ledger-Kite-Harbor-58")).toBeNull();
  });
});

describe("session tokens", () => {
  it("are 256-bit random and stored only as sha256", () => {
    const t = newSessionToken();
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(t).not.toBe(newSessionToken());
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("login input", () => {
  it("normalises the mobile number and keeps the password verbatim", () => {
    expect(loginSchema.parse({ mobileNumber: "+91 93165 68042", password: " pass " })).toEqual({
      mobileNumber: "9316568042",
      password: " pass ",
    });
    expect(loginSchema.safeParse({ mobileNumber: "123", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ mobileNumber: "9316568042", password: "" }).success).toBe(false);
  });
});

describe("audit redaction", () => {
  it("strips secret-looking fields at any depth", () => {
    const out = snapshot({
      mobileNumber: "9316568042",
      passwordHash: "$argon2id$…",
      nested: { password: "p", newPassword: "n", token: "t", keep: 1 },
    });
    expect(out).toEqual({ mobileNumber: "9316568042", nested: { keep: 1 } });
  });
});
