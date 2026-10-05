import { ArrowDownLeft, ArrowUpRight, ChevronRight, Scale } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Money } from "@/components/finance/money";
import { AgeingBars } from "@/components/settlement/ageing-bars";
import { PageHeader } from "@/components/shell/page-header";
import { requireAdmin } from "@/lib/auth/dal";
import { formatMonth } from "@/lib/format";
import { getSettlementOverview } from "@/lib/services/settlement-read";
import { businessNow, getSettings } from "@/lib/services/settings";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Settlements" };

const FILTERS = [
  ["all", "Everyone"],
  ["owe-me", "They owe me"],
  ["i-owe", "I owe"],
] as const;

/** The whole book on one screen: what comes in, what goes out, and who owes whom after both directions. */
export default async function SettlementsPage({ searchParams }: PageProps<"/settlements">) {
  await requireAdmin();
  const filter = (await searchParams).who;
  const bn = businessNow(await getSettings());
  const o = await getSettlementOverview(bn);
  const { position: p, month: m } = o;
  const receiveMore = p.net > 0;
  const allSquare = p.net === 0;
  const people = o.people.filter((r) => (filter === "owe-me" ? r.net > 0 : filter === "i-owe" ? r.net < 0 : true));
  const netCash = m.moneyIn - m.moneyOut;

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <PageHeader title="Settlements" subtitle="Everything owed to you vs everything you owe" />

      {/* Net position */}
      <section
        aria-label="Net position"
        className={cn(
          "rounded-2xl p-5",
          allSquare ? "bg-muted" : receiveMore ? "bg-emerald-700 text-white dark:bg-emerald-800" : "bg-amber-600 text-white dark:bg-amber-700",
        )}
      >
        <p className="flex items-center gap-1.5 text-xs font-medium tracking-wider uppercase opacity-90">
          <Scale className="size-4" aria-hidden /> Net position
        </p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">
          <Money value={Math.abs(p.net)} />
        </p>
        <p className="mt-1 text-base font-medium">
          {allSquare ? "All square — nothing to give or take." : receiveMore ? "You will receive more than you pay." : "You have to pay more than you will receive."}
        </p>
        <p className="mt-2 text-sm opacity-90">
          <Money value={p.receivable.total} /> owed to you − <Money value={p.payable.total} /> you owe
        </p>
      </section>

      {/* Receivable vs payable */}
      <div className="grid gap-3 sm:grid-cols-2">
        <section aria-labelledby="rec-h" className="rounded-2xl border bg-card p-4">
          <h2 id="rec-h" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-full bg-emerald-50 text-emerald-700 dark:bg-emerald-950" aria-hidden>
              <ArrowDownLeft className="size-4" />
            </span>
            Owed to you
          </h2>
          <p className="mt-2 text-2xl font-semibold text-emerald-700 dark:text-emerald-400">
            <Money value={p.receivable.total} />
          </p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Daily contracts" value={p.receivable.contracts} href="/people" />
            <Row label="Short-term principal" value={p.receivable.lentPrincipal} href="/lending" />
            <Row label="Short-term interest" value={p.receivable.lentInterest} href="/lending" />
          </dl>
        </section>
        <section aria-labelledby="pay-h" className="rounded-2xl border bg-card p-4">
          <h2 id="pay-h" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-full bg-amber-50 text-amber-700 dark:bg-amber-950" aria-hidden>
              <ArrowUpRight className="size-4" />
            </span>
            You owe
          </h2>
          <p className="mt-2 text-2xl font-semibold text-amber-700 dark:text-amber-400">
            <Money value={p.payable.total} />
          </p>
          <dl className="mt-3 space-y-1.5 text-sm">
            <Row label="Borrowed principal" value={p.payable.borrowedPrincipal} href="/borrowing" />
            <Row label="Interest to pay" value={p.payable.borrowedInterest} href="/borrowing" />
          </dl>
        </section>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/lending" className="rounded-xl border bg-card p-3 hover:bg-muted/40">
          <p className="text-xs text-muted-foreground">Lending · {o.openLent} open</p>
          <p className="mt-0.5 font-semibold">
            <Money value={p.receivable.lentPrincipal + p.receivable.lentInterest} />
          </p>
          <p className="text-xs text-primary">Open Lending →</p>
        </Link>
        <Link href="/borrowing" className="rounded-xl border bg-card p-3 hover:bg-muted/40">
          <p className="text-xs text-muted-foreground">Borrowing · {o.openBorrowed} open</p>
          <p className="mt-0.5 font-semibold">
            <Money value={p.payable.total} />
          </p>
          <p className="text-xs text-primary">Open Borrowing →</p>
        </Link>
        <div className="rounded-xl border bg-card p-3">
          <p className="text-xs text-muted-foreground">Interest earn − pay</p>
          <p className={cn("mt-0.5 font-semibold", p.netInterest >= 0 ? "text-emerald-700" : "text-red-600")}>
            <Money value={p.netInterest} signed />
          </p>
          <p className="text-xs text-muted-foreground">
            <Money value={p.receivable.lentInterest} /> to earn · <Money value={p.payable.borrowedInterest} /> to pay
          </p>
        </div>
      </div>

      {/* This month */}
      <section aria-labelledby="month-h" className="rounded-2xl border bg-card p-4">
        <div className="mb-3 flex items-baseline justify-between gap-2">
          <h2 id="month-h" className="font-semibold">
            {formatMonth(m.from.slice(0, 7))}
          </h2>
          <p className={cn("text-sm font-medium", netCash >= 0 ? "text-emerald-700" : "text-red-600")}>
            Net cash <Money value={netCash} signed />
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <dl className="space-y-1.5 text-sm">
            <dt className="font-medium text-emerald-700 dark:text-emerald-400">
              Money in · <Money value={m.moneyIn} />
            </dt>
            <Row label="Daily collections" value={m.contracts.collected} />
            <Row label="Short-term received back" value={m.lent.back} />
            <Row label="Borrowed" value={m.borrowed.received} />
          </dl>
          <dl className="space-y-1.5 text-sm">
            <dt className="font-medium text-amber-700 dark:text-amber-400">
              Money out · <Money value={m.moneyOut} />
            </dt>
            <Row label="Contract principal given" value={m.contracts.given} />
            <Row label="Short-term given" value={m.lent.given} />
            <Row label="Paid back to lenders" value={m.borrowed.paidBack} />
          </dl>
        </div>
      </section>

      {/* Who owes whom */}
      <section aria-labelledby="people-h" className="space-y-2">
        <h2 id="people-h" className="text-lg font-semibold">
          Who owes whom
        </h2>
        <p className="text-sm text-muted-foreground">Per person, after everything they owe you and everything you owe them.</p>
        <div role="tablist" className="grid grid-cols-3 gap-1 rounded-xl bg-muted p-1 text-sm font-medium">
          {FILTERS.map(([key, label]) => (
            <Link
              key={key}
              role="tab"
              aria-selected={(filter ?? "all") === key}
              href={key === "all" ? "/settlements" : `/settlements?who=${key}`}
              scroll={false}
              className={cn("flex h-10 items-center justify-center rounded-lg", (filter ?? "all") === key ? "bg-background shadow-sm" : "text-muted-foreground")}
            >
              {label}
            </Link>
          ))}
        </div>
        {people.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nobody here.</p>
        ) : (
          <ul className="divide-y rounded-2xl border bg-card">
            {people.map((r) => {
              const theyOwe = r.net > 0;
              return (
                <li key={r.personId}>
                  <Link href={`/people/${r.slug}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/40">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{r.fullName}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {r.theyOweMe > 0 && (
                          <>
                            owes you <Money value={r.theyOweMe} />
                          </>
                        )}
                        {r.theyOweMe > 0 && r.iOweThem > 0 && " · "}
                        {r.iOweThem > 0 && (
                          <>
                            you owe <Money value={r.iOweThem} />
                          </>
                        )}
                      </span>
                    </span>
                    <span className="text-right">
                      <span className={cn("block text-[11px] font-medium", r.net === 0 ? "text-muted-foreground" : theyOwe ? "text-emerald-700" : "text-amber-700")}>
                        {r.net === 0 ? "Square" : theyOwe ? "They owe you" : "You owe them"}
                      </span>
                      <Money value={Math.abs(r.net)} className="font-semibold" />
                    </span>
                    <ChevronRight className="size-4 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Ageing */}
      {(o.openLent > 0 || o.openBorrowed > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="mb-3 font-semibold">Short-term out, by age</h2>
            <AgeingBars buckets={o.ageingLent} tone="lent" />
          </section>
          <section className="rounded-2xl border bg-card p-4">
            <h2 className="mb-3 font-semibold">Borrowed, by age</h2>
            <AgeingBars buckets={o.ageingBorrowed} tone="borrowed" />
          </section>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, href }: { label: string; value: number; href?: string }) {
  const body = (
    <>
      <span className="text-muted-foreground">{label}</span>
      <Money value={value} className="font-medium" />
    </>
  );
  return href ? (
    <Link href={href} className="flex justify-between gap-3 rounded-md hover:underline">
      {body}
    </Link>
  ) : (
    <div className="flex justify-between gap-3">{body}</div>
  );
}
