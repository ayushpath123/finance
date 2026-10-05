import { Money } from "@/components/finance/money";
import type { AgeBucket } from "@/lib/finance/settlement";
import { cn } from "@/lib/utils";

/** How long open money has been out — older buckets drawn darker. */
export function AgeingBars({ buckets, tone }: { buckets: AgeBucket[]; tone: "lent" | "borrowed" }) {
  const max = Math.max(1, ...buckets.map((b) => b.outstanding));
  const shades = tone === "lent" ? ["bg-emerald-300", "bg-emerald-500", "bg-amber-500", "bg-red-500"] : ["bg-amber-200", "bg-amber-400", "bg-amber-600", "bg-red-500"];
  return (
    <ul className="space-y-2.5">
      {buckets.map((b, i) => (
        <li key={b.key} className="text-sm">
          <div className="mb-1 flex justify-between gap-2">
            <span className="text-muted-foreground">
              {b.label} <span className="text-xs">· {b.count}</span>
            </span>
            <Money value={b.outstanding} className={cn("font-medium", b.count === 0 && "text-muted-foreground")} />
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className={cn("h-full rounded-full", shades[i])} style={{ width: `${(b.outstanding / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
