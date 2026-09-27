import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Money } from "@/components/finance/money";
import { PageHeader } from "@/components/shell/page-header";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTimeIST, formatDayShort } from "@/lib/format";
import { findPerson, getPersonDashboard, getPersonLedger } from "@/lib/services/read-models";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Statement" };

const TYPE_LABEL: Record<string, string> = {
  DISBURSEMENT: "Principal given",
  DISBURSEMENT_REVERSAL: "Disbursement reversed",
  COLLECTION: "Payment received",
  COLLECTION_REVERSAL: "Payment reversed",
  SCHEDULE_MISSED: "Missed collection",
};

/** Chronological ledger for one person — every movement, straight from the append-only ledger. */
export default async function StatementPage({ params }: PageProps<"/people/[personId]/statement">) {
  await requireAdmin();
  const person = await findPerson((await params).personId);
  if (!person) notFound();
  const [entries, dash] = await Promise.all([getPersonLedger(person.id), getPersonDashboard(person.id)]);
  const t = dash!.totals;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <PageHeader back={{ href: `/people/${person.slug}`, label: person.fullName }} title="Statement" subtitle={`${person.fullName} · ${person.phoneNumber}`} />
      <dl className="grid grid-cols-2 gap-2 rounded-2xl border bg-card p-4 text-sm sm:grid-cols-4">
        {[
          ["Principal given", t.principalGiven],
          ["Collected", t.collected],
          ["Outstanding", t.outstanding],
          ["Missed", t.missed],
        ].map(([l, v]) => (
          <div key={l as string}>
            <dt className="text-xs text-muted-foreground">{l}</dt>
            <dd className="font-semibold"><Money value={v as number} /></dd>
          </div>
        ))}
      </dl>
      <ul className="divide-y rounded-2xl border bg-card text-sm">
        {entries.map((e) => (
          <li key={e.id} className="flex items-start justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="font-medium">
                {formatDayShort(e.date)} · {TYPE_LABEL[e.type]} <span className="text-muted-foreground">· {e.contractLabel}</span>
              </p>
              <p className="text-xs text-muted-foreground">{e.description}</p>
            </div>
            <div className="text-right">
              {e.type === "SCHEDULE_MISSED" ? (
                <span className="text-red-600">
                  <Money value={e.memoAmount ?? 0} /> due
                </span>
              ) : (
                <Money value={e.amount} signed className={cn("font-semibold", e.amount > 0 ? "text-emerald-700" : "")} />
              )}
            </div>
          </li>
        ))}
        {entries.length === 0 && <li className="p-6 text-center text-muted-foreground">No entries yet.</li>}
      </ul>
      <p className="text-xs text-muted-foreground">Generated {formatDateTimeIST(new Date())} IST. Negative = money given out; positive = money received.</p>
    </div>
  );
}
