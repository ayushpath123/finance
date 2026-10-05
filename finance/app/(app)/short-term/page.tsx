import type { Metadata } from "next";
import Link from "next/link";
import { Money } from "@/components/finance/money";
import { PageHeader } from "@/components/shell/page-header";
import { ShortTermStatus } from "@/components/short-term/short-term-card";
import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/client";
import { formatDayShort } from "@/lib/format";
import { shortTermLoans, shortTermTotalsOf } from "@/lib/services/short-term-read";
import { businessNow, getSettings } from "@/lib/services/settings";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Short-term loans" };

export default async function ShortTermListPage({ searchParams }: PageProps<"/short-term">) {
  await requireAdmin();
  const sp = await searchParams;
  const show = sp.show === "closed" ? "CLOSED" : "OPEN";
  const direction = sp.type === "borrowed" ? "BORROWED" : "LENT";
  const borrowedView = direction === "BORROWED";
  const bn = businessNow(await getSettings());
  const [loans, openLoans] = await Promise.all([shortTermLoans({ status: show, direction }, bn), shortTermLoans({ status: "OPEN" }, bn)]);
  const lentTotals = shortTermTotalsOf(openLoans);
  const borrowedTotals = shortTermTotalsOf(openLoans, "BORROWED");
  const totals = borrowedView ? borrowedTotals : lentTotals;
  const href = (o: { type?: string; show?: string }) => {
    const q = new URLSearchParams();
    const type = o.type ?? (borrowedView ? "borrowed" : undefined);
    const st = o.show ?? (show === "CLOSED" ? "closed" : undefined);
    if (type) q.set("type", type);
    if (st) q.set("show", st);
    return `/short-term${q.size ? `?${q}` : ""}`;
  };
  const people = await prisma.person.findMany({ where: { id: { in: loans.map((l) => l.personId) } }, select: { id: true, fullName: true } });
  const nameOf = new Map(people.map((p) => [p.id, p.fullName]));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader title="Short-term" subtitle="Lump sums with a fixed interest amount, no time limit" />
      <div role="tablist" aria-label="Direction" className="grid grid-cols-2 gap-2">
        {([
          ["LENT", "I lent", "They owe me", lentTotals, undefined],
          ["BORROWED", "I borrowed", "I owe", borrowedTotals, "borrowed"],
        ] as const).map(([d, label, sub, t, type]) => (
          <Link
            key={d}
            role="tab"
            aria-selected={direction === d}
            href={href({ type: type ?? "", show: show === "CLOSED" ? "closed" : "" })}
            className={cn("rounded-xl border p-3", direction === d ? "border-primary bg-card ring-1 ring-primary" : "bg-card/60 text-muted-foreground")}
          >
            <p className="text-xs">{label} · {t.open} open</p>
            <p className={cn("mt-0.5 text-lg font-semibold", direction === d && "text-foreground")}><Money value={t.outstanding} /></p>
            <p className="text-xs">{sub}</p>
          </Link>
        ))}
      </div>
      <div role="tablist" aria-label="Status" className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm font-medium">
        {(["OPEN", "CLOSED"] as const).map((s) => (
          <Link
            key={s}
            role="tab"
            aria-selected={show === s}
            href={href({ show: s === "OPEN" ? "" : "closed" })}
            className={cn("flex h-10 items-center justify-center rounded-lg", show === s ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {s === "OPEN" ? "Open" : "Closed"}
          </Link>
        ))}
      </div>
      {loans.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {show === "OPEN"
            ? borrowedView
              ? "You don't owe anyone. Record a borrowing from the lender's page."
              : "No open short-term loans. Give one from a person's page."
            : `Nothing closed yet.`}
        </p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {loans.map((l) => (
            <li key={l.id}>
              <Link href={`/short-term/${l.id}`} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{nameOf.get(l.personId)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {l.label} · {l.direction === "BORROWED" ? "borrowed" : "given"} {formatDayShort(l.givenOn)} · {l.days}d
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
