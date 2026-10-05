import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Money, Stat } from "@/components/finance/money";
import { AgeingBars } from "@/components/settlement/ageing-bars";
import { PageHeader } from "@/components/shell/page-header";
import { ShortTermStatus } from "@/components/short-term/short-term-card";
import { formatDayShort, formatMonth } from "@/lib/format";
import { getShortTermBook } from "@/lib/services/settlement-read";
import { businessNow, getSettings } from "@/lib/services/settings";
import { cn } from "@/lib/utils";

const COPY = {
  LENT: {
    title: "Lending",
    subtitle: "Short-term money you gave — principal + fixed interest, no time limit",
    hero: "They owe you",
    interest: "Interest to earn",
    principal: "Principal out",
    empty: "No open short-term loans. Give one from a person's page.",
    monthOut: "Given this month",
    monthIn: "Received back this month",
    since: "given",
    base: "/lending",
    heroClass: "bg-emerald-700 text-white dark:bg-emerald-800",
  },
  BORROWED: {
    title: "Borrowing",
    subtitle: "Money you borrowed — principal + fixed interest, no time limit",
    hero: "You owe",
    interest: "Interest to pay",
    principal: "Principal owed",
    empty: "You don't owe anyone. Record a borrowing from the lender's page (⋮ → I Borrowed Money).",
    monthOut: "Paid back this month",
    monthIn: "Borrowed this month",
    since: "borrowed",
    base: "/borrowing",
    heroClass: "bg-amber-600 text-white dark:bg-amber-700",
  },
} as const;

/** Lending and Borrowing pages share this layout; only the direction and wording differ. */
export async function BookPage({ direction, show }: { direction: "LENT" | "BORROWED"; show: "OPEN" | "CLOSED" }) {
  const c = COPY[direction];
  const bn = businessNow(await getSettings());
  const book = await getShortTermBook(direction, show, bn);
  const t = book.totals;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title={c.title} subtitle={c.subtitle} back={{ href: "/settlements", label: "Settlements" }} />

      <section className={cn("rounded-2xl p-5", c.heroClass)}>
        <p className="text-xs font-medium tracking-wider uppercase opacity-90">{c.hero}</p>
        <p className="mt-1 text-4xl font-semibold tracking-tight">
          <Money value={t.outstanding} />
        </p>
        <p className="mt-1 text-sm opacity-90">
          {t.open} open · {t.people} {t.people === 1 ? "person" : "people"}
          {t.open > 0 ? ` · oldest ${t.oldestDays} day${t.oldestDays === 1 ? "" : "s"}` : ""}
        </p>
      </section>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat label={c.principal} value={t.principalOutstanding} />
        <Stat label={c.interest} value={t.interestOutstanding} tone={direction === "LENT" ? "success" : "danger"} />
        <Stat label={c.monthOut} value={book.month.out} hint={formatMonth(book.monthFrom.slice(0, 7))} />
        <Stat label={c.monthIn} value={book.month.in} hint={formatMonth(book.monthFrom.slice(0, 7))} />
      </div>

      {t.open > 0 && (
        <section aria-labelledby="age-h" className="rounded-2xl border bg-card p-4">
          <h2 id="age-h" className="mb-3 font-semibold">
            How long it&apos;s been {direction === "LENT" ? "out" : "owed"}
          </h2>
          <AgeingBars buckets={book.ageing} tone={direction === "LENT" ? "lent" : "borrowed"} />
        </section>
      )}

      <div role="tablist" aria-label="Status" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm font-medium">
        {(["OPEN", "CLOSED"] as const).map((s) => (
          <Link
            key={s}
            role="tab"
            aria-selected={show === s}
            href={s === "OPEN" ? c.base : `${c.base}?show=closed`}
            className={cn("flex h-10 items-center justify-center rounded-lg", show === s ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {s === "OPEN" ? "Open" : "Closed"}
          </Link>
        ))}
      </div>

      {book.rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">{show === "OPEN" ? c.empty : "Nothing closed yet."}</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {book.rows.map((l) => (
            <li key={l.id}>
              <Link href={`/short-term/${l.id}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/40">
                <span
                  aria-hidden
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full",
                    direction === "LENT" ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950" : "bg-amber-50 text-amber-700 dark:bg-amber-950",
                  )}
                >
                  {direction === "LENT" ? <ArrowUpRight className="size-4" /> : <ArrowDownLeft className="size-4" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{l.personName}</span>
                  <span className="block text-xs text-muted-foreground">
                    {l.label} · {c.since} {formatDayShort(l.givenOn)} · {l.days}d · <Money value={l.principal} /> + <Money value={l.interest} />
                  </span>
                </span>
                <span className="text-right">
                  <Money value={show === "OPEN" ? l.outstanding : l.received} className="font-semibold" />
                  <span className="block">
                    <ShortTermStatus status={l.status} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
