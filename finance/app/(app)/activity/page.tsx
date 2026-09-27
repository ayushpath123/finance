import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Money } from "@/components/finance/money";
import { PageHeader } from "@/components/shell/page-header";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDayShort, formatTimeIST, PAYMENT_METHOD_LABEL } from "@/lib/format";
import { findPerson, getRecentTransactions } from "@/lib/services/read-models";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Activity" };

export default async function ActivityPage({ searchParams }: PageProps<"/activity">) {
  await requireAdmin();
  const sp = await searchParams;
  const person = typeof sp.person === "string" ? await findPerson(sp.person) : null;
  const items = await getRecentTransactions({ personId: person?.id, take: 100 });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader
        back={person ? { href: `/people/${person.slug}`, label: person.fullName } : undefined}
        title={person ? "Transactions" : "Activity"}
        subtitle={person ? person.fullName : "Recent money in and out"}
      />
      {items.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">No transactions yet.</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {items.map((t) => {
            const inflow = t.kind === "PAYMENT";
            const reversed = t.status === "REVERSED";
            const date = t.kind === "PAYMENT" ? t.paymentDate : t.date;
            return (
              <li key={`${t.kind}-${t.id}`}>
                <Link href={`/contracts/${t.contractId}`} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted/40">
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-full",
                      inflow ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950" : "bg-muted text-foreground",
                    )}
                    aria-hidden
                  >
                    {inflow ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {inflow ? "Payment" : "Principal given"} · {t.person.fullName}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {formatDayShort(date)} · {t.contractLabel} · {PAYMENT_METHOD_LABEL[t.method]}
                      {t.referenceNumber ? ` · ${t.referenceNumber}` : ""} · {formatTimeIST(t.recordedAt)} by {t.createdBy}
                      {t.kind === "PAYMENT" && t.correctsPaymentId ? " · correction" : ""}
                    </span>
                  </span>
                  <span className="text-right">
                    <Money
                      value={inflow ? t.amount : -t.amount}
                      signed
                      className={cn("font-semibold", inflow && "text-emerald-700", reversed && "text-muted-foreground line-through")}
                    />
                    {reversed && <span className="block text-[11px] font-medium text-red-600">REVERSED</span>}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
