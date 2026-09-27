import { describe, expect, it } from "vitest";
import { normalizeConnectionString } from "@/lib/db/connection-string";

describe("normalizeConnectionString", () => {
  const neon = "postgresql://u:p@ep-x-pooler.c-7.us-east-2.aws.neon.tech/neondb";

  it.each(["require", "prefer", "verify-ca"])("sslmode=%s → verify-full (same behaviour, no warning)", (mode) => {
    const out = new URL(normalizeConnectionString(`${neon}?sslmode=${mode}&channel_binding=require`));
    expect(out.searchParams.get("sslmode")).toBe("verify-full");
    expect(out.searchParams.get("channel_binding")).toBe("require");
    expect(out.password).toBe("p");
  });

  it("leaves verify-full, disable and URLs without sslmode untouched", () => {
    expect(normalizeConnectionString(`${neon}?sslmode=verify-full`)).toContain("sslmode=verify-full");
    expect(normalizeConnectionString(`${neon}?sslmode=disable`)).toContain("sslmode=disable");
    expect(normalizeConnectionString("postgresql://postgres:test@localhost:55432/arti")).toBe("postgresql://postgres:test@localhost:55432/arti");
  });
});
