"use client";

import { ArrowRight, CheckCircle2, Loader2, UserRound } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { RecordPaymentState } from "@/app/actions/payments";
import { Field, inputClass } from "@/components/finance/field";
import { StickyActions } from "@/components/finance/sticky-actions";
import { Money } from "@/components/finance/money";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BusinessDate } from "@/lib/finance/dates";
import { parseRupees } from "@/lib/finance/money";
import { formatDay, formatDayShort, formatINR, PAYMENT_METHOD_LABEL } from "@/lib/format-client";
import { cn } from "@/lib/utils";

export interface PayableContract {
  id: string;
  label: string;
  status: string;
  daily: number;
  outstanding: number;
  overdue: number;
  todayRemaining: number;
}

const KIND_LABEL = { ARREARS: "outstanding", CURRENT: "collection", ADVANCE: "prepaid" } as const;

export function PaymentForm({
  person,
  contracts,
  initialContractId,
  today,
  defaultMethod,
  action,
}: {
  person: { slug: string; fullName: string; phoneNumber: string };
  contracts: PayableContract[];
  initialContractId?: string;
  today: BusinessDate;
  defaultMethod: string;
  action: (fd: FormData) => Promise<RecordPaymentState>;
}) {
  const only = contracts.length === 1 ? contracts[0].id : undefined;
  const [contractId, setContractId] = useState(initialContractId && contracts.some((c) => c.id === initialContractId) ? initialContractId : only ?? "");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<string>(today);
  const [method, setMethod] = useState(defaultMethod);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [key, setKey] = useState(() => crypto.randomUUID()); // same key on retry → never recorded twice
  const [state, setState] = useState<RecordPaymentState | null>(null);
  const [pending, start] = useTransition();

  const contract = contracts.find((c) => c.id === contractId);
  const paise = parseRupees(amount);
  const errors = state && !state.ok ? state.fieldErrors ?? {} : {};

  if (state?.ok) {
    const r = state.receipt;
    return (
      <div className="space-y-5">
        <div className="text-center">
          <CheckCircle2 className="mx-auto size-12 text-emerald-600" aria-hidden />
          <p className="mt-2 text-sm text-muted-foreground">{r.duplicate ? "Already recorded" : "Payment recorded"}</p>
          <p className="text-3xl font-semibold tracking-tight">
            <Money value={r.amount} />
          </p>
          <p className="text-sm text-muted-foreground">
            received from <span className="font-medium text-foreground">{r.personName}</span> · {formatDayShort(r.paymentDate)} · {PAYMENT_METHOD_LABEL[r.method]}
          </p>
          <p className="text-sm font-medium">Contract {r.contractLabel}</p>
        </div>

        <section className="rounded-2xl border bg-card p-4">
          <h2 className="mb-2 text-sm font-semibold">Allocation</h2>
          <ul className="space-y-2 text-sm">
            {r.lines.map((l, i) => (
              <li key={i} className="flex items-center justify-between gap-2">
                <Money value={l.amount} className="font-semibold" />
                <span className="flex items-center gap-1 text-muted-foreground">
                  <ArrowRight className="size-3.5" aria-hidden />
                  {formatDayShort(l.date)} {KIND_LABEL[l.kind]}
                </span>
              </li>
            ))}
            {r.credit > 0 && (
              <li className="flex items-center justify-between gap-2">
                <Money value={r.credit} className="font-semibold" />
                <span className="text-muted-foreground">→ unallocated credit</span>
              </li>
            )}
          </ul>
        </section>

        <section className="rounded-2xl bg-muted/50 p-4 text-sm">
          <p className="text-muted-foreground">Outstanding</p>
          <p className="mt-0.5 flex items-center gap-2 text-lg font-semibold">
            <Money value={r.outstandingBefore} className="text-muted-foreground line-through decoration-1" />
            <ArrowRight className="size-4 text-muted-foreground" aria-hidden />
            <Money value={r.outstandingAfter} />
          </p>
          {r.overdueAfter > 0 ? (
            <p className="mt-1 text-red-600">Still overdue: {formatINR(r.overdueAfter)}</p>
          ) : (
            <p className="mt-1 text-emerald-700">No overdue days remaining.</p>
          )}
          {r.completed && <p className="mt-1 font-medium text-sky-700">All obligations satisfied — contract completed.</p>}
        </section>

        <div className="grid gap-3 sm:grid-cols-3">
          <Button
            className="h-12 rounded-xl"
            onClick={() => {
              setState(null);
              setAmount("");
              setReference("");
              setNotes("");
              setKey(crypto.randomUUID());
            }}
          >
            Record another
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-xl">
            <Link href={`/contracts/${r.contractId}#calendar`}>View Contract</Link>
          </Button>
          <Button asChild variant="ghost" className="h-12 rounded-xl">
            <Link href={`/people/${r.personSlug}`}>
              <UserRound aria-hidden /> {r.personName}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const fd = new FormData();
    fd.set("contractId", contractId);
    fd.set("amount", amount);
    fd.set("paymentDate", date);
    fd.set("paymentMethod", method);
    fd.set("referenceNumber", reference);
    fd.set("notes", notes);
    fd.set("idempotencyKey", key);
    start(async () => setState(await action(fd)));
  };

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      {state && !state.ok && state.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="flex items-center justify-between rounded-xl border bg-card px-4 py-3">
        <div>
          <p className="text-xs text-muted-foreground">Person</p>
          <p className="font-semibold">{person.fullName}</p>
          <p className="font-mono text-xs text-muted-foreground">{person.phoneNumber}</p>
        </div>
        <Link href="/collect" className="inline-flex h-10 items-center text-sm font-medium text-primary">
          Change
        </Link>
      </div>

      <fieldset className="space-y-2">
        <legend className="mb-1.5 text-sm font-medium">Contract{contracts.length > 1 && <span className="text-destructive"> *</span>}</legend>
        {contracts.map((c) => (
          <label
            key={c.id}
            className={cn(
              "flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-xl border bg-card px-4 py-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
              contractId === c.id && "border-primary ring-1 ring-primary",
            )}
          >
            <span className="flex items-center gap-3">
              <input type="radio" name="contract" value={c.id} checked={contractId === c.id} onChange={() => setContractId(c.id)} className="size-4 accent-primary" />
              <span>
                <span className="block font-medium">
                  Contract {c.label}
                  {c.status !== "ACTIVE" && <span className="ml-1 text-xs text-muted-foreground">({c.status.toLowerCase()})</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {formatINR(c.daily)}/day{c.overdue > 0 && <span className="text-red-600"> · {formatINR(c.overdue)} overdue</span>}
                </span>
              </span>
            </span>
            <span className="text-right text-sm">
              <span className="block text-xs text-muted-foreground">Outstanding</span>
              <Money value={c.outstanding} className="font-semibold" />
            </span>
          </label>
        ))}
        {errors.contractId && <p className="text-sm text-destructive">Choose a contract.</p>}
      </fieldset>

      <Field id="amount" label="Amount" required error={errors.amount}>
        <div className="relative">
          <span className="pointer-events-none absolute top-1/2 left-4 -translate-y-1/2 text-xl text-muted-foreground">₹</span>
          <Input
            id="amount"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="h-16 rounded-xl pl-9 text-2xl font-semibold tabular-nums"
            aria-invalid={Boolean(errors.amount) || undefined}
          />
        </div>
        {contract && (
          <div className="flex flex-wrap gap-2 pt-1">
            {[
              ["Daily", contract.daily],
              ...(contract.todayRemaining > 0 && contract.todayRemaining !== contract.daily ? [["Today", contract.todayRemaining] as const] : []),
              ...(contract.overdue > 0 ? [["Overdue + today", contract.overdue + contract.todayRemaining] as const] : []),
            ].map(([label, value]) => (
              <button
                key={label}
                type="button"
                onClick={() => setAmount(String(Number(value) / 100))}
                className="h-9 rounded-full border px-3 text-sm hover:bg-muted"
              >
                {label} {formatINR(Number(value))}
              </button>
            ))}
          </div>
        )}
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field id="date" label="Payment Date" required error={errors.paymentDate}>
          <Input id="date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={inputClass} />
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
        <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Optional (UPI ref, cheque no.)" className={inputClass} />
      </Field>
      <Field id="notes" label="Notes">
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" className="rounded-xl text-base" />
      </Field>
      {date !== today && <p className="text-xs text-amber-700">Recording a payment dated {formatDay(date)} (not today).</p>}

      <StickyActions>
        <Button type="submit" disabled={pending || !contract || !paise} className="h-14 w-full rounded-xl text-base shadow-sm md:h-12 md:w-auto md:px-8 ">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {paise ? `Record ${formatINR(paise)}` : "Record Payment"}
        </Button>
      </StickyActions>
    </form>
  );
}
