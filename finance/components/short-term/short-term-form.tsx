"use client";

import { CheckCircle2, ChevronLeft, HandCoins, Loader2, UserRound } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import type { CreateShortTermState } from "@/app/actions/short-term";
import { Field, inputClass } from "@/components/finance/field";
import { Money } from "@/components/finance/money";
import { StickyActions } from "@/components/finance/sticky-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { BusinessDate } from "@/lib/finance/dates";
import { parseRupees } from "@/lib/finance/money";
import { formatDay, PAYMENT_METHOD_LABEL } from "@/lib/format-client";
import { WORDS, type Direction } from "@/lib/short-term-words";

export function RupeeInput({ id, value, onChange, autoFocus, large }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean; large?: boolean }) {
  return (
    <div className="relative">
      <span className={`pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground ${large ? "text-xl" : ""}`}>₹</span>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        inputMode="decimal"
        autoComplete="off"
        placeholder="0"
        className={large ? "h-16 rounded-xl pl-8 text-2xl font-semibold tabular-nums" : `${inputClass} pl-7 tabular-nums`}
      />
    </div>
  );
}

export function ShortTermForm({
  person,
  today,
  defaultMethod,
  action,
  direction = "LENT",
}: {
  direction?: Direction;
  person: { slug: string; fullName: string };
  today: BusinessDate;
  defaultMethod: string;
  action: (fd: FormData) => Promise<CreateShortTermState>;
}) {
  const [principal, setPrincipal] = useState("");
  const [interest, setInterest] = useState("");
  const [givenOn, setGivenOn] = useState<string>(today);
  const [method, setMethod] = useState(defaultMethod);
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [key] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<CreateShortTermState | null>(null);
  const [pending, start] = useTransition();
  const w = WORDS[direction];

  const p = parseRupees(principal);
  const i = interest.trim() === "" ? 0 : parseRupees(interest);
  const valid = p !== null && p > 0 && i !== null && givenOn <= today;
  const errors = result && !result.ok ? result.fieldErrors ?? {} : {};

  if (result?.ok) {
    const l = result.loan;
    return (
      <div className="space-y-6 py-2 text-center">
        <CheckCircle2 className="mx-auto size-12 text-emerald-600" aria-hidden />
        <div>
          <p className="text-sm text-muted-foreground">{w.recorded}</p>
          <p className="mt-1 text-2xl font-semibold">{l.label}</p>
          <p className="text-sm text-muted-foreground">{person.fullName}</p>
        </div>
        <dl className="mx-auto max-w-sm space-y-1 rounded-2xl border bg-card p-4 text-left text-sm">
          <Row label={w.principal}><Money value={l.principal} /></Row>
          <Row label="Interest"><Money value={l.interest} /></Row>
          <Row label={w.outstanding}><Money value={l.principal + l.interest} className="font-semibold" /></Row>
          <Row label="Date">{formatDay(l.givenOn)}</Row>
        </dl>
        <p className="text-xs text-muted-foreground">{w.closesNote}</p>
        <div className="mx-auto grid max-w-sm gap-3">
          <Button asChild className="h-14 rounded-xl text-base">
            <Link href={`/short-term/${l.id}`}>View {direction === "BORROWED" ? "borrowing" : "loan"}</Link>
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-xl">
            <Link href={`/people/${l.personSlug}`}>
              <UserRound aria-hidden /> Back to {person.fullName}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const submit = () => {
    const fd = new FormData();
    fd.set("direction", direction);
    fd.set("principalAmount", principal);
    fd.set("interestAmount", interest || "0");
    fd.set("givenOn", givenOn);
    fd.set("method", method);
    fd.set("referenceNumber", reference);
    fd.set("notes", notes);
    fd.set("idempotencyKey", key);
    start(async () => {
      const r = await action(fd);
      setResult(r);
      if (!r.ok) setStep("edit");
    });
  };

  if (step === "review" && valid) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setStep("edit")} className="-ml-1 inline-flex h-10 items-center gap-0.5 text-sm text-muted-foreground">
          <ChevronLeft className="size-4" aria-hidden /> Edit
        </button>
        <h2 className="text-xl font-semibold">Review</h2>
        <dl className="space-y-2 rounded-2xl border bg-card p-4 text-sm">
          <Row label="Person"><span className="font-medium">{person.fullName}</span></Row>
          <Row label={w.principalLong}><Money value={p!} className="font-semibold" /></Row>
          <Row label="Interest"><Money value={i!} /></Row>
          <hr />
          <Row label={w.outstanding}><Money value={p! + i!} className="text-base font-semibold" /></Row>
          <Row label={w.date}>{formatDay(givenOn)}</Row>
          <Row label={w.via}>{PAYMENT_METHOD_LABEL[method]}{reference ? ` · ${reference}` : ""}</Row>
          <Row label="Time limit">None</Row>
        </dl>
        <StickyActions>
          <Button onClick={submit} disabled={pending} className="h-14 w-full rounded-xl text-base shadow-sm md:h-12 md:w-auto md:px-8">
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            <HandCoins aria-hidden /> {w.recordButton}
          </Button>
        </StickyActions>
      </div>
    );
  }

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) setStep("review");
      }}
    >
      {result && !result.ok && result.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      )}
      <Field id="principal" label={w.principalLong} required error={errors.principalAmount}>
        <RupeeInput id="principal" value={principal} onChange={setPrincipal} autoFocus large />
      </Field>
      <Field id="interest" label="Interest Amount" error={errors.interestAmount} hint={w.interestHint}>
        <RupeeInput id="interest" value={interest} onChange={setInterest} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="givenOn" label={w.date} required error={errors.givenOn}>
          <Input id="givenOn" type="date" max={today} value={givenOn} onChange={(e) => setGivenOn(e.target.value)} className={inputClass} />
        </Field>
        <Field id="method" label={w.via}>
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
      <Field id="notes" label="Notes">
        <Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional — e.g. return by Diwali" className="rounded-xl text-base" />
      </Field>

      <section aria-live="polite" className="rounded-2xl border bg-muted/40 p-4 text-sm">
        {p !== null && p > 0 && i !== null ? (
          <dl className="space-y-1.5">
            <Row label={w.principal}><Money value={p} /></Row>
            <Row label="Interest"><Money value={i} /></Row>
            <Row label={w.outstanding}><Money value={p + i} className="text-base font-semibold" /></Row>
          </dl>
        ) : (
          <p className="text-muted-foreground">Enter the amount to see the total {direction === "BORROWED" ? "you'll pay back" : "that will come back"}.</p>
        )}
      </section>

      <StickyActions>
        <Button type="submit" disabled={!valid} className="h-14 w-full rounded-xl text-base shadow-sm md:h-12 md:w-auto md:px-8">
          Review
        </Button>
      </StickyActions>
    </form>
  );
}

export function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
