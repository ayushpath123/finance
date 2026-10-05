import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Money } from "@/components/finance/money";
import { cn } from "@/lib/utils";
import { formatDay } from "@/lib/format";
import type { ShortTermLoanItem } from "@/lib/services/short-term-read";
import { WORDS } from "@/lib/short-term-words";

const STATUS: Record<string, string> = {
  OPEN: "bg-amber-50 text-amber-800 ring-amber-600/20 dark:bg-amber-950 dark:text-amber-200",
  CLOSED: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300",
  CANCELLED: "bg-muted text-muted-foreground ring-border",
};

export function ShortTermStatus({ status }: { status: string }) {
  return <span className={cn("inline-flex rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset", STATUS[status])}>{status}</span>;
}

/** Whole card is the tap target. */
export function ShortTermCard({ loan }: { loan: ShortTermLoanItem }) {
  const open = loan.status === "OPEN";
  const w = WORDS[loan.direction];
  return (
    <Link
      href={`/short-term/${loan.id}`}
      className="block rounded-2xl border bg-card p-4 shadow-xs outline-none hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50 active:bg-muted/60"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-2 font-semibold">
          {w.title} {loan.label} <ShortTermStatus status={loan.status} />
        </span>
        <ChevronRight className="size-5 text-muted-foreground" aria-hidden />
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        <dt className="text-muted-foreground">{w.principal}</dt>
        <dd className="text-right"><Money value={loan.principal} /></dd>
        <dt className="text-muted-foreground">Interest</dt>
        <dd className="text-right"><Money value={loan.interest} /></dd>
        <dt className="text-muted-foreground">{w.backTotal}</dt>
        <dd className="text-right"><Money value={loan.received} /></dd>
        {open ? (
          <>
            <dt className="text-muted-foreground">{w.outstanding}</dt>
            <dd className="text-right font-semibold"><Money value={loan.outstanding} /></dd>
          </>
        ) : loan.waived > 0 ? (
          <>
            <dt className="text-muted-foreground">{w.waived}</dt>
            <dd className="text-right"><Money value={loan.waived} /></dd>
          </>
        ) : null}
      </dl>
      <p className="mt-3 text-xs text-muted-foreground">
        {loan.direction === "BORROWED" ? "Borrowed" : "Given"} {formatDay(loan.givenOn)}
        {loan.status === "CLOSED" && loan.closedOn ? ` · closed ${formatDay(loan.closedOn)}` : ""} · {loan.days} day{loan.days === 1 ? "" : "s"}
        {open ? " so far" : ""}
      </p>
    </Link>
  );
}
