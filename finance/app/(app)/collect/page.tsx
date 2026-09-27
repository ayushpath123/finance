import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { recordPaymentAction } from "@/app/actions/payments";
import { Money } from "@/components/finance/money";
import { PeopleSearch } from "@/components/people/people-search";
import { PaymentForm, type PayableContract } from "@/components/payments/payment-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireAdmin } from "@/lib/auth/dal";
import { getPeopleDirectory, getPersonDashboard } from "@/lib/services/read-models";
import { ensureReconciled } from "@/lib/services/reconciliation";
import { getSettings } from "@/lib/services/settings";

export const metadata: Metadata = { title: "Record Payment" };

export default async function CollectPage({ searchParams }: PageProps<"/collect">) {
  await requireAdmin();
  const sp = await searchParams;
  const personKey = typeof sp.person === "string" ? sp.person : undefined;
  await ensureReconciled();

  if (personKey) {
    const [data, settings] = await Promise.all([getPersonDashboard(personKey), getSettings()]);
    if (!data) notFound();
    const payable: PayableContract[] = data.contracts
      .filter((c) => c.status !== "COMPLETED" && (c.status !== "CANCELLED" || c.outstanding > 0))
      .map((c) => ({
        id: c.contractId,
        label: c.label,
        status: c.status,
        daily: c.dailyAmount,
        outstanding: c.outstanding,
        overdue: c.overdue,
        todayRemaining: c.todayExpected - c.todayAllocated,
      }));
    return (
      <div className="mx-auto max-w-lg">
        <PageHeader back={{ href: `/people/${data.person.slug}`, label: data.person.fullName }} title="Record Payment" />
        {payable.length === 0 ? (
          <div className="rounded-2xl border border-dashed p-6 text-center">
            <p className="font-medium">No open contracts</p>
            <p className="text-sm text-muted-foreground">{data.person.fullName} has nothing outstanding.</p>
            <Link href={`/people/${data.person.slug}/contracts/new`} className="mt-3 inline-flex h-11 items-center text-sm font-medium text-primary">
              Add a contract
            </Link>
          </div>
        ) : (
          <PaymentForm
            person={{ slug: data.person.slug, fullName: data.person.fullName, phoneNumber: data.person.phoneNumber }}
            contracts={payable}
            initialContractId={typeof sp.contract === "string" ? sp.contract : undefined}
            today={data.bn.today}
            defaultMethod={settings.defaultPaymentMethod}
            action={recordPaymentAction}
          />
        )}
      </div>
    );
  }

  // Step 1: pick who is paying. People due today are listed first.
  const q = typeof sp.q === "string" ? sp.q : "";
  const { items } = await getPeopleDirectory({ q });
  const payers = items
    .filter((p) => p.totals.outstanding > 0)
    .sort((a, b) => Number(b.totals.todayRemaining > 0) - Number(a.totals.todayRemaining > 0) || b.totals.missed - a.totals.missed);

  return (
    <div className="mx-auto max-w-lg space-y-4">
      <PageHeader title="Collect" subtitle="Who is paying?" />
      <PeopleSearch />
      <ul className="divide-y rounded-2xl border bg-card">
        {payers.map((p) => (
          <li key={p.id}>
            <Link href={`/collect?person=${p.slug}`} className="flex min-h-16 items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 active:bg-muted/60">
              <span className="min-w-0">
                <span className="block truncate font-medium">{p.fullName}</span>
                <span className="font-mono text-xs text-muted-foreground">{p.phoneNumber}</span>
              </span>
              <span className="text-right text-sm">
                {p.totals.todayRemaining > 0 ? (
                  <>
                    <span className="block text-xs text-muted-foreground">Due today</span>
                    <Money value={p.totals.todayRemaining} className="font-semibold" />
                  </>
                ) : p.paidToday ? (
                  <span className="text-xs font-medium text-emerald-700">✓ Paid today</span>
                ) : (
                  <Money value={p.totals.outstanding} className="text-muted-foreground" />
                )}
                {p.totals.missed > 0 && <span className="block text-xs text-red-600">{p.totals.missedDays} missed</span>}
              </span>
            </Link>
          </li>
        ))}
        {payers.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">No one with an outstanding balance{q ? " matches" : ""}.</li>}
      </ul>
    </div>
  );
}
