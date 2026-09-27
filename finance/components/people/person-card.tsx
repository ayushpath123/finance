import { CheckCircle2, CircleAlert, ChevronRight } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/finance/money";
import { StatusPill } from "@/components/finance/status";
import type { PersonListItem } from "@/lib/services/read-models";

/** The whole card is the tap target. */
export function PersonCard({ person, href }: { person: PersonListItem; href?: string }) {
  const t = person.totals;
  return (
    <Link
      href={href ?? `/people/${person.slug}`}
      className="block rounded-2xl border bg-card p-4 shadow-xs transition-colors outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted/60"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold">{person.fullName}</p>
          <p className="font-mono text-sm text-muted-foreground">{person.phoneNumber}</p>
        </div>
        <div className="flex items-center gap-1">
          {person.status !== "ACTIVE" && <StatusPill status={person.status} />}
          <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
        </div>
      </div>

      <dl className="mt-3 space-y-1 text-sm">
        <div className="flex justify-between">
          <dt className="text-muted-foreground">
            {t.activeContracts} active contract{t.activeContracts === 1 ? "" : "s"}
          </dt>
        </div>
        <div className="flex justify-between">
          <dt className="text-muted-foreground">Outstanding</dt>
          <dd className="font-semibold">
            <Money value={t.outstanding} />
          </dd>
        </div>
        {t.todayExpected > 0 && (
          <div className="flex justify-between">
            <dt className="text-muted-foreground">Today&apos;s due</dt>
            <dd>
              <Money value={t.todayRemaining} />
            </dd>
          </div>
        )}
      </dl>

      {(t.missedDays > 0 || person.paidToday) && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs font-medium">
          {t.missedDays > 0 && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-red-700 dark:bg-red-950 dark:text-red-300">
              <CircleAlert className="size-3.5" aria-hidden />
              {t.missedDays} missed · <Money value={t.missed} />
            </span>
          )}
          {person.paidToday && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-1 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              <CheckCircle2 className="size-3.5" aria-hidden />
              Paid today
            </span>
          )}
        </div>
      )}
    </Link>
  );
}
