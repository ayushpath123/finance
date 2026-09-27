import "server-only";
import { prisma, TX_OPTIONS } from "@/lib/db/client";
import { buildContractTerms, ContractTermsError } from "@/lib/finance/contract-terms";
import { compareDates, toDbDate } from "@/lib/finance/dates";
import { formatINR, paise } from "@/lib/finance/money";
import { schedulesToCancel } from "@/lib/finance/schedule-status";
import type { Contract, Disbursement } from "@/lib/generated/prisma/client";
import type {
  ContractCancellationInput,
  ContractDefaultInput,
  ContractInput,
  DisbursementReversalInput,
} from "@/lib/validation/schemas";
import { requireUserActor, type Actor, type ServiceOptions } from "./actor";
import { writeAudit } from "./audit";
import { loadContractFacts, lockContracts, replanContract } from "./contract-engine";
import { DomainError, isUniqueViolation } from "./errors";
import { businessNow, getSettings } from "./settings";

export const formatContractNumber = (n: number) => `AF-${String(n).padStart(4, "0")}`;

export interface CreateContractResult {
  contract: Contract;
  disbursement: Disbursement;
  duplicate: boolean;
}

/**
 * Creates, in ONE transaction: the contract (immutable terms), its full
 * schedule, the principal disbursement, the DISBURSEMENT ledger entry, and
 * audit events. All derived numbers are computed here, never taken from the client.
 */
export async function createContract(input: ContractInput, actor: Actor, opts: ServiceOptions = {}): Promise<CreateContractResult> {
  requireUserActor(actor);

  const existing = await findByIdempotencyKey(input.idempotencyKey);
  if (existing) return existing;

  let terms;
  try {
    terms = buildContractTerms(input);
  } catch (err) {
    if (err instanceof ContractTermsError) throw new DomainError("INVALID_INPUT", err.message, { field: err.field });
    throw err;
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const bn = businessNow(await getSettings(tx), opts.now);
      const disbursedOn = input.disbursedOn ?? (compareDates(input.startDate, bn.today) <= 0 ? input.startDate : bn.today);
      if (compareDates(disbursedOn, bn.today) > 0) {
        throw new DomainError("INVALID_INPUT", "Disbursement date cannot be in the future", { field: "disbursedOn" });
      }

      const person = await tx.person.findUnique({ where: { id: input.personId } });
      if (!person || person.deletedAt) throw new DomainError("NOT_FOUND", "Person not found");

      const contract = await tx.contract.create({
        data: {
          personId: person.id,
          principalAmount: terms.principalAmount,
          dailyCollectionAmount: terms.dailyCollectionAmount,
          totalCollectionDays: terms.totalCollectionDays,
          expectedCollectionAmount: terms.expectedCollectionAmount,
          startDate: toDbDate(terms.startDate),
          firstCollectionDate: toDbDate(terms.firstCollectionDate),
          expectedEndDate: toDbDate(terms.expectedEndDate),
          notes: input.notes,
          idempotencyKey: input.idempotencyKey,
          createdById: actor.userId!,
          createdAt: bn.now,
        },
      });

      await tx.collectionSchedule.createMany({
        data: terms.schedule.map((s) => ({
          contractId: contract.id,
          sequence: s.sequence,
          scheduledDate: toDbDate(s.scheduledDate),
          expectedAmount: s.expectedAmount,
          createdAt: bn.now,
        })),
      });

      const disbursement = await tx.disbursement.create({
        data: {
          contractId: contract.id,
          personId: person.id,
          amount: terms.principalAmount,
          disbursedOn: toDbDate(disbursedOn),
          method: input.disbursementMethod,
          referenceNumber: input.disbursementReference,
          createdById: actor.userId!,
          createdAt: bn.now,
        },
      });

      const number = formatContractNumber(contract.contractNumber);
      await tx.ledgerEntry.create({
        data: {
          contractId: contract.id,
          personId: person.id,
          entryType: "DISBURSEMENT",
          amount: -terms.principalAmount,
          effectiveDate: toDbDate(disbursedOn),
          disbursementId: disbursement.id,
          description: `Principal ${formatINR(terms.principalAmount)} given to ${person.fullName} (${number})`,
          createdAt: bn.now,
        },
      });

      await writeAudit(
        tx,
        actor,
        [
          {
            action: "CONTRACT_CREATED",
            entityType: "Contract",
            entityId: contract.id,
            personId: person.id,
            contractId: contract.id,
            description: `${number}: ${formatINR(terms.principalAmount)} → ${formatINR(terms.dailyCollectionAmount)}/day × ${terms.totalCollectionDays} days = ${formatINR(terms.expectedCollectionAmount)} (${terms.firstCollectionDate} to ${terms.expectedEndDate})`,
            after: { ...contract, expectedMargin: terms.expectedMargin },
          },
          {
            action: "DISBURSEMENT_CREATED",
            entityType: "Disbursement",
            entityId: disbursement.id,
            personId: person.id,
            contractId: contract.id,
            description: `${formatINR(terms.principalAmount)} disbursed by ${disbursement.method} on ${disbursedOn}`,
            after: disbursement,
          },
        ],
        bn.now,
      );

      // A contract entered after its first collection date gets its closed days evaluated immediately.
      await replanContract(tx, { contractId: contract.id, trigger: "RECONCILIATION", actor, bn });

      return { contract, disbursement, duplicate: false };
    }, TX_OPTIONS);
  } catch (err) {
    if (isUniqueViolation(err, "idempotencyKey")) {
      const again = await findByIdempotencyKey(input.idempotencyKey);
      if (again) return again;
    }
    throw err;
  }
}

async function findByIdempotencyKey(key: string): Promise<CreateContractResult | null> {
  const contract = await prisma.contract.findUnique({
    where: { idempotencyKey: key },
    include: { disbursements: { orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!contract) return null;
  const { disbursements, ...rest } = contract;
  return { contract: rest, disbursement: disbursements[0], duplicate: true };
}

/**
 * Cancel: future unpaid obligations become CANCELLED ("cancelled obligation").
 * Past/today obligations remain owed; payments stay recorded; money on a
 * partly-prepaid cancelled day is released to unallocated credit.
 */
export async function cancelContract(input: ContractCancellationInput, actor: Actor, opts: ServiceOptions = {}) {
  requireUserActor(actor);
  return prisma.$transaction(async (tx) => {
    const bn = businessNow(await getSettings(tx), opts.now);
    await lockContracts(tx, [input.contractId]);
    const before = await tx.contract.findUniqueOrThrow({ where: { id: input.contractId } });
    if (before.status !== "ACTIVE" && before.status !== "DEFAULTED") {
      throw new DomainError("INVALID_STATE", `A ${before.status} contract cannot be cancelled`);
    }

    const facts = await loadContractFacts(tx, input.contractId);
    const cancelIds = new Set(schedulesToCancel(facts.schedules, bn.today));
    const cancelledObligation = paise(
      facts.schedules.filter((s) => cancelIds.has(s.id)).reduce((t, s) => t + s.expectedAmount, 0),
    );

    // Status first, so the replan can never auto-complete a contract being cancelled.
    const after = await tx.contract.update({
      where: { id: input.contractId },
      data: { status: "CANCELLED", cancelledAt: bn.now, cancelledById: actor.userId, statusReason: input.reason },
    });
    const outcome = await replanContract(tx, {
      contractId: input.contractId,
      trigger: "CONTRACT_CANCELLED",
      actor,
      bn,
      cancelScheduleIds: cancelIds,
    });

    await writeAudit(
      tx,
      actor,
      {
        action: "CONTRACT_CANCELLED",
        entityType: "Contract",
        entityId: input.contractId,
        personId: before.personId,
        contractId: input.contractId,
        description: `${formatContractNumber(before.contractNumber)} cancelled: ${cancelIds.size} future day(s), ${formatINR(cancelledObligation)} cancelled obligation. Reason: ${input.reason}`,
        before: { status: before.status },
        after: { status: after.status, cancelledAt: after.cancelledAt, statusReason: input.reason },
        metadata: {
          cancelledScheduleIds: [...cancelIds],
          cancelledObligation,
          releasedToCredit: outcome.plan.toVoid.reduce((t, a) => t + a.amount, 0),
        },
      },
      bn.now,
    );
    return { contract: after, cancelledDays: cancelIds.size, cancelledObligation };
  }, TX_OPTIONS);
}

export async function setContractDefaulted(input: ContractDefaultInput, actor: Actor, opts: ServiceOptions = {}) {
  requireUserActor(actor);
  return prisma.$transaction(async (tx) => {
    const now = opts.now ?? new Date();
    await lockContracts(tx, [input.contractId]);
    const before = await tx.contract.findUniqueOrThrow({ where: { id: input.contractId } });
    const from = input.defaulted ? "ACTIVE" : "DEFAULTED";
    if (before.status !== from) {
      throw new DomainError("INVALID_STATE", `Only ${from} contracts can be ${input.defaulted ? "marked defaulted" : "restored"}`);
    }
    const after = await tx.contract.update({
      where: { id: input.contractId },
      data: input.defaulted
        ? { status: "DEFAULTED", defaultedAt: now, statusReason: input.reason }
        : { status: "ACTIVE", defaultedAt: null, statusReason: input.reason },
    });
    await writeAudit(
      tx,
      actor,
      {
        action: input.defaulted ? "CONTRACT_DEFAULTED" : "CONTRACT_UPDATED",
        entityType: "Contract",
        entityId: input.contractId,
        personId: before.personId,
        contractId: input.contractId,
        description: `${formatContractNumber(before.contractNumber)} ${input.defaulted ? "marked DEFAULTED" : "restored to ACTIVE"}: ${input.reason}`,
        before: { status: before.status },
        after: { status: after.status },
      },
      now,
    );
    return after;
  }, TX_OPTIONS);
}

/**
 * Principal entered by mistake. Only allowed once the contract is CANCELLED —
 * the correction path for wrong terms is: cancel → reverse disbursement → new contract.
 */
export async function reverseDisbursement(input: DisbursementReversalInput, actor: Actor, opts: ServiceOptions = {}) {
  requireUserActor(actor);
  return prisma.$transaction(async (tx) => {
    const bn = businessNow(await getSettings(tx), opts.now);
    const d = await tx.disbursement.findUnique({ where: { id: input.disbursementId } });
    if (!d) throw new DomainError("NOT_FOUND", "Disbursement not found");
    await lockContracts(tx, [d.contractId]);
    const contract = await tx.contract.findUniqueOrThrow({ where: { id: d.contractId } });
    if (contract.status !== "CANCELLED") {
      throw new DomainError("INVALID_STATE", "Cancel the contract before reversing its disbursement");
    }
    if (d.status === "REVERSED") throw new DomainError("INVALID_STATE", "Disbursement is already reversed");

    const after = await tx.disbursement.update({
      where: { id: d.id },
      data: { status: "REVERSED", reversedAt: bn.now, reversedById: actor.userId, reversalReason: input.reason },
    });
    await tx.ledgerEntry.create({
      data: {
        contractId: d.contractId,
        personId: d.personId,
        entryType: "DISBURSEMENT_REVERSAL",
        amount: d.amount,
        effectiveDate: toDbDate(bn.today),
        disbursementId: d.id,
        description: `Reversal of ${formatINR(paise(d.amount))} disbursement: ${input.reason}`,
        createdAt: bn.now,
      },
    });
    await writeAudit(
      tx,
      actor,
      {
        action: "DISBURSEMENT_REVERSED",
        entityType: "Disbursement",
        entityId: d.id,
        personId: d.personId,
        contractId: d.contractId,
        description: `Reversed ${formatINR(paise(d.amount))} disbursement: ${input.reason}`,
        before: d,
        after,
      },
      bn.now,
    );
    return after;
  }, TX_OPTIONS);
}
