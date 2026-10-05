import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cancelShortTermLoanAction, reverseShortTermRepaymentAction, shortTermMoneyBackAction } from "@/app/actions/short-term";
import { Money, Stat } from "@/components/finance/money";
import { PageHeader } from "@/components/shell/page-header";
import { MoneyBackForm } from "@/components/short-term/money-back-form";
import { ReasonAction } from "@/components/short-term/reason-action";
import { ShortTermStatus } from "@/components/short-term/short-term-card";
import { Progress } from "@/components/ui/progress";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTimeIST, formatDay, formatDayShort, PAYMENT_METHOD_LABEL } from "@/lib/format";
import { getShortTermDetail } from "@/lib/services/short-term-read";
import { businessNow, getSettings } from "@/lib/services/settings";
import { WORDS } from "@/lib/short-term-words";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Short-term loan" };

export default async function ShortTermLoanPage({ params }: PageProps<"/short-term/[loanId]">) {
  await requireAdmin();
  const settings = await getSettings();
  const bn = businessNow(settings);
  const data = await getShortTermDetail((await params).loanId, bn);
  if (!data) notFound();
  const { item: l, loan, repayments } = data;
  const pct = l.totalDue ? Math.min(100, Math.round((l.received / l.totalDue) * 100)) : 0;
  const activeRepayments = repayments.filter((r) => r.status === "ACTIVE").length;
  const w = WORDS[l.direction];
  const borrowed = l.direction === "BORROWED";

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: `/people/${loan.person.slug}`, label: loan.person.fullName }}
        title={
          <span className="flex items-center gap-2">
            {w.title} {l.label} <ShortTermStatus status={l.status} />
          </span>
        }
        subtitle={`${borrowed ? `Borrowed from ${loan.person.fullName}` : "Given"} ${formatDay(l.givenOn)} · ${l.days} day${l.days === 1 ? "" : "s"}${l.status === "OPEN" ? " so far" : ""}`}
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_24rem]">
        <div className="space-y-5">
          <section aria-label="Summary" className="space-y-2">
            <div className="rounded-2xl bg-primary p-5 text-primary-foreground">
              <p className="text-xs font-medium tracking-wider uppercase opacity-80">{l.status === "OPEN" ? w.outstanding : l.status === "CLOSED" ? "Closed" : "Cancelled"}</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight">
                <Money value={l.status === "OPEN" ? l.outstanding : l.received} />
              </p>
              <p className="text-sm opacity-80">
                {l.status === "OPEN" ? (
                  <>
                    of <Money value={l.totalDue} /> (<Money value={l.principal} /> + <Money value={l.interest} /> interest)
                  </>
                ) : l.status === "CLOSED" ? (
                  <>{borrowed ? "paid back" : "received back"}{l.closedOn ? ` · closed ${formatDay(l.closedOn)}` : ""}</>
                ) : (
                  <>entered by mistake — reversed</>
                )}
              </p>
              {l.status !== "CANCELLED" && <Progress value={pct} className="mt-3 h-2 bg-primary-foreground/20 [&>*]:bg-primary-foreground" aria-label={`${pct}% back`} />}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label={w.principal} value={l.principal} />
              <Stat label="Interest" value={l.interest} />
              <Stat label={w.backTotal} value={l.received} tone="success" />
              {l.waived > 0 ? <Stat label={w.waived} value={l.waived} tone="muted" /> : <Stat label="Total due" value={l.totalDue} />}
            </div>
          </section>

          {l.status === "OPEN" && (
            <section aria-labelledby="back-h" className="space-y-2">
              <h2 id="back-h" className="text-lg font-semibold">
                {w.back}
              </h2>
              <MoneyBackForm
                direction={l.direction}
                loanId={l.id}
                outstanding={l.outstanding}
                today={bn.today}
                givenOn={l.givenOn}
                defaultMethod={settings.defaultPaymentMethod}
                action={shortTermMoneyBackAction}
              />
            </section>
          )}
        </div>

        <div className="space-y-5">
          <section aria-labelledby="rep-h" className="space-y-2">
            <h2 id="rep-h" className="text-lg font-semibold">
              {borrowed ? "Payments made" : "Repayments"} <span className="text-muted-foreground">({repayments.length})</span>
            </h2>
            {repayments.length === 0 ? (
              <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">{w.nothingYet}</p>
            ) : (
              <ul className="divide-y rounded-xl border bg-card">
                {repayments.map((r) => (
                  <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{formatDayShort(r.receivedOn)}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {PAYMENT_METHOD_LABEL[r.method]}
                        {r.referenceNumber ? ` · ${r.referenceNumber}` : ""} · by {r.createdBy}
                        {r.status === "REVERSED" && r.reversalReason ? ` · reversed: ${r.reversalReason}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 text-right">
                      <Money value={r.amount} className={cn("font-semibold", r.status === "REVERSED" && "text-muted-foreground line-through")} />
                      {r.status === "ACTIVE" && l.status !== "CANCELLED" && (
                        <ReasonAction
                          label="Reverse"
                          title={w.reverseTitle}
                          description={`It stays in history, marked reversed.${l.status === "CLOSED" ? " The loan will open again." : ""}`}
                          confirmLabel="Reverse repayment"
                          hidden={{ repaymentId: r.id }}
                          action={reverseShortTermRepaymentAction}
                        />
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="space-y-1.5 rounded-xl border bg-card p-4 text-sm">
            <h2 className="mb-1 font-semibold">Details</h2>
            <Row label={w.via}>{PAYMENT_METHOD_LABEL[loan.method]}{loan.referenceNumber ? ` · ${loan.referenceNumber}` : ""}</Row>
            <Row label="Recorded">{formatDateTimeIST(loan.createdAt)} by {loan.createdBy.mobileNumber}</Row>
            {loan.closedAt && <Row label="Closed">{formatDateTimeIST(loan.closedAt)} by {loan.closedBy?.mobileNumber}</Row>}
            {loan.closeNote && <Row label="Close note">{loan.closeNote}</Row>}
            {loan.cancelledAt && <Row label="Cancelled">{formatDateTimeIST(loan.cancelledAt)} by {loan.cancelledBy?.mobileNumber}</Row>}
            {loan.cancelReason && <Row label="Reason">{loan.cancelReason}</Row>}
            {loan.notes && <p className="pt-1 whitespace-pre-line text-muted-foreground">{loan.notes}</p>}
          </section>

          {l.status === "OPEN" && activeRepayments === 0 && (
            <div className="text-center">
              <ReasonAction
                label={`Cancel this ${borrowed ? "borrowing" : "loan"} (entered by mistake)`}
                title={`Cancel this ${w.noun.toLowerCase()}?`}
                description="Use this only if it was entered by mistake. It stays in history as cancelled and its ledger entry is reversed."
                confirmLabel="Cancel loan"
                hidden={{ loanId: l.id }}
                action={cancelShortTermLoanAction}
              />
            </div>
          )}
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
