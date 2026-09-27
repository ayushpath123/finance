import "server-only";
import { prisma, TX_OPTIONS } from "@/lib/db/client";
import { toDbDate } from "@/lib/finance/dates";
import type { ReconciliationTrigger } from "@/lib/generated/prisma/client";
import { SYSTEM_ACTOR, type ServiceOptions } from "./actor";
import { writeAudit } from "./audit";
import { lockContracts, replanContract } from "./contract-engine";
import { businessNow, getSettings } from "./settings";

export interface ReconciliationSummary {
  runId: string;
  closedThrough: string;
  contractsChecked: number;
  schedulesMarkedMissed: number;
  schedulesUpdated: number;
  contractsCompleted: number;
}

/**
 * End-of-day reconciliation. For every contract that has an obligation dated
 * on/before today still stored as PENDING/PARTIAL, re-derive the contract's
 * state under its row lock and persist the diff:
 *   - closed days → MISSED / PARTIAL / PAID / SETTLED_LATE
 *   - first time a day closes short → missedAt, memo ledger, audit (deduplicated)
 *   - prepaid future days are untouched (they are not candidates)
 * Idempotent: a second run finds nothing to change and writes only its run record.
 * Each contract is its own transaction, so one bad contract can't block the rest.
 */
export async function reconcileDailyCollections(
  trigger: ReconciliationTrigger,
  opts: ServiceOptions = {},
): Promise<ReconciliationSummary> {
  const bn = businessNow(await getSettings(), opts.now);
  const run = await prisma.reconciliationRun.create({
    data: { trigger, closedThrough: toDbDate(bn.closedThrough), startedAt: bn.now },
  });

  const summary = { contractsChecked: 0, schedulesMarkedMissed: 0, schedulesUpdated: 0, contractsCompleted: 0 };
  try {
    const candidates = await prisma.$queryRaw<{ contractId: string }[]>`
      SELECT DISTINCT s."contractId"
      FROM "collection_schedules" s
      JOIN "contracts" c ON c."id" = s."contractId"
      WHERE c."status" IN ('ACTIVE', 'DEFAULTED', 'CANCELLED')
        AND s."status" IN ('PENDING', 'PARTIAL')
        AND s."scheduledDate" <= ${toDbDate(bn.today)}::date`;

    for (const { contractId } of candidates) {
      const outcome = await prisma.$transaction(async (tx) => {
        await lockContracts(tx, [contractId]);
        return replanContract(tx, { contractId, trigger: "RECONCILIATION", actor: SYSTEM_ACTOR, bn });
      }, TX_OPTIONS);
      summary.contractsChecked++;
      summary.schedulesMarkedMissed += outcome.markedMissed;
      summary.schedulesUpdated += outcome.plan.scheduleUpdates.length;
      if (outcome.completed) summary.contractsCompleted++;
    }

    await prisma.$transaction(async (tx) => {
      await tx.reconciliationRun.update({
        where: { id: run.id },
        data: { status: "SUCCEEDED", finishedAt: new Date(), ...summary },
      });
      if (summary.schedulesUpdated > 0) {
        await writeAudit(
          tx,
          SYSTEM_ACTOR,
          {
            action: "RECONCILIATION_RUN",
            entityType: "ReconciliationRun",
            entityId: run.id,
            description: `Closed through ${bn.closedThrough}: ${summary.schedulesMarkedMissed} missed, ${summary.schedulesUpdated} updated (${trigger})`,
            metadata: summary,
          },
          bn.now,
        );
      }
    });
  } catch (err) {
    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date(), error: String(err instanceof Error ? err.message : err).slice(0, 2000), ...summary },
    });
    throw err;
  }

  return { runId: run.id, closedThrough: bn.closedThrough, ...summary };
}

/**
 * Cheap guard for page loads: reconcile only if no successful run has
 * covered the current closed business day yet. Never throws into the page.
 */
export async function ensureReconciled(opts: ServiceOptions = {}): Promise<void> {
  const bn = businessNow(await getSettings(), opts.now);
  const latest = await prisma.reconciliationRun.findFirst({
    where: { status: "SUCCEEDED", closedThrough: { gte: toDbDate(bn.closedThrough) } },
    select: { id: true },
  });
  if (latest) return;
  try {
    await reconcileDailyCollections("DASHBOARD", opts);
  } catch (err) {
    console.error("[reconcile] dashboard-triggered reconciliation failed", err);
  }
}
