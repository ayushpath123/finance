import { cn } from "@/lib/utils";

const CONTRACT: Record<string, string> = {
  ACTIVE: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300",
  COMPLETED: "bg-sky-50 text-sky-700 ring-sky-600/20 dark:bg-sky-950 dark:text-sky-300",
  DEFAULTED: "bg-red-50 text-red-700 ring-red-600/20 dark:bg-red-950 dark:text-red-300",
  CANCELLED: "bg-muted text-muted-foreground ring-border",
  INACTIVE: "bg-muted text-muted-foreground ring-border",
};

export function StatusPill({ status, className }: { status: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tracking-wide ring-1 ring-inset", CONTRACT[status] ?? CONTRACT.INACTIVE, className)}>
      {status}
    </span>
  );
}

/** Collection-day colours: green paid, red missed, amber partial, blue prepaid, gray future, neutral today. */
export const DAY_STYLE: Record<string, { cell: string; dot: string; label: string }> = {
  PAID: { cell: "bg-emerald-50 text-emerald-900 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-emerald-900", dot: "bg-emerald-500", label: "Paid" },
  SETTLED_LATE: { cell: "bg-emerald-50 text-emerald-900 ring-red-300 dark:bg-emerald-950 dark:text-emerald-100 dark:ring-red-900", dot: "bg-emerald-500", label: "Settled late" },
  MISSED: { cell: "bg-red-50 text-red-900 ring-red-200 dark:bg-red-950 dark:text-red-100 dark:ring-red-900", dot: "bg-red-500", label: "Missed" },
  PARTIAL: { cell: "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-900", dot: "bg-amber-500", label: "Partial" },
  PREPAID: { cell: "bg-sky-50 text-sky-900 ring-sky-200 dark:bg-sky-950 dark:text-sky-100 dark:ring-sky-900", dot: "bg-sky-500", label: "Prepaid" },
  FUTURE: { cell: "bg-muted/40 text-muted-foreground ring-border", dot: "bg-muted-foreground/40", label: "Upcoming" },
  TODAY_PENDING: { cell: "bg-background text-foreground ring-foreground/60 ring-2", dot: "bg-foreground", label: "Due today" },
  PENDING: { cell: "bg-background text-foreground ring-border", dot: "bg-muted-foreground", label: "Pending" },
  CANCELLED: { cell: "bg-muted/30 text-muted-foreground/60 ring-border line-through", dot: "bg-muted-foreground/30", label: "Cancelled" },
};
