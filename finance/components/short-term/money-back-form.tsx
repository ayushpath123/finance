"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ShortTermMoneyBackState } from "@/app/actions/short-term";
import { Field, inputClass } from "@/components/finance/field";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BusinessDate } from "@/lib/finance/dates";
import { parseRupees } from "@/lib/finance/money";
import { formatINR, PAYMENT_METHOD_LABEL } from "@/lib/format-client";
import { WORDS, type Direction } from "@/lib/short-term-words";
import { cn } from "@/lib/utils";
import { RupeeInput } from "./short-term-form";

/**
 * "Money back": record what came back. If it's everything, the loan closes.
 * "Settle & close" closes now even if less came back — the rest is recorded as let go.
 */
export function MoneyBackForm({
  direction = "LENT",
  loanId,
  outstanding,
  today,
  givenOn,
  defaultMethod,
  action,
}: {
  direction?: Direction;
  loanId: string;
  outstanding: number;
  today: BusinessDate;
  givenOn: BusinessDate;
  defaultMethod: string;
  action: (fd: FormData) => Promise<ShortTermMoneyBackState>;
}) {
  const router = useRouter();
  // Authoritative outstanding from the server's last answer — not from a page refresh that may still be in flight.
  const [current, setCurrent] = useState(outstanding);
  const w = WORDS[direction];
  const [mode, setMode] = useState<"repay" | "settle">("repay");
  const [amount, setAmount] = useState(String(current / 100));
  const [date, setDate] = useState<string>(today);
  const [method, setMethod] = useState(defaultMethod);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [state, setState] = useState<ShortTermMoneyBackState | null>(null);
  const [pending, start] = useTransition();

  const paise = amount.trim() === "" ? (mode === "settle" ? 0 : null) : parseRupees(amount);
  const over = paise !== null && paise > current;
  const waived = mode === "settle" && paise !== null && !over ? current - paise : 0;
  const closes = mode === "settle" || paise === current;
  const valid = paise !== null && !over && (mode === "settle" ? paise >= 0 : paise > 0) && (waived === 0 || notes.trim().length >= 3);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};

  if (state?.ok) {
    return (
      <div className="space-y-3 rounded-2xl border bg-card p-4 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" aria-hidden />
        <p className="font-semibold">{state.duplicate ? "Already recorded" : state.amount > 0 ? `${formatINR(state.amount)} recorded` : "Loan settled"}</p>
        {state.closed ? (
          <p className="text-sm text-emerald-700">The loan is now closed{state.waived > 0 ? ` (${formatINR(state.waived)} let go)` : ""}.</p>
        ) : (
          <p className="text-sm text-muted-foreground">
            {formatINR(state.outstandingAfter)} still {direction === "BORROWED" ? "to pay back" : "to come back"}.
          </p>
        )}
        <Button
          variant="outline"
          className="h-11 rounded-xl"
          onClick={() => {
            setState(null);
            setMode("repay");
            setAmount(String(current / 100));
            setNotes("");
            setReference("");
            setKey(crypto.randomUUID());
            router.refresh();
          }}
        >
          Done
        </Button>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("loanId", loanId);
    fd.set("mode", mode);
    fd.set("amount", amount);
    fd.set("receivedOn", date);
    fd.set("method", method);
    fd.set("referenceNumber", reference);
    fd.set("notes", notes);
    fd.set("idempotencyKey", key);
    // The page refreshes only on "Done", so this confirmation stays on screen until it's been read.
    start(async () => {
      const r = await action(fd);
      setState(r);
      if (r.ok) setCurrent(r.outstandingAfter);
    });
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-2xl border bg-card p-4" noValidate>
      <div role="tablist" aria-label={w.back} className="grid grid-cols-2 gap-1 rounded-xl bg-muted p-1 text-sm font-medium">
        {(["repay", "settle"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              if (m === "repay") setAmount(String(current / 100));
            }}
            className={cn("h-10 rounded-lg", mode === m ? "bg-background shadow-sm" : "text-muted-foreground")}
          >
            {m === "repay" ? w.backTab : "Settle & close"}
          </button>
        ))}
      </div>
      {state && !state.ok && state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Field
        id="amount"
        label={mode === "settle" ? `Final ${w.backAmount.toLowerCase()}` : w.backAmount}
        required={mode === "repay"}
        error={errors.amount ?? errors.finalAmount ?? (over ? `Only ${formatINR(current)} is outstanding` : undefined)}
        hint={
          mode === "settle"
            ? w.settleHint
            : `${formatINR(current)} outstanding. Enter less if only part ${direction === "BORROWED" ? "is being paid" : "came back"}.`
        }
      >
        <RupeeInput id="amount" value={amount} onChange={setAmount} large />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="receivedOn" label="Date" required error={errors.receivedOn}>
          <Input id="receivedOn" type="date" min={givenOn} max={today} value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
        </Field>
        <Field id="method" label="Method">
          <select id="method" value={method} onChange={(e) => setMethod(e.target.value)} className="h-12 w-full rounded-xl border border-input bg-transparent px-3 text-base">
            {Object.entries(PAYMENT_METHOD_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </Field>
      </div>
      <Field id="reference" label="Reference">
        <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional" className={inputClass} />
      </Field>
      <Field id="notes" label={waived > 0 ? w.waiveReason : "Notes"} required={waived > 0} error={errors.note}>
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="rounded-xl text-base" />
      </Field>

      {paise !== null && !over && (
        <p className={cn("rounded-xl p-3 text-sm", closes ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-muted")}>
          {closes
            ? waived > 0
              ? `Closes the loan. ${formatINR(waived)} will be recorded as ${w.waived.toLowerCase()}.`
              : direction === "BORROWED"
                ? "This pays everything back — the borrowing will close."
                : "This brings everything back — the loan will close."
            : `${formatINR(current - paise)} will still be outstanding.`}
        </p>
      )}

      <Button type="submit" disabled={pending || !valid} className="h-14 w-full rounded-xl text-base">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {mode === "settle" ? "Settle & close" : paise ? `Record ${formatINR(paise)}` : "Record"}
      </Button>
    </form>
  );
}
