import { describe, expect, it } from "vitest";
import { describeDbError } from "@/lib/db/describe-error";

describe("describeDbError", () => {
  it("keeps the last (meaningful) line of a Prisma message, with its code", () => {
    const err = Object.assign(
      new Error("\nInvalid `prisma.session.findUnique()` invocation in\n/path/chunk.js:805:161\n\n  802 async function…\n→ 805   const s = await prisma.session.findUnique(\nThe table `public.sessions` does not exist in the current database."),
      { name: "PrismaClientKnownRequestError", code: "P2021" },
    );
    expect(describeDbError(err)).toBe("PrismaClientKnownRequestError [P2021]: The table `public.sessions` does not exist in the current database.");
  });

  it("explains network errors instead of echoing the code frame", () => {
    const err = Object.assign(new Error("\nInvalid `prisma.session.findUnique()` invocation in\n/x/chunk.js:805:161\n\n  802 async function f() {\n→ 805     const session = await prisma.session.findUnique("), {
      name: "PrismaClientKnownRequestError",
      code: "ETIMEDOUT",
    });
    expect(describeDbError(err)).toBe("PrismaClientKnownRequestError [ETIMEDOUT]: timed out connecting to the database server");
  });

  it("never prints a connection string", () => {
    const err = new Error("connect failed for postgresql://neondb_owner:secret@host/db?sslmode=require");
    expect(describeDbError(err)).not.toContain("secret");
  });
});
