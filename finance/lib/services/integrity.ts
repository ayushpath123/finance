import "server-only";
import { prisma } from "@/lib/db/client";
import { planContractState } from "@/lib/finance/contract-state";
import { loadContractFacts } from "./contract-engine";
import { businessNow, getSettings } from "./settings";

export interface IntegrityIssue {
  contractId: string;
  problem: string;
}

/**
 * Independent re-verification of one contract's books (read-only):
 *  - re-running the allocation engine on stored facts yields NO changes
 *  - ledger COLLECTION / COLLECTION_REVERSAL / DISBURSEMENT rows mirror the transactions 1:1
 *  - no active allocation points at a reversed payment
 * The DB constraints guarantee most of this already; this proves it end-to-end.
 */
export async function checkContractIntegrity(contractId: string, opts: { now?: Date } = {}): Promise<IntegrityIssue[]> {
  const issues: IntegrityIssue[] = [];
  const bn = businessNow(await getSettings(), opts.now);

  await prisma.$transaction(async (tx) => {
    const facts = await loadContractFacts(tx, contractId);
    const plan = planContractState(facts, { today: bn.today, closedThrough: bn.closedThrough });
    if (plan.toVoid.length || plan.toCreate.length) {
      issues.push({ contractId, problem: `allocations drifted: ${plan.toVoid.length} to void, ${plan.toCreate.length} to create` });
    }
    const drifted = plan.scheduleUpdates.filter((u) => !u.markMissed || u.allocatedAmount !== facts.schedules.find((s) => s.id === u.id)!.allocatedAmount);
    if (drifted.length) issues.push({ contractId, problem: `${drifted.length} schedule projection(s) out of date` });

    const [payments, disbursements, ledger] = await Promise.all([
      tx.payment.findMany({ where: { contractId }, select: { id: true, amount: true, status: true } }),
      tx.disbursement.findMany({ where: { contractId }, select: { id: true, amount: true, status: true } }),
      tx.ledgerEntry.findMany({ where: { contractId }, select: { entryType: true, amount: true, paymentId: true, disbursementId: true } }),
    ]);
    const ledgerFor = (type: string, key: "paymentId" | "disbursementId", id: string) =>
      ledger.filter((l) => l.entryType === type && l[key] === id);

    for (const p of payments) {
      const col = ledgerFor("COLLECTION", "paymentId", p.id);
      if (col.length !== 1 || col[0].amount !== p.amount) issues.push({ contractId, problem: `payment ${p.id} has no matching COLLECTION entry` });
      const rev = ledgerFor("COLLECTION_REVERSAL", "paymentId", p.id);
      const expectRev = p.status === "REVERSED" ? 1 : 0;
      if (rev.length !== expectRev || (expectRev && rev[0].amount !== -p.amount)) {
        issues.push({ contractId, problem: `payment ${p.id} reversal ledger mismatch` });
      }
    }
    for (const d of disbursements) {
      const out = ledgerFor("DISBURSEMENT", "disbursementId", d.id);
      if (out.length !== 1 || out[0].amount !== -d.amount) issues.push({ contractId, problem: `disbursement ${d.id} has no matching ledger entry` });
      const rev = ledgerFor("DISBURSEMENT_REVERSAL", "disbursementId", d.id);
      if (rev.length !== (d.status === "REVERSED" ? 1 : 0)) issues.push({ contractId, problem: `disbursement ${d.id} reversal ledger mismatch` });
    }

    const reversedIds = payments.filter((p) => p.status === "REVERSED").map((p) => p.id);
    if (reversedIds.length) {
      const bad = await tx.paymentAllocation.count({ where: { paymentId: { in: reversedIds }, voidedAt: null } });
      if (bad) issues.push({ contractId, problem: `${bad} active allocation(s) on reversed payments` });
    }
  });
  return issues;
}
