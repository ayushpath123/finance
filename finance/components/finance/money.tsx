import type { ReactNode } from "react";
import { formatINR, type Paise } from "@/lib/finance/money";
import { cn } from "@/lib/utils";

/** All money renders through here: Indian grouping, tabular digits. */
export function Money({ value, className, signed }: { value: number; className?: string; signed?: boolean }) {
  const text = formatINR(value as Paise);
  return <span className={cn("tabular-nums", className)}>{signed && value > 0 ? `+${text}` : text}</span>;
}

/** Label/value row used in summaries. */
export function Stat({
  label,
  value,
  tone,
  hint,
  className,
}: {
  label: string;
  value: number;
  tone?: "danger" | "success" | "info" | "muted";
  hint?: ReactNode;
  className?: string;
}) {
  const toneClass =
    tone === "danger" ? "text-red-600 dark:text-red-400" : tone === "success" ? "text-emerald-700 dark:text-emerald-400" : tone === "info" ? "text-sky-700 dark:text-sky-400" : tone === "muted" ? "text-muted-foreground" : "";
  return (
    <div className={cn("rounded-xl border bg-card p-3", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 text-lg font-semibold", toneClass)}>
        <Money value={value} />
      </p>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}
