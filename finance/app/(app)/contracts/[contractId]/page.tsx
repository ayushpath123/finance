import { CircleAlert, HandCoins } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CollectionCalendar } from "@/components/contracts/collection-calendar";
import { Money, Stat } from "@/components/finance/money";
import { StatusPill } from "@/components/finance/status";
import { PaymentList } from "@/components/payments/payment-list";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTimeIST, formatDay, PAYMENT_METHOD_LABEL } from "@/lib/format";
import { getContractDetail } from "@/lib/services/read-models";
import { ensureReconciled } from "@/lib/services/reconciliation";

export const metadata: Metadata = { title: "Contract" };

export default async function ContractPage({ params }: PageProps<"/contracts/[contractId]">) {
  await requireAdmin();
  await ensureReconciled();
  const data = await getContractDetail((await params).contractId);
  if (!data) notFound();
  const { contract, label, agg, days, payments, bn } = data;
  const person = contract.person;
  const pct = agg.daysValid ? Math.round((agg.daysSatisfied / agg.daysValid) * 100) : 0;
  const canRecord = contract.status !== "COMPLETED";
  const recordHref = `/collect?person=${person.slug}&contract=${contract.id}`;
  const disbursement = contract.disbursements[0];

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: `/people/${person.slug}`, label: person.fullName }}
        title={
          <span className="flex items-center gap-2">
            Contract {label} <StatusPill status={contract.status} />
          </span>
        }
        subtitle={`${formatDay(agg.firstCollectionDate)} → ${formatDay(agg.finalCollectionDate)}`}
      />

      {canRecord && (
        <Button asChild className="h-14 w-full rounded-xl text-base sm:w-auto sm:px-6">
          <Link href={recordHref}>
            <HandCoins aria-hidden /> Record Payment
          </Link>
        </Button>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-5">
          <section aria-label="Contract summary" className="space-y-2">
            <div className="rounded-2xl bg-primary p-5 text-primary-foreground">
              <p className="text-xs font-medium tracking-wider uppercase opacity-80">Outstanding</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight">
                <Money value={agg.outstanding} />
              </p>
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs opacity-80">
                  <span className="tabular-nums">
                    {agg.daysSatisfied} / {agg.daysValid} days
                  </span>
                  <span>{pct}%</span>
                </div>
                <Progress value={pct} className="h-2 bg-primary-foreground/20 [&>*]:bg-primary-foreground" aria-label={`${pct}% collected`} />
              </div>
            </div>
            {agg.overdue > 0 && (
              <p className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700 dark:bg-red-950 dark:text-red-300">
                <CircleAlert className="size-4" aria-hidden />
                {agg.overdueDays} missed day{agg.overdueDays === 1 ? "" : "s"} · <Money value={agg.overdue} /> overdue
              </p>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat label="Principal given" value={agg.disbursed} />
              <Stat label="Contracted collection" value={agg.contractedCollection} />
              <Stat label="Collected" value={agg.collected} tone="success" />
              <Stat label="Daily collection" value={agg.dailyAmount} hint={`${agg.totalDays} days`} />
              <Stat label="Contractual margin" value={agg.contractedCollection - agg.principal} tone="muted" />
              <Stat label="Prepaid" value={agg.prepaid} tone={agg.prepaid ? "info" : "muted"} />
              {agg.credit > 0 && <Stat label="Unallocated credit" value={agg.credit} tone="info" />}
              {agg.cancelledObligation > 0 && <Stat label="Cancelled obligation" value={agg.cancelledObligation} tone="muted" />}
            </div>
          </section>

          <section id="calendar" aria-labelledby="cal-h" className="scroll-mt-20 space-y-2 rounded-2xl border bg-card p-3 sm:p-4">
            <h2 id="cal-h" className="text-lg font-semibold">
              Collection calendar
            </h2>
            <CollectionCalendar days={days} today={bn.today} recordHref={recordHref} canRecord={canRecord} />
          </section>
        </div>

        <div className="space-y-5">
          <section aria-labelledby="pay-h" className="space-y-2">
            <h2 id="pay-h" className="text-lg font-semibold">
              Payments <span className="text-muted-foreground">({payments.length})</span>
            </h2>
            <PaymentList payments={payments} showContract={false} />
          </section>

          <section className="space-y-1.5 rounded-xl border bg-card p-4 text-sm">
            <h2 className="mb-1 font-semibold">Agreement</h2>
            <Row label="Start date">{formatDay(agg.startDate)}</Row>
            <Row label="First collection">{formatDay(agg.firstCollectionDate)}</Row>
            <Row label="Final collection">{formatDay(agg.finalCollectionDate)}</Row>
            {disbursement && (
              <Row label="Principal paid out">
                <Money value={disbursement.amount} /> · {PAYMENT_METHOD_LABEL[disbursement.method]}
                {disbursement.status === "REVERSED" && <span className="ml-1 text-red-600">(reversed)</span>}
              </Row>
            )}
            <Row label="Created">{formatDateTimeIST(contract.createdAt)} by {contract.createdBy.mobileNumber}</Row>
            {contract.statusReason && <Row label="Status note">{contract.statusReason}</Row>}
            {contract.notes && <p className="pt-1 whitespace-pre-line text-muted-foreground">{contract.notes}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{children}</span>
    </div>
  );
}
