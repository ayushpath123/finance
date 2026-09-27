import { DomainError } from "./errors";

/** Who is performing a mutation, and from where. `userId: null` = system (cron). */
export interface Actor {
  userId: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

export const SYSTEM_ACTOR: Actor = { userId: null };

/**
 * Every human-initiated financial change must name the administrator who made it
 * (createdById / reversedById / cancelledById / AuditLog.userId). Only the
 * reconciliation job acts as SYSTEM_ACTOR.
 */
export function requireUserActor(actor: Actor): asserts actor is Actor & { userId: string } {
  if (!actor.userId) throw new DomainError("FORBIDDEN", "A signed-in administrator is required");
}

/** Injectable clock so tests (and the seed) can replay history deterministically. */
export interface ServiceOptions {
  now?: Date;
}
