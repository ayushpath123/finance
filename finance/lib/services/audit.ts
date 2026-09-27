import type { Tx } from "@/lib/db/client";
import type { AuditAction, Prisma } from "@/lib/generated/prisma/client";
import type { Actor } from "./actor";

export interface AuditInput {
  action: AuditAction;
  entityType: string;
  entityId: string;
  description: string;
  personId?: string | null;
  contractId?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: unknown;
  /** Deterministic key for system events; duplicates are silently skipped. */
  dedupeKey?: string;
}

/** Keys that must never reach the audit log, whatever a caller passes in. */
const SECRET_KEYS = /^(password|passwordHash|currentPassword|newPassword|confirmPassword|token|sessionToken|secret|authSecret|databaseUrl)$/i;

/** JSON-safe snapshot: Dates → ISO strings, bigint → string, undefined and secret fields dropped. */
export function snapshot(value: unknown): Prisma.InputJsonValue | undefined {
  if (value === undefined || value === null) return undefined;
  return JSON.parse(
    JSON.stringify(value, (k, v) => (SECRET_KEYS.test(k) ? undefined : typeof v === "bigint" ? v.toString() : v)),
  ) as Prisma.InputJsonValue;
}

function toRow(actor: Actor, a: AuditInput, now: Date): Prisma.AuditLogCreateManyInput {
  return {
    userId: actor.userId,
    action: a.action,
    entityType: a.entityType,
    entityId: a.entityId,
    description: a.description,
    personId: a.personId ?? null,
    contractId: a.contractId ?? null,
    beforeData: snapshot(a.before),
    afterData: snapshot(a.after),
    metadata: snapshot(a.metadata),
    ipAddress: actor.ipAddress ?? null,
    userAgent: actor.userAgent ?? null,
    dedupeKey: a.dedupeKey ?? null,
    timestamp: now,
  };
}

/** Always called with the SAME transaction as the change it describes. */
export async function writeAudit(tx: Tx, actor: Actor, entries: AuditInput | AuditInput[], now: Date): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  await tx.auditLog.createMany({ data: list.map((a) => toRow(actor, a, now)), skipDuplicates: true });
}
