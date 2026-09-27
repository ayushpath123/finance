import "server-only";
import { prisma, TX_OPTIONS, type Tx } from "@/lib/db/client";
import { explainPayment, type AllocationExplanation } from "@/lib/finance/allocation";
import { compareDates, fromDbDate, toDbDate } from "@/lib/finance/dates";
import { formatINR, paise } from "@/lib/finance/money";
import type { Payment } from "@/lib/generated/prisma/client";
import type { PaymentCorrectionInput, PaymentInput, PaymentReversalInput } from "@/lib/validation/schemas";
import { requireUserActor, type Actor, type ServiceOptions } from "./actor";
import { writeAudit } from "./audit";
import { lockContracts, replanContract } from "./contract-engine";
import { formatContractNumber } from "./contracts";
import { DomainError, isUniqueViolation } from "./errors";
import { businessNow, getSettings, type BusinessNow } from "./settings";

export interface RecordPaymentResult {
  payment: Payment;
  explanation: AllocationExplanation;
  /** True when this idempotency key had already been processed (double submit, refresh, retry). */
  duplicate: boolean;
  contractCompleted: boolean;
}

/**
 * Record money received. One transaction: payment → allocation → schedule
 * projection → ledger → audit. Any failure rolls back all of it.
 */
export async function recordPayment(input: PaymentInput, actor: Actor, opts: ServiceOptions = {}): Promise<RecordPaymentResult> {
  requireUserActor(actor);

  const existing = await replayIdempotent(input);
  if (existing) return existing;

  try {
    return await prisma.$transaction(async (tx) => {
      const bn = businessNow(await getSettings(tx), opts.now);
      await lockContracts(tx, [input.contractId]);
      const { payment, explanation, completed } = await insertPaymentTx(tx, input, actor, bn, "PAYMENT_CREATED", null);
      return { payment, explanation, duplicate: false, contractCompleted: completed };
    }, TX_OPTIONS);
  } catch (err) {
    if (isUniqueViolation(err, "idempotencyKey")) {
      const again = await replayIdempotent(input);
      if (again) return again;
    }
    throw err;
  }
}

async function replayIdempotent(input: PaymentInput): Promise<RecordPaymentResult | null> {
  const payment = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (!payment) return null;
  if (payment.contractId !== input.contractId || payment.amount !== input.amount) {
    throw new DomainError("IDEMPOTENCY_CONFLICT", "This submission key was already used for a different payment");
  }
  return { payment, explanation: await explainStoredPayment(payment), duplicate: true, contractCompleted: false };
}

/** Explanation of a payment's CURRENT active allocations. */
export async function explainStoredPayment(payment: Payment, db: Tx | typeof prisma = prisma): Promise<AllocationExplanation> {
  const allocations = await db.paymentAllocation.findMany({
    where: { paymentId: payment.id, voidedAt: null },
    include: { schedule: { select: { id: true, sequence: true, scheduledDate: true, expectedAmount: true } } },
  });
  const schedules = allocations.map((a) => ({
    id: a.schedule.id,
    sequence: a.schedule.sequence,
    scheduledDate: fromDbDate(a.schedule.scheduledDate),
    expectedAmount: paise(a.schedule.expectedAmount),
  }));
  const p = { id: payment.id, amount: paise(payment.amount), paymentDate: fromDbDate(payment.paymentDate), recordedAt: payment.recordedAt.toISOString() };
  return explainPayment(
    p,
    {
      allocations: allocations.map((a) => ({ paymentId: a.paymentId, scheduleId: a.scheduleId, amount: paise(a.amount) })),
      allocatedBySchedule: new Map(),
      unallocatedByPayment: new Map(),
    },
    schedules,
  );
}

async function insertPaymentTx(
  tx: Tx,
  input: PaymentInput,
  actor: Actor,
  bn: BusinessNow,
  trigger: "PAYMENT_CREATED" | "PAYMENT_CORRECTED",
  correctsPaymentId: string | null,
) {
  const contract = await tx.contract.findUnique({ where: { id: input.contractId }, include: { person: true } });
  if (!contract) throw new DomainError("NOT_FOUND", "Contract not found");
  if (contract.status === "COMPLETED") {
    throw new DomainError("INVALID_STATE", "This contract is fully collected; no further payments can be recorded");
  }
  if (compareDates(input.paymentDate, bn.today) > 0) {
    throw new DomainError("INVALID_INPUT", "Payment date cannot be in the future", { field: "paymentDate" });
  }
  if (compareDates(input.paymentDate, fromDbDate(contract.startDate)) < 0) {
    throw new DomainError("INVALID_INPUT", "Payment date cannot be before the contract start date", { field: "paymentDate" });
  }

  const payment = await tx.payment.create({
    data: {
      contractId: contract.id,
      personId: contract.personId,
      amount: input.amount,
      paymentDate: toDbDate(input.paymentDate),
      recordedAt: bn.now,
      paymentMethod: input.paymentMethod,
      referenceNumber: input.referenceNumber,
      notes: input.notes,
      idempotencyKey: input.idempotencyKey,
      createdById: actor.userId!,
      correctsPaymentId,
    },
  });

  const outcome = await replanContract(tx, { contractId: contract.id, trigger, triggerPaymentId: payment.id, actor, bn });
  const schedules = outcome.facts.schedules;
  const explanation = explainPayment(
    { id: payment.id, amount: paise(payment.amount), paymentDate: input.paymentDate, recordedAt: payment.recordedAt.toISOString() },
    outcome.plan.result,
    schedules,
  );

  const number = formatContractNumber(contract.contractNumber);
  await tx.ledgerEntry.create({
    data: {
      contractId: contract.id,
      personId: contract.personId,
      entryType: "COLLECTION",
      amount: payment.amount,
      effectiveDate: payment.paymentDate,
      paymentId: payment.id,
      description: `${formatINR(paise(payment.amount))} received from ${contract.person.fullName} (${number}) by ${payment.paymentMethod}`,
      createdAt: bn.now,
    },
  });

  await writeAudit(
    tx,
    actor,
    {
      action: "PAYMENT_CREATED",
      entityType: "Payment",
      entityId: payment.id,
      personId: contract.personId,
      contractId: contract.id,
      description: `${formatINR(paise(payment.amount))} received for ${number} dated ${input.paymentDate}${correctsPaymentId ? " (correction)" : ""}`,
      after: payment,
      metadata: { explanation, allocationRunId: outcome.allocationRunId },
    },
    bn.now,
  );

  return { payment, explanation, completed: outcome.completed };
}

async function reversePaymentTx(tx: Tx, paymentId: string, reason: string, actor: Actor, bn: BusinessNow, trigger: "PAYMENT_REVERSED" | "PAYMENT_CORRECTED") {
  const before = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  if (before.status === "REVERSED") throw new DomainError("INVALID_STATE", "This payment has already been reversed");

  const after = await tx.payment.update({
    where: { id: paymentId },
    data: { status: "REVERSED", reversedAt: bn.now, reversedById: actor.userId, reversalReason: reason },
  });
  await tx.ledgerEntry.create({
    data: {
      contractId: before.contractId,
      personId: before.personId,
      entryType: "COLLECTION_REVERSAL",
      amount: -before.amount,
      effectiveDate: toDbDate(bn.today),
      paymentId,
      description: `Reversal of ${formatINR(paise(before.amount))} received ${fromDbDate(before.paymentDate)}: ${reason}`,
      createdAt: bn.now,
    },
  });
  const outcome = await replanContract(tx, { contractId: before.contractId, trigger, triggerPaymentId: paymentId, actor, bn });
  await writeAudit(
    tx,
    actor,
    {
      action: "PAYMENT_REVERSED",
      entityType: "Payment",
      entityId: paymentId,
      personId: before.personId,
      contractId: before.contractId,
      description: `Reversed ${formatINR(paise(before.amount))} dated ${fromDbDate(before.paymentDate)}: ${reason}`,
      before,
      after,
      metadata: { allocationRunId: outcome.allocationRunId, reopenedContract: outcome.reopened },
    },
    bn.now,
  );
  return after;
}

export async function reversePayment(input: PaymentReversalInput, actor: Actor, opts: ServiceOptions = {}): Promise<Payment> {
  requireUserActor(actor);
  return prisma.$transaction(async (tx) => {
    const bn = businessNow(await getSettings(tx), opts.now);
    const p = await tx.payment.findUnique({ where: { id: input.paymentId }, select: { contractId: true } });
    if (!p) throw new DomainError("NOT_FOUND", "Payment not found");
    await lockContracts(tx, [p.contractId]);
    return reversePaymentTx(tx, input.paymentId, input.reason, actor, bn, "PAYMENT_REVERSED");
  }, TX_OPTIONS);
}

/**
 * Correct a payment (wrong amount, date, method, or even the wrong contract):
 * reverse the original (kept visible) and record the replacement, linked by
 * correctsPaymentId — atomically, with both contracts re-planned.
 */
export async function correctPayment(input: PaymentCorrectionInput, actor: Actor, opts: ServiceOptions = {}) {
  requireUserActor(actor);

  const replay = await prisma.payment.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (replay) {
    if (replay.correctsPaymentId !== input.originalPaymentId) {
      throw new DomainError("IDEMPOTENCY_CONFLICT", "This submission key was already used for a different payment");
    }
    return { original: await prisma.payment.findUniqueOrThrow({ where: { id: input.originalPaymentId } }), replacement: replay, explanation: await explainStoredPayment(replay), duplicate: true };
  }

  return prisma.$transaction(async (tx) => {
    const bn = businessNow(await getSettings(tx), opts.now);
    const original = await tx.payment.findUnique({ where: { id: input.originalPaymentId } });
    if (!original) throw new DomainError("NOT_FOUND", "Payment not found");
    await lockContracts(tx, [original.contractId, input.contractId]);

    const reversed = await reversePaymentTx(tx, original.id, `Correction: ${input.reason}`, actor, bn, "PAYMENT_CORRECTED");
    const { payment: replacement, explanation } = await insertPaymentTx(tx, input, actor, bn, "PAYMENT_CORRECTED", original.id);

    await writeAudit(
      tx,
      actor,
      {
        action: "PAYMENT_CORRECTED",
        entityType: "Payment",
        entityId: original.id,
        personId: replacement.personId,
        contractId: replacement.contractId,
        description: `Corrected ${formatINR(paise(original.amount))} (${fromDbDate(original.paymentDate)}) → ${formatINR(paise(replacement.amount))} (${input.paymentDate}): ${input.reason}`,
        before: original,
        after: replacement,
        metadata: {
          originalPaymentId: original.id,
          replacementPaymentId: replacement.id,
          movedContract: original.contractId !== replacement.contractId,
        },
      },
      bn.now,
    );
    return { original: reversed, replacement, explanation, duplicate: false };
  }, TX_OPTIONS);
}

