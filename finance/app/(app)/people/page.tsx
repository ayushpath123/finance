import { CircleAlert, Plus, UserRoundSearch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Money } from "@/components/finance/money";
import { StatusPill } from "@/components/finance/status";
import { PeopleSearch } from "@/components/people/people-search";
import { PersonCard } from "@/components/people/person-card";
import { PageHeader } from "@/components/shell/page-header";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDayShort } from "@/lib/format";
import { getPeopleDirectory } from "@/lib/services/read-models";
import { ensureReconciled } from "@/lib/services/reconciliation";

export const metadata: Metadata = { title: "People" };

export default async function PeoplePage({ searchParams }: PageProps<"/people">) {
  await requireAdmin();
  const { q } = await searchParams;
  const query = typeof q === "string" ? q : "";
  await ensureReconciled();
  const { items, activeCount } = await getPeopleDirectory({ q: query });

  return (
    <div className="space-y-4">
      <PageHeader
        title="People"
        actions={
          <Button asChild className="h-11 rounded-xl px-4">
            <Link href="/people/new">
              <Plus aria-hidden /> Add Person
            </Link>
          </Button>
        }
      />
      <PeopleSearch />
      <p className="text-sm text-muted-foreground">
        {query ? `${items.length} result${items.length === 1 ? "" : "s"} for “${query}”` : `${activeCount} active ${activeCount === 1 ? "person" : "people"}`}
      </p>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center">
          <UserRoundSearch className="mx-auto size-8 text-muted-foreground" aria-hidden />
          <p className="mt-2 font-medium">{query ? "No one matches that search" : "No people yet"}</p>
          <p className="text-sm text-muted-foreground">{query ? "Try a name, mobile number or contract number." : "Add your first person to create a contract."}</p>
        </div>
      ) : (
        <>
          {/* Phones & tablets: large tappable cards */}
          <ul className="grid gap-3 sm:grid-cols-2 lg:hidden">
            {items.map((p) => (
              <li key={p.id}>
                <PersonCard person={p} />
              </li>
            ))}
          </ul>

          {/* Desktop: table */}
          <div className="hidden rounded-xl border bg-card lg:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead className="text-right">Active</TableHead>
                  <TableHead className="text-right">Principal given</TableHead>
                  <TableHead className="text-right">Contracted</TableHead>
                  <TableHead className="text-right">Collected</TableHead>
                  <TableHead className="text-right">Outstanding</TableHead>
                  <TableHead className="text-right">Missed</TableHead>
                  <TableHead>Last payment</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id} className="relative cursor-pointer">
                    <TableCell className="font-medium">
                      <Link href={`/people/${p.slug}`} className="after:absolute after:inset-0">
                        {p.fullName}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">{p.phoneNumber}</TableCell>
                    <TableCell className="text-right">{p.totals.activeContracts}</TableCell>
                    <TableCell className="text-right"><Money value={p.totals.principalGiven} /></TableCell>
                    <TableCell className="text-right"><Money value={p.totals.contracted} /></TableCell>
                    <TableCell className="text-right"><Money value={p.totals.collected} /></TableCell>
                    <TableCell className="text-right font-semibold"><Money value={p.totals.outstanding} /></TableCell>
                    <TableCell className="text-right">
                      {p.totals.missed > 0 ? (
                        <span className="inline-flex items-center gap-1 text-red-600">
                          <CircleAlert className="size-3.5" aria-hidden />
                          <Money value={p.totals.missed} />
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{p.lastPaymentDate ? formatDayShort(p.lastPaymentDate) : "—"}</TableCell>
                    <TableCell><StatusPill status={p.status} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  );
}
