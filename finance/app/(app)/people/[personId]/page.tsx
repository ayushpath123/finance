import { CalendarDays, HandCoins, Plus, Wallet } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ContractCard } from "@/components/contracts/contract-card";
import { Money, Stat } from "@/components/finance/money";
import { StatusPill } from "@/components/finance/status";
import { PaymentList } from "@/components/payments/payment-list";
import { ActivityTimeline } from "@/components/people/activity-timeline";
import { PersonMenu } from "@/components/people/person-menu";
import { PageHeader } from "@/components/shell/page-header";
import { ShortTermCard } from "@/components/short-term/short-term-card";
import { Button } from "@/components/ui/button";
import { requireAdmin } from "@/lib/auth/dal";
import { findPerson, getPersonDashboard } from "@/lib/services/read-models";
import { ensureReconciled } from "@/lib/services/reconciliation";

export async function generateMetadata({ params }: PageProps<"/people/[personId]">): Promise<Metadata> {
  const person = await findPerson((await params).personId);
  return { title: person?.fullName ?? "Person" };
}

export default async function PersonPage({ params, searchParams }: PageProps<"/people/[personId]">) {
  await requireAdmin();
  const { personId } = await params;
  const showAllActivity = (await searchParams).activity === "all";
  await ensureReconciled();
  const data = await getPersonDashboard(personId);
  if (!data) notFound();
  const { person, totals: t, contracts, payments, activity, bn, shortTerm: st, shortTermLoans, borrowings, borrowed, totalOutstanding } = data;
  const live = contracts.filter((c) => c.status === "ACTIVE" || c.status === "DEFAULTED");
  const calendarHref = live.length === 1 ? `/contracts/${live[0].contractId}#calendar` : contracts.length === 1 ? `/contracts/${contracts[0].contractId}#calendar` : "#contracts";

  return (
    <div className="space-y-5">
      <PageHeader
        back={{ href: "/people", label: "People" }}
        title={person.fullName}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <a href={`tel:${person.phoneNumber}`} className="font-mono underline-offset-2 hover:underline">
              {person.phoneNumber}
            </a>
            {person.status !== "ACTIVE" && <StatusPill status={person.status} />}
          </span>
        }
        actions={<PersonMenu slug={person.slug} />}
      />

      {/* Quick actions — the things done most */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Button asChild className="h-14 flex-col gap-0.5 rounded-xl text-xs sm:h-12 sm:flex-row sm:gap-1.5 sm:text-sm">
          <Link href={`/collect?person=${person.slug}`}>
            <HandCoins className="size-5" aria-hidden /> Record Payment
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-14 flex-col gap-0.5 rounded-xl text-xs sm:h-12 sm:flex-row sm:gap-1.5 sm:text-sm">
          <Link href={`/people/${person.slug}/contracts/new`}>
            <Plus className="size-5" aria-hidden /> Add Contract
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-14 flex-col gap-0.5 rounded-xl text-xs sm:h-12 sm:flex-row sm:gap-1.5 sm:text-sm">
          <Link href={`/people/${person.slug}/short-term/new`}>
            <Wallet className="size-5" aria-hidden /> Short-term Loan
          </Link>
        </Button>
        <Button asChild variant="outline" className="h-14 flex-col gap-0.5 rounded-xl text-xs sm:h-12 sm:flex-row sm:gap-1.5 sm:text-sm">
          <Link href={calendarHref}>
            <CalendarDays className="size-5" aria-hidden /> View Calendar
          </Link>
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-5">
          {/* Financial position */}
          <section aria-label="Financial summary" className="space-y-2">
            <div className="rounded-2xl bg-primary p-5 text-primary-foreground">
              <p className="text-xs font-medium tracking-wider uppercase opacity-80">Total Outstanding</p>
              <p className="mt-1 text-4xl font-semibold tracking-tight">
                <Money value={totalOutstanding} />
              </p>
              <p className="mt-1 text-sm opacity-80">
                {st.open > 0 ? (
                  <>
                    <Money value={t.outstanding} /> on {t.activeContracts} contract{t.activeContracts === 1 ? "" : "s"} · <Money value={st.outstanding} /> short-term
                  </>
                ) : (
                  <>across {t.activeContracts} active contract{t.activeContracts === 1 ? "" : "s"}</>
                )}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Stat
                label="Today's due"
                value={t.todayExpected}
                hint={t.todayExpected > 0 ? t.todayRemaining > 0 ? <><Money value={t.todayRemaining} /> pending</> : "✓ paid" : undefined}
              />
              <Stat label="Missed" value={t.missed} tone={t.missed > 0 ? "danger" : undefined} hint={t.missedDays ? `${t.missedDays} day${t.missedDays === 1 ? "" : "s"}` : undefined} />
              <Stat label="Total collected" value={t.collected} tone="success" />
              <Stat label="Principal given" value={t.principalGiven} />
              <Stat label="Total contracted" value={t.contracted} />
              <Stat label="Prepaid" value={t.prepaid} tone={t.prepaid > 0 ? "info" : "muted"} />
              {t.credit > 0 && <Stat label="Unallocated credit" value={t.credit} tone="info" />}
              {st.open > 0 && <Stat label="Short-term out" value={st.outstanding} hint={`${st.open} open loan${st.open === 1 ? "" : "s"}`} />}
            </div>
            {borrowed.open > 0 && (
              <Link
                href="#borrowed"
                className="flex items-center justify-between rounded-2xl border border-amber-300 bg-amber-50 p-4 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-100"
              >
                <span>
                  <span className="block text-xs font-medium tracking-wider uppercase">You owe {person.fullName.split(" ")[0]}</span>
                  <span className="text-sm opacity-80">
                    {borrowed.open} borrowing{borrowed.open === 1 ? "" : "s"} · not included above
                  </span>
                </span>
                <Money value={borrowed.outstanding} className="text-2xl font-semibold" />
              </Link>
            )}

          </section>

          {shortTermLoans.length > 0 && (
            <section id="short-term" aria-labelledby="st-h" className="scroll-mt-20 space-y-2">
              <div className="flex items-center justify-between">
                <h2 id="st-h" className="text-lg font-semibold">
                  Short-term loans {shortTermLoans.length > 1 && <span className="text-muted-foreground">({shortTermLoans.length})</span>}
                </h2>
                <Link href={`/people/${person.slug}/short-term/new`} className="inline-flex h-10 items-center gap-1 text-sm font-medium text-primary">
                  <Plus className="size-4" aria-hidden /> Give
                </Link>
              </div>
              <ul className="grid gap-3 xl:grid-cols-2">
                {shortTermLoans.map((l) => (
                  <li key={l.id}>
                    <ShortTermCard loan={l} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {borrowings.length > 0 && (
            <section id="borrowed" aria-labelledby="br-h" className="scroll-mt-20 space-y-2">
              <div className="flex items-center justify-between">
                <h2 id="br-h" className="text-lg font-semibold">
                  Money I borrowed {borrowings.length > 1 && <span className="text-muted-foreground">({borrowings.length})</span>}
                </h2>
                <Link href={`/people/${person.slug}/borrowed/new`} className="inline-flex h-10 items-center gap-1 text-sm font-medium text-primary">
                  <Plus className="size-4" aria-hidden /> Add
                </Link>
              </div>
              <ul className="grid gap-3 xl:grid-cols-2">
                {borrowings.map((l) => (
                  <li key={l.id}>
                    <ShortTermCard loan={l} />
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section id="contracts" aria-labelledby="contracts-h" className="scroll-mt-20 space-y-2">
            <div className="flex items-center justify-between">
              <h2 id="contracts-h" className="text-lg font-semibold">
                Contracts {contracts.length > 1 && <span className="text-muted-foreground">({contracts.length})</span>}
              </h2>
              <Link href={`/people/${person.slug}/contracts/new`} className="inline-flex h-10 items-center gap-1 text-sm font-medium text-primary">
                <Plus className="size-4" aria-hidden /> Add
              </Link>
            </div>
            {contracts.length === 0 ? (
              <div className="rounded-2xl border border-dashed p-6 text-center">
                <p className="font-medium">No contracts yet</p>
                <Button asChild className="mt-3 h-11 rounded-xl">
                  <Link href={`/people/${person.slug}/contracts/new`}>
                    <Plus aria-hidden /> Add first contract
                  </Link>
                </Button>
              </div>
            ) : (
              <ul className="grid gap-3 xl:grid-cols-2">
                {contracts.map((c) => (
                  <li key={c.contractId}>
                    <ContractCard c={c} today={bn.today} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-5">
          <section aria-labelledby="payments-h" className="space-y-2">
            <div className="flex items-center justify-between">
              <h2 id="payments-h" className="text-lg font-semibold">
                Payment history
              </h2>
              <Link href={`/activity?person=${person.slug}`} className="inline-flex h-10 items-center text-sm font-medium text-primary">
                View all
              </Link>
            </div>
            <PaymentList payments={payments} showContract={contracts.length > 1} />
          </section>

          <section id="activity" aria-labelledby="activity-h" className="scroll-mt-20 space-y-3">
            <h2 id="activity-h" className="text-lg font-semibold">
              Activity
            </h2>
            <ActivityTimeline items={showAllActivity ? activity : activity.slice(0, 10)} />
            {!showAllActivity && activity.length > 10 && (
              <Link href={`/people/${person.slug}?activity=all#activity`} className="inline-flex h-10 items-center text-sm font-medium text-primary">
                Show all activity
              </Link>
            )}
          </section>

          {(person.address || person.notes || person.alternatePhone) && (
            <section className="space-y-1 rounded-xl border bg-card p-4 text-sm">
              {person.alternatePhone && (
                <p>
                  <span className="text-muted-foreground">Alternate: </span>
                  <a href={`tel:${person.alternatePhone}`} className="font-mono">{person.alternatePhone}</a>
                </p>
              )}
              {person.address && <p className="text-muted-foreground">{person.address}</p>}
              {person.notes && <p className="whitespace-pre-line">{person.notes}</p>}
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
