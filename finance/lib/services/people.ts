import "server-only";
import { prisma, TX_OPTIONS } from "@/lib/db/client";
import type { Person } from "@/lib/generated/prisma/client";
import type { PersonInput, PersonUpdate } from "@/lib/validation/schemas";
import { requireUserActor, type Actor, type ServiceOptions } from "./actor";
import { writeAudit } from "./audit";
import { DomainError, isUniqueViolation } from "./errors";

export function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/^(mr|mrs|ms|shri|smt|dr)\.?\s+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "person";
}

async function nextFreeSlug(base: string): Promise<string> {
  const taken = new Set(
    (await prisma.person.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } })).map((p) => p.slug),
  );
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export async function createPerson(input: PersonInput, actor: Actor, opts: ServiceOptions = {}): Promise<Person> {
  requireUserActor(actor);
  const now = opts.now ?? new Date();
  const base = slugify(input.fullName);
  for (let attempt = 0; attempt < 5; attempt++) {
    const slug = await nextFreeSlug(base);
    try {
      return await prisma.$transaction(async (tx) => {
        const person = await tx.person.create({
          data: { ...input, slug, createdById: actor.userId!, createdAt: now },
        });
        await writeAudit(
          tx,
          actor,
          {
            action: "PERSON_CREATED",
            entityType: "Person",
            entityId: person.id,
            personId: person.id,
            description: `Created ${person.fullName}`,
            after: person,
          },
          now,
        );
        return person;
      }, TX_OPTIONS);
    } catch (err) {
      if (isUniqueViolation(err, "slug")) continue; // raced with another create; pick the next suffix
      throw err;
    }
  }
  throw new Error("Could not allocate a unique slug");
}

export async function updatePerson(
  personId: string,
  patch: Omit<PersonUpdate, "alternatePhone" | "address" | "notes"> & { alternatePhone?: string | null; address?: string | null; notes?: string | null },
  actor: Actor,
  opts: ServiceOptions = {},
): Promise<Person> {
  requireUserActor(actor);
  const now = opts.now ?? new Date();
  return prisma.$transaction(async (tx) => {
    const before = await tx.person.findUnique({ where: { id: personId } });
    if (!before || before.deletedAt) throw new DomainError("NOT_FOUND", "Person not found");
    const after = await tx.person.update({ where: { id: personId }, data: { ...patch, updatedAt: now } });
    const changed = Object.keys(patch).filter(
      (k) => (before as Record<string, unknown>)[k] !== (after as Record<string, unknown>)[k],
    );
    if (changed.length > 0) {
      await writeAudit(
        tx,
        actor,
        {
          action: "PERSON_UPDATED",
          entityType: "Person",
          entityId: personId,
          personId,
          description: `Updated ${changed.join(", ")}`,
          before: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k]])),
          after: Object.fromEntries(changed.map((k) => [k, (after as Record<string, unknown>)[k]])),
        },
        now,
      );
    }
    return after;
  }, TX_OPTIONS);
}

/** Soft delete; only allowed for people with no contracts at all (financial history is never hidden). */
export async function deletePerson(personId: string, actor: Actor, opts: ServiceOptions = {}): Promise<void> {
  requireUserActor(actor);
  const now = opts.now ?? new Date();
  await prisma.$transaction(async (tx) => {
    const person = await tx.person.findUnique({ where: { id: personId }, include: { _count: { select: { contracts: true } } } });
    if (!person || person.deletedAt) throw new DomainError("NOT_FOUND", "Person not found");
    if (person._count.contracts > 0) {
      throw new DomainError("INVALID_STATE", "People with contracts cannot be deleted; mark them INACTIVE instead");
    }
    await tx.person.update({ where: { id: personId }, data: { deletedAt: now, status: "INACTIVE" } });
    await writeAudit(
      tx,
      actor,
      { action: "PERSON_DELETED", entityType: "Person", entityId: personId, personId, description: `Deleted ${person.fullName}`, before: person },
      now,
    );
  }, TX_OPTIONS);
}
