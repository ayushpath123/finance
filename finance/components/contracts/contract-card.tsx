import { ChevronRight, CircleAlert } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/finance/money";
import { StatusPill } from "@/components/finance/status";
import { Progress } from "@/components/ui/progress";
import type { BusinessDate } from "@/lib/finance/dates";
import { formatDay, relativeDay } from "@/lib/format";
import type { ContractAggregate } from "@/lib/services/read-models";

export function ContractCard({ c, today }: { c: ContractAggregate; today: BusinessDate }) {
  const pct = c.daysValid ? Math.round((c.daysSatisfied / c.daysValid) * 100) : 0;
  return (
    <Link
      href={`/contracts/${c.contractId}`}
      className="block rounded-2xl border bg-card p-4 shadow-xs outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted/60"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold">Contract {c.label}</span>
          <StatusPill status={c.status} />
        </div>
        <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">Principal</dt>
        <dd className="text-right"><Money value={c.principal} /></dd>
        <dt className="text-muted-foreground">Daily</dt>
        <dd className="text-right"><Money value={c.dailyAmount} /></dd>
        <dt className="text-muted-foreground">Duration</dt>
        <dd className="text-right">{c.totalDays} days</dd>
        <dt className="text-muted-foreground">Collected</dt>
        <dd className="text-right"><Money value={c.collected} /></dd>
        <dt className="text-muted-foreground">Outstanding</dt>
        <dd className="text-right font-semibold"><Money value={c.outstanding} /></dd>
      </dl>

      {c.overdue > 0 && (
        <p className="mt-2 inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-xs font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
          <CircleAlert className="size-3.5" aria-hidden />
          {c.overdueDays} missed · <Money value={c.overdue} /> overdue
        </p>
      )}

      <div className="mt-3">
        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
          <span>Progress</span>
          <span className="tabular-nums">
            {c.daysSatisfied} / {c.daysValid} days
          </span>
        </div>
        <Progress value={pct} aria-label={`${pct}% of obligations satisfied`} className="h-2" />
      </div>

      <div className="mt-3 flex items-end justify-between text-sm">
        <div>
          <p className="text-xs text-muted-foreground">Next collection</p>
          <p className="font-medium">
            {c.nextDue ? (
              <>
                {relativeDay(c.nextDue.date, today)} · <Money value={c.nextDue.amount} />
              </>
            ) : c.status === "COMPLETED" ? (
              "Fully collected"
            ) : (
              "—"
            )}
          </p>
        </div>
        <p className="text-xs text-muted-foreground">Final {formatDay(c.finalCollectionDate)}</p>
      </div>
    </Link>
  );
}
