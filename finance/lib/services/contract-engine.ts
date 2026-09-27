/**
 * The bridge between the pure planner (lib/finance/contract-state) and the DB.
 * Every function here runs INSIDE a caller's transaction that already holds
 * the contract row lock (see lockContracts), so plans are computed from a
 * consistent snapshot and applied atomically.
 */

import { Prisma } from "@/lib/generated/prisma/client";
import type { AllocationTrigger, Contract } from "@/lib/generated/prisma/client";
import type { Tx } from "@/lib/db/client";
import type { AllocatablePayment, AllocationLine, ExistingAllocation } from "@/lib/finance/allocation";
import { planContractState, type ContractFacts, type ContractPlan, type ScheduleRecord } from "@/lib/finance/contract-state";
import { fromDbDate, toDbDate, type BusinessDate } from "@/lib/finance/dates";
import { formatINR, paise } from "@/lib/finance/money";
import type { ScheduleStatus } from "@/lib/finance/schedule-status";
import { SYSTEM_ACTOR, type Actor } from "./actor";
import { writeAudit, type AuditInput } from "./audit";
import { DomainError } from "./errors";
import type { BusinessNow } from "./settings";

/** SELECT … FOR UPDATE, in id order so two contracts can never deadlock. */
export async function lockContracts(tx: Tx, contractIds: string[]): Promise<void> {
  const ids = [...new Set(contractIds)].sort();
  for (const id of ids) {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "contracts" WHERE "id" = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new DomainError("NOT_FOUND", "Contract not found", { contractId: id });
  }
}

export async function loadContractFacts(tx: Tx, contractId: string): Promise<ContractFacts> {
  const [schedules, payments, allocations] = await Promise.all([
    tx.collectionSchedule.findMany({
      where: { contractId },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        sequence: true,
        scheduledDate: true,
        expectedAmount: true,
        allocatedAmount: true,
        status: true,
        missedAt: true,
        cancelledAt: true,
      },
    }),
    tx.payment.findMany({
      where: { contractId, status: "ACTIVE" },
      select: { id: true, amount: true, paymentDate: true, recordedAt: true },
    }),
    tx.paymentAllocation.findMany({
      where: { contractId, voidedAt: null },
      orderBy: { createdAt: "asc" },
      select: { id: true, paymentId: true, scheduleId: true, amount: true },
    }),
  ]);

  return {
    schedules: schedules.map(
      (s): ScheduleRecord => ({
        id: s.id,
        sequence: s.sequence,
        scheduledDate: fromDbDate(s.scheduledDate),
        expectedAmount: paise(s.expectedAmount),
        allocatedAmount: paise(s.allocatedAmount),
        status: s.status as ScheduleStatus,
        missedAt: s.missedAt?.toISOString() ?? null,
        cancelled: s.cancelledAt !== null,
      }),
    ),
    payments: payments.map(
      (p): AllocatablePayment => ({
        id: p.id,
        amount: paise(p.amount),
        paymentDate: fromDbDate(p.paymentDate),
        recordedAt: p.recordedAt.toISOString(),
      }),
    ),
    activeAllocations: allocations.map(
      (a): ExistingAllocation => ({ id: a.id, paymentId: a.paymentId, scheduleId: a.scheduleId, amount: paise(a.amount) }),
    ),
  };
}

export interface ReplanOutcome {
  contract: Contract;
  facts: ContractFacts;
  plan: ContractPlan;
  allocationRunId: string | null;
  markedMissed: number;
  completed: boolean;
  reopened: boolean;
}

/**
 * Recompute the contract's allocation + schedule state and persist the diff.
 * Idempotent: replanning an already-consistent contract writes nothing.
 */
export async function replanContract(
  tx: Tx,
  args: {
    contractId: string;
    trigger: AllocationTrigger;
    triggerPaymentId?: string | null;
    actor: Actor;
    bn: BusinessNow;
    cancelScheduleIds?: ReadonlySet<string>;
  },
): Promise<ReplanOutcome> {
  const { contractId, trigger, actor, bn } = args;
  const now = bn.now;
  const contract = await tx.contract.findUniqueOrThrow({ where: { id: contractId } });
  const facts = await loadContractFacts(tx, contractId);
  const plan = planContractState(facts, { today: bn.today, closedThrough: bn.closedThrough }, {
    cancelScheduleIds: args.cancelScheduleIds,
  });

  const dateOf = new Map<string, BusinessDate>(facts.schedules.map((s) => [s.id, s.scheduledDate]));
  const audits: AuditInput[] = [];
  let allocationRunId: string | null = null;

  // ── allocations ─────────────────────────────────────────────
  if (plan.toVoid.length > 0 || plan.toCreate.length > 0) {
    const describe = (a: AllocationLine) => ({ paymentId: a.paymentId, scheduleDate: dateOf.get(a.scheduleId), amount: a.amount });
    const run = await tx.allocationRun.create({
      data: {
        contractId,
        trigger,
        triggerPaymentId: args.triggerPaymentId ?? null,
        policy: contract.allocationPolicy,
        createdCount: plan.toCreate.length,
        voidedCount: plan.toVoid.length,
        summary: { created: plan.toCreate.map(describe), voided: plan.toVoid.map(describe) },
        createdById: actor.userId,
        createdAt: now,
      },
    });
    allocationRunId = run.id;

    if (plan.toVoid.length > 0) {
      const voided = await tx.paymentAllocation.updateMany({
        where: { id: { in: plan.toVoid.map((a) => a.id) }, voidedAt: null },
        data: { voidedAt: now, voidedRunId: run.id, voidReason: trigger },
      });
      if (voided.count !== plan.toVoid.length) {
        throw new Error(`Allocation state changed concurrently on contract ${contractId}`);
      }
    }
    if (plan.toCreate.length > 0) {
      await tx.paymentAllocation.createMany({
        data: plan.toCreate.map((a) => ({
          contractId,
          paymentId: a.paymentId,
          scheduleId: a.scheduleId,
          amount: a.amount,
          createdRunId: run.id,
          createdAt: now,
        })),
      });
    }

    for (const [action, lines] of [
      ["PAYMENT_UNALLOCATED", plan.toVoid],
      ["PAYMENT_ALLOCATED", plan.toCreate],
    ] as const) {
      const byPayment = new Map<string, AllocationLine[]>();
      for (const l of lines) byPayment.set(l.paymentId, [...(byPayment.get(l.paymentId) ?? []), l]);
      for (const [paymentId, group] of byPayment) {
        const total = paise(group.reduce((t, l) => t + l.amount, 0));
        audits.push({
          action,
          entityType: "Payment",
          entityId: paymentId,
          personId: contract.personId,
          contractId,
          description: `${action === "PAYMENT_ALLOCATED" ? "Allocated" : "Unallocated"} ${formatINR(total)} across ${group.length} day(s) (${trigger})`,
          metadata: { allocationRunId: run.id, trigger, lines: group.map(describe) },
        });
      }
    }
  }

  // ── schedule projection (one batched UPDATE) ────────────────────
  if (plan.scheduleUpdates.length > 0) {
    const rows = plan.scheduleUpdates.map((u) => {
      const prev = facts.schedules.find((s) => s.id === u.id)!;
      const full = u.allocatedAmount >= prev.expectedAmount && !u.cancel;
      const settle = u.becameSettled ? "set" : full ? "keep" : "clear";
      return Prisma.sql`(${u.id}::uuid, ${u.allocatedAmount}::int, ${u.status}::"ScheduleStatus", ${settle}::text, ${u.markMissed !== null}::boolean, ${u.markMissed?.shortfall ?? null}::int, ${u.cancel}::boolean)`;
    });
    const updated = await tx.$executeRaw`
      UPDATE "collection_schedules" AS s SET
        "allocatedAmount"  = v.alloc,
        "status"           = v.status,
        "settledAt"        = CASE v.settle WHEN 'set' THEN ${now}::timestamptz WHEN 'clear' THEN NULL ELSE s."settledAt" END,
        "missedAt"         = CASE WHEN v.missed THEN ${now}::timestamptz ELSE s."missedAt" END,
        "shortfallAtClose" = CASE WHEN v.missed THEN v.shortfall ELSE s."shortfallAtClose" END,
        "cancelledAt"      = CASE WHEN v.cancel THEN ${now}::timestamptz ELSE s."cancelledAt" END,
        "updatedAt"        = ${now}::timestamptz
      FROM (VALUES ${Prisma.join(rows)}) AS v(id, alloc, status, settle, missed, shortfall, cancel)
      WHERE s."id" = v.id AND s."contractId" = ${contractId}::uuid`;
    if (updated !== plan.scheduleUpdates.length) {
      throw new Error(`Expected to update ${plan.scheduleUpdates.length} schedules, updated ${updated}`);
    }
  }

  // ── missed-at-close history: memo ledger + audit, both deduplicated ──
  const missed = plan.scheduleUpdates.filter((u) => u.markMissed);
  if (missed.length > 0) {
    await tx.ledgerEntry.createMany({
      skipDuplicates: true,
      data: missed.map((u) => ({
        contractId,
        personId: contract.personId,
        entryType: "SCHEDULE_MISSED" as const,
        amount: 0,
        memoAmount: u.markMissed!.shortfall,
        effectiveDate: toDbDate(dateOf.get(u.id)!),
        scheduleId: u.id,
        description: `Collection for ${dateOf.get(u.id)} closed with ${formatINR(u.markMissed!.shortfall)} unpaid`,
        createdAt: now,
      })),
    });
    // Missing a day is a system event, whoever's action happened to trigger the replan.
    const systemAudits: AuditInput[] = [];
    for (const u of missed) {
      systemAudits.push({
        action: "SCHEDULE_MARKED_MISSED",
        entityType: "CollectionSchedule",
        entityId: u.id,
        personId: contract.personId,
        contractId,
        description: `${dateOf.get(u.id)}: ${formatINR(u.markMissed!.shortfall)} unpaid at end of day (${u.status})`,
        after: { status: u.status, shortfallAtClose: u.markMissed!.shortfall },
        dedupeKey: `SCHEDULE_MARKED_MISSED:${u.id}`,
      });
    }
    await writeAudit(tx, SYSTEM_ACTOR, systemAudits, now);
  }

  // ── lifecycle: completion / reopen ─────────────────────────────
  let completed = false;
  let reopened = false;
  let current = contract;
  if (plan.fullyCollected && (contract.status === "ACTIVE" || contract.status === "DEFAULTED")) {
    current = await tx.contract.update({ where: { id: contractId }, data: { status: "COMPLETED", completedAt: now } });
    completed = true;
    audits.push({
      action: "CONTRACT_COMPLETED",
      entityType: "Contract",
      entityId: contractId,
      personId: contract.personId,
      contractId,
      description: `All ${facts.schedules.length} obligations satisfied`,
      before: { status: contract.status },
      after: { status: "COMPLETED" },
    });
  } else if (!plan.fullyCollected && contract.status === "COMPLETED") {
    current = await tx.contract.update({ where: { id: contractId }, data: { status: "ACTIVE", completedAt: null } });
    reopened = true;
    audits.push({
      action: "CONTRACT_REOPENED",
      entityType: "Contract",
      entityId: contractId,
      personId: contract.personId,
      contractId,
      description: `Obligations unpaid again after ${trigger}`,
      before: { status: "COMPLETED" },
      after: { status: "ACTIVE" },
    });
  }

  await writeAudit(tx, actor, audits, now);
  return { contract: current, facts, plan, allocationRunId, markedMissed: missed.length, completed, reopened };
}
