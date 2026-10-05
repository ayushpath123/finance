/**
 * Re-verifies every contract's books (read-only). Exit code 1 on any issue.
 *   npm run db:verify
 */
import "./load-env";
import { prisma } from "@/lib/db/client";
import { formatINR, paise } from "@/lib/finance/money";
import { formatContractNumber } from "@/lib/services/contracts";
import { checkContractIntegrity, checkShortTermIntegrity } from "@/lib/services/integrity";
import { formatShortTermNumber } from "@/lib/services/short-term";
import { getContractSummary } from "@/lib/services/read-models";

async function main() {
  const contracts = await prisma.contract.findMany({
    orderBy: { contractNumber: "asc" },
    include: { person: { select: { fullName: true } } },
  });
  let problems = 0;
  for (const c of contracts) {
    const [issues, s] = await Promise.all([checkContractIntegrity(c.id), getContractSummary(c.id)]);
    problems += issues.length;
    console.log(
      [
        formatContractNumber(c.contractNumber).padEnd(8),
        c.person.fullName.padEnd(18),
        c.status.padEnd(10),
        `${s.daysSatisfied}/${s.daysTotal - s.daysCancelled} satisfied`.padEnd(16),
        `collected ${formatINR(s.collected)}`.padEnd(20),
        `outstanding ${formatINR(s.outstanding)}`.padEnd(24),
        `overdue ${formatINR(s.overdue)}`.padEnd(18),
        `prepaid ${formatINR(s.prepaid)}`.padEnd(18),
        `credit ${formatINR(s.credit)}`,
        s.cancelledObligation ? `cancelled ${formatINR(s.cancelledObligation)}` : "",
        issues.length ? `  ✗ ${issues.map((i) => i.problem).join("; ")}` : "  ✓",
      ].join(" "),
    );
  }
  const loans = await prisma.shortTermLoan.findMany({ orderBy: { loanNumber: "asc" }, include: { person: { select: { fullName: true } } } });
  for (const l of loans) {
    const issues = await checkShortTermIntegrity(l.id);
    problems += issues.length;
    console.log(
      `${formatShortTermNumber(l.loanNumber, l.direction).padEnd(8)} ${l.person.fullName.padEnd(18)} ${l.status.padEnd(10)} given ${formatINR(paise(l.principalAmount))} + ${formatINR(paise(l.interestAmount))} interest${issues.length ? `  ✗ ${issues.map((i) => i.problem).join("; ")}` : "  ✓"}`,
    );
  }
  const totals = await prisma.ledgerEntry.aggregate({ _sum: { amount: true } });
  console.log(`\n${contracts.length} contracts, ${loans.length} short-term loans/borrowings, ${problems} issue(s). Net ledger cash: ${formatINR(paise(totals._sum.amount ?? 0))}`);
  process.exit(problems ? 1 : 0);
}

main().finally(() => prisma.$disconnect());
