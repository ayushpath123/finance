/**
 * One-line, secret-free summary of a database/Prisma error for server logs.
 * Prisma messages span many lines (invocation + code frame) with the actual
 * reason LAST — which is the part that gets cut off when copying logs.
 *   → "PrismaClientKnownRequestError [P2021]: The table `public.sessions` does not exist in the current database."
 */
export function describeDbError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const e = err as Error & { code?: string; meta?: { driverAdapterError?: { cause?: { kind?: string; originalMessage?: string } } } };
  // Drop Prisma's invocation header and code frame ("Invalid `…` invocation in", paths, "→ 805 …", "  802 …").
  const lines = err.message
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^Invalid `/.test(l) && !/^(→\s*)?\d+\s/.test(l) && !/^\/.+:\d+:\d+$/.test(l));
  const CODES: Record<string, string> = {
    ETIMEDOUT: "timed out connecting to the database server",
    ECONNREFUSED: "database server refused the connection",
    ENOTFOUND: "database host name not found",
    ENETUNREACH: "network unreachable",
    ECONNRESET: "connection reset by the database server",
  };
  const reason = lines.at(-1) ?? (e.code && CODES[e.code]) ?? err.message;
  const driver = e.meta?.driverAdapterError?.cause;
  const detail = driver?.originalMessage && !reason.includes(driver.originalMessage) ? ` (driver: ${driver.kind ?? ""} ${driver.originalMessage})` : "";
  return `${err.name}${e.code ? ` [${e.code}]` : ""}: ${reason}${detail}`.replace(/postgres(ql)?:\/\/[^\s"']+/gi, "postgresql://***");
}
