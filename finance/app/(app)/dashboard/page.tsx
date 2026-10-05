import { CheckCircle2, CircleAlert, HandCoins } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Money, Stat } from "@/components/finance/money";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDayFull } from "@/lib/format";
import { getTodayOverview } from "@/lib/services/read-models";
import { ensureReconciled } from "@/lib/services/reconciliation";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  await requireAdmin();
  await ensureReconciled(); // close any day the nightly job hasn't yet
  const o = await getTodayOverview();
  const t = o.totals;
  const pending = o.due.filter((d) => d.todayAllocated < d.todayExpected);
  const done = o.due.length - pending.length;
  const pct = t.todayExpected ? Math.round((t.todayAllocated / t.todayExpected) * 100) : 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Today" subtitle={formatDayFull(o.bn.today)} />

      <section aria-label="Today's collections" className="rounded-2xl bg-primary p-5 text-primary-foreground">
        <div className="flex items-end justify-between gap-3">
          <div>
            <p className="text-xs font-medium tracking-wider uppercase opacity-80">Collected for today</p>
            <p className="mt-1 text-4xl font-semibold tracking-tight">
              <Money value={t.todayAllocated} />
            </p>
            <p className="text-sm opacity-80">
              of <Money value={t.todayExpected} /> expected · {pct}%
            </p>
          </div>
          <div className="text-right text-sm">
            <p className="opacity-80">Pending</p>
            <p className="text-xl font-semibold">
              <Money value={t.todayRemaining} />
            </p>
          </div>
        </div>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-primary-foreground/20">
          <div className="h-full rounded-full bg-primary-foreground" style={{ width: `${pct}%` }} />
        </div>
        <p className="mt-2 text-xs opacity-80">
          {done} of {o.due.length} paid · <Money value={o.receivedToday} /> received today in {o.paymentsToday} payment{o.paymentsToday === 1 ? "" : "s"}
        </p>
      </section>

      <Link
        href="/settlements"
        className={`flex items-center justify-between gap-3 rounded-2xl border p-4 hover:bg-muted/40 ${o.netPosition >= 0 ? "border-emerald-200 dark:border-emerald-900" : "border-amber-300 dark:border-amber-900"}`}
      >
        <span>
          <span className="block text-xs font-medium tracking-wider text-muted-foreground uppercase">Net position</span>
          <span className="block text-sm">
            {o.netPosition > 0 ? "You will receive more than you pay" : o.netPosition < 0 ? "You have to pay more than you will receive" : "All square"}
          </span>
        </span>
        <span className={`text-right text-2xl font-semibold ${o.netPosition >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-amber-700 dark:text-amber-400"}`}>
          <Money value={Math.abs(o.netPosition)} />
          <span className="block text-xs font-normal text-primary">Settlements →</span>
        </span>
      </Link>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label="Missed outstanding" value={t.missed} tone={t.missed ? "danger" : undefined} hint={`${t.missedDays} day${t.missedDays === 1 ? "" : "s"}`} />
        <Stat label="Total outstanding" value={t.outstanding} />
        <Stat label="Prepaid future" value={t.prepaid} tone="info" />
        <Link href="/lending" className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Stat label="Short-term out" value={o.shortTerm.outstanding} hint={`${o.shortTerm.open} open · tap to view`} className="h-full hover:bg-muted/40" />
        </Link>
        <Link href="/borrowing" className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <Stat label="I owe (borrowed)" value={o.borrowed.outstanding} hint={`${o.borrowed.open} open · tap to view`} className="h-full hover:bg-muted/40" />
        </Link>
        {t.credit > 0 && <Stat label="Unallocated credit" value={t.credit} tone="info" />}
        <Stat label="Principal given" value={t.principalGiven} />
        <Stat label="Contracted" value={t.contracted} />
        <Stat label="Total collected" value={t.collected} tone="success" />
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs text-muted-foreground">Active</p>
          <p className="mt-0.5 text-lg font-semibold">
            {o.activePeople} <span className="text-sm font-normal text-muted-foreground">people</span> · {t.activeContracts}{" "}
            <span className="text-sm font-normal text-muted-foreground">contracts</span>
          </p>
        </div>
      </div>

      <section aria-labelledby="due-h" className="space-y-2">
        <h2 id="due-h" className="text-lg font-semibold">
          Today&apos;s collections <span className="text-muted-foreground">({o.due.length})</span>
        </h2>
        {o.due.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing is due today.</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {o.due.map((d) => {
              const paid = d.todayAllocated >= d.todayExpected;
              return (
                <li key={d.contractId} className="flex min-h-16 items-center gap-3 px-4 py-2.5">
                  <Link href={`/people/${d.person.slug}`} className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{d.person.fullName}</span>
                    <span className="block text-xs text-muted-foreground">
                      {d.label} · <Money value={d.todayExpected} />
                      {d.overdue > 0 && (
                        <span className="text-red-600">
                          {" "}
                          · <CircleAlert className="inline size-3" aria-hidden /> <Money value={d.overdue} /> overdue
                        </span>
                      )}
                    </span>
                  </Link>
                  {paid ? (
                    <span className="inline-flex items-center gap-1 text-sm font-medium text-emerald-700">
                      <CheckCircle2 className="size-4" aria-hidden /> Paid
                    </span>
                  ) : (
                    <Button asChild size="lg" className="h-11 rounded-xl">
                      <Link href={`/collect?person=${d.person.slug}&contract=${d.contractId}`} aria-label={`Record payment for ${d.person.fullName}`}>
                        <HandCoins aria-hidden />
                        {d.todayAllocated > 0 ? <Money value={d.todayExpected - d.todayAllocated} /> : "Collect"}
                      </Link>
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
