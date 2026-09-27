"use client";

import { AlertCircle, ChevronLeft, ChevronRight, HandCoins } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Money } from "@/components/finance/money";
import { DAY_STYLE } from "@/components/finance/status";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import type { BusinessDate } from "@/lib/finance/dates";
import { formatDayFull, formatDayShort, formatINR, formatMonth, PAYMENT_METHOD_LABEL } from "@/lib/format-client";
import type { CalendarDay } from "@/lib/services/read-models";
import { cn } from "@/lib/utils";

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

function monthKey(d: string) {
  return d.slice(0, 7);
}

function monthGrid(ym: string): (string | null)[] {
  const [y, m] = ym.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7; // Monday-first
  const cells: (string | null)[] = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym}-${String(d).padStart(2, "0")}`);
  while (cells.length % 7) cells.push(null);
  return cells;
}

export function CollectionCalendar({
  days,
  today,
  recordHref,
  canRecord,
}: {
  days: CalendarDay[];
  today: BusinessDate;
  recordHref: string;
  canRecord: boolean;
}) {
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);
  const months = useMemo(() => [...new Set(days.map((d) => monthKey(d.date)))], [days]);
  const initial = months.includes(monthKey(today)) ? monthKey(today) : today < days[0]?.date ? months[0] : months.at(-1)!;
  const [month, setMonth] = useState(initial);
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  const idx = months.indexOf(month);

  const counts = useMemo(() => {
    const inMonth = days.filter((d) => monthKey(d.date) === month);
    return {
      paid: inMonth.filter((d) => d.status === "PAID" || d.status === "SETTLED_LATE").length,
      missed: inMonth.filter((d) => d.status === "MISSED").length,
      partial: inMonth.filter((d) => d.status === "PARTIAL").length,
    };
  }, [days, month]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="icon" className="size-11 rounded-full" disabled={idx <= 0} onClick={() => setMonth(months[idx - 1])} aria-label="Previous month">
          <ChevronLeft className="size-5" />
        </Button>
        <div className="text-center">
          <p className="font-semibold">{formatMonth(month)}</p>
          <p className="text-xs text-muted-foreground">
            {counts.paid} paid · {counts.missed} missed{counts.partial ? ` · ${counts.partial} partial` : ""}
          </p>
        </div>
        <Button variant="ghost" size="icon" className="size-11 rounded-full" disabled={idx >= months.length - 1} onClick={() => setMonth(months[idx + 1])} aria-label="Next month">
          <ChevronRight className="size-5" />
        </Button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground" aria-hidden>
        {WEEKDAYS.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={`Collections, ${formatMonth(month)}`}>
        {monthGrid(month).map((date, i) => {
          const day = date ? byDate.get(date as BusinessDate) : undefined;
          if (!date || !day) {
            return (
              <div key={i} className="flex h-14 items-start justify-center pt-1.5 text-xs text-muted-foreground/40" aria-hidden>
                {date ? Number(date.slice(8)) : ""}
              </div>
            );
          }
          const style = DAY_STYLE[day.display] ?? DAY_STYLE.PENDING;
          return (
            <button
              key={date}
              type="button"
              role="gridcell"
              onClick={() => setSelected(day)}
              aria-label={`${formatDayShort(date)}: ${style.label}, expected ${formatINR(day.expected)}, received ${formatINR(day.allocated)}`}
              className={cn(
                "relative flex h-14 flex-col items-center justify-start gap-0.5 rounded-lg pt-1.5 ring-1 outline-none ring-inset focus-visible:ring-3 focus-visible:ring-ring",
                style.cell,
              )}
            >
              <span className="text-sm leading-none font-semibold tabular-nums">{Number(date.slice(8))}</span>
              <span className={cn("size-1.5 rounded-full", style.dot)} aria-hidden />
              <span className="text-[9px] leading-none tabular-nums opacity-80">{compact(day.display === "FUTURE" ? day.expected : day.allocated)}</span>
              {day.wasMissed && day.status !== "MISSED" && (
                <span className="absolute top-0.5 right-0.5 size-1.5 rounded-full bg-red-500" title="Missed at close" aria-hidden />
              )}
            </button>
          );
        })}
      </div>

      <Legend />

      <Drawer open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DrawerContent>
          {selected && <DayDetail day={selected} recordHref={recordHref} canRecord={canRecord && selected.outstanding > 0} />}
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function compact(paise: number): string {
  const r = paise / 100;
  if (r >= 100000) return `${(r / 100000).toFixed(1).replace(/\.0$/, "")}L`;
  if (r >= 1000) return `${(r / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(r));
}

function Legend() {
  const items = ["PAID", "SETTLED_LATE", "MISSED", "PARTIAL", "PREPAID", "TODAY_PENDING", "FUTURE"] as const;
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {items.map((k) => (
        <li key={k} className="inline-flex items-center gap-1">
          <span className={cn("size-2 rounded-full", DAY_STYLE[k].dot, k === "SETTLED_LATE" && "ring-2 ring-red-400")} aria-hidden />
          {DAY_STYLE[k].label}
        </li>
      ))}
    </ul>
  );
}

function DayDetail({ day, recordHref, canRecord }: { day: CalendarDay; recordHref: string; canRecord: boolean }) {
  const style = DAY_STYLE[day.display] ?? DAY_STYLE.PENDING;
  const late = day.allocations.filter((a) => a.paymentDate > day.date);
  const lateTotal = late.reduce((t, a) => t + a.amount, 0);
  return (
    <div className="mx-auto w-full max-w-md">
      <DrawerHeader className="text-left">
        <DrawerTitle>{formatDayFull(day.date)}</DrawerTitle>
        <DrawerDescription className="flex items-center gap-2">
          <span className={cn("size-2 rounded-full", style.dot)} aria-hidden />
          <span className="font-semibold tracking-wide text-foreground uppercase">{style.label}</span>
          <span>· Day {day.sequence}</span>
        </DrawerDescription>
      </DrawerHeader>

      <div className="max-h-[55vh] space-y-4 overflow-y-auto px-4 text-sm">
        <dl className="grid grid-cols-3 gap-2">
          <Cell label="Expected" value={day.expected} />
          <Cell label={day.wasMissed ? "Paid on time" : "Received"} value={day.wasMissed ? day.paidOnTime : day.allocated} />
          <Cell label="Outstanding" value={day.outstanding} tone={day.outstanding > 0 && day.display !== "FUTURE" && day.display !== "TODAY_PENDING" ? "danger" : undefined} />
        </dl>

        {day.wasMissed && (
          <p className="flex gap-2 rounded-xl bg-red-50 p-3 text-red-800 dark:bg-red-950 dark:text-red-200">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              Missed at end of day with <strong>{formatINR(day.shortfallAtClose ?? 0)}</strong> unpaid.
              {lateTotal > 0 && (
                <>
                  {" "}
                  Later settled <strong>{formatINR(lateTotal)}</strong>.
                </>
              )}
            </span>
          </p>
        )}

        <section>
          <h3 className="mb-1.5 font-medium">Money applied to this day</h3>
          {day.allocations.length === 0 ? (
            <p className="text-muted-foreground">None</p>
          ) : (
            <ul className="divide-y rounded-xl border">
              {day.allocations.map((a, i) => (
                <li key={i} className="flex items-center justify-between gap-2 px-3 py-2">
                  <span>
                    <Money value={a.amount} className="font-semibold" /> → {formatDayShort(day.date)}
                    <span className="block text-xs text-muted-foreground">
                      from {formatINR(a.paymentAmount)} received {formatDayShort(a.paymentDate)} · {PAYMENT_METHOD_LABEL[a.method]}
                      {a.referenceNumber ? ` · ${a.referenceNumber}` : ""}
                    </span>
                  </span>
                  {a.paymentDate > day.date && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-200">LATE</span>}
                  {a.paymentDate < day.date && <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950 dark:text-sky-200">ADVANCE</span>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {day.receivedThisDay.length > 0 && (
          <section>
            <h3 className="mb-1.5 font-medium">Payments received on this day</h3>
            <ul className="divide-y rounded-xl border">
              {day.receivedThisDay.map((p) => (
                <li key={p.id} className="flex items-center justify-between px-3 py-2">
                  <span className="text-muted-foreground">
                    {PAYMENT_METHOD_LABEL[p.method]}
                    {p.referenceNumber ? ` · ${p.referenceNumber}` : ""}
                  </span>
                  <Money value={p.amount} className={cn("font-semibold", p.status === "REVERSED" && "text-muted-foreground line-through")} />
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">Allocated oldest-first — some of this may have paid other days.</p>
          </section>
        )}
        {day.notes && <p className="rounded-xl bg-muted p-3">{day.notes}</p>}
      </div>

      <DrawerFooter>
        {canRecord && (
          <Button asChild className="h-12 rounded-xl text-base">
            <Link href={recordHref}>
              <HandCoins aria-hidden /> Record Payment
            </Link>
          </Button>
        )}
      </DrawerFooter>
    </div>
  );
}

function Cell({ label, value, tone }: { label: string; value: number; tone?: "danger" }) {
  return (
    <div className="rounded-xl bg-muted/50 p-2.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("font-semibold", tone === "danger" && "text-red-600")}>
        <Money value={value} />
      </dd>
    </div>
  );
}
