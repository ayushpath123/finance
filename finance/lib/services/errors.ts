/** Expected business-rule failures. Safe to show to the user; everything else is a 500. */
export type DomainErrorCode =
  | "NOT_FOUND"
  | "INVALID_INPUT"
  | "INVALID_STATE"
  | "IDEMPOTENCY_CONFLICT"
  | "FORBIDDEN";

export class DomainError extends Error {
  constructor(
    readonly code: DomainErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

/** Prisma P2002. With driver adapters the constraint details live in varying meta shapes, so match loosely. */
export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (typeof err !== "object" || err === null) return false;
  const e = err as { code?: string; meta?: unknown; message?: string };
  if (e.code !== "P2002") return false;
  return !field || JSON.stringify(e.meta ?? {}).includes(field) || String(e.message ?? "").includes(field);
}
