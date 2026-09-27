"use client";

import { CalendarDays, CheckCircle2, ChevronLeft, HandCoins, Loader2, UserRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import type { CreateContractState } from "@/app/actions/contracts";
import { Field, inputClass } from "@/components/finance/field";
import { StickyActions } from "@/components/finance/sticky-actions";
import { Money } from "@/components/finance/money";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { buildContractTerms, MAX_COLLECTION_DAYS } from "@/lib/finance/contract-terms";
import { addDays, isBusinessDate, type BusinessDate } from "@/lib/finance/dates";
import { parseRupees } from "@/lib/finance/money";
import { formatDay } from "@/lib/format";

const METHODS = [
  ["CASH", "Cash"],
  ["UPI", "UPI"],
  ["BANK_TRANSFER", "Bank transfer"],
  ["OTHER", "Other"],
] as const;

/**
 * Preview uses the SAME pure buildContractTerms the server runs, so the review
 * screen shows exactly what will be stored. The server recomputes on submit.
 */
function usePreview(v: { principal: string; daily: string; days: string; start: string; first: string }) {
  return useMemo(() => {
    const principal = parseRupees(v.principal);
    const daily = parseRupees(v.daily);
    const days = Number(v.days);
    if (principal === null || daily === null || !Number.isInteger(days) || !isBusinessDate(v.start) || !isBusinessDate(v.first)) return { terms: null, error: null };
    try {
      return { terms: buildContractTerms({ principalAmount: principal, dailyCollectionAmount: daily, totalCollectionDays: days, startDate: v.start, firstCollectionDate: v.first }), error: null };
    } catch (e) {
      return { terms: null, error: e instanceof Error ? e.message : "Invalid terms" };
    }
  }, [v.principal, v.daily, v.days, v.start, v.first]);
}

export function ContractForm({
  person,
  today,
  defaultMethod,
  action,
}: {
  person: { slug: string; fullName: string };
  today: BusinessDate;
  defaultMethod: string;
  action: (fd: FormData) => Promise<CreateContractState>;
}) {
  const [v, setV] = useState({
    principal: "",
    daily: "",
    days: "100",
    start: today as string,
    first: addDays(today, 1) as string,
    method: defaultMethod,
    reference: "",
    notes: "",
  });
  const [step, setStep] = useState<"edit" | "review">("edit");
  const [result, setResult] = useState<CreateContractState | null>(null);
  const [key, setKey] = useState(() => crypto.randomUUID()); // one key per agreement → double taps can't create two
  const [pending, start] = useTransition();
  const { terms, error: termsError } = usePreview(v);
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV((s) => ({ ...s, [k]: e.target.value }));
  const fieldErrors = result && !result.ok ? result.fieldErrors ?? {} : {};

  if (result?.ok) {
    const c = result.contract;
    return (
      <div className="space-y-6 py-2 text-center">
        <CheckCircle2 className="mx-auto size-12 text-emerald-600" aria-hidden />
        <div>
          <p className="text-sm text-muted-foreground">Contract created</p>
          <p className="mt-1 text-2xl font-semibold">Contract {c.label}</p>
          <p className="text-sm text-muted-foreground">{person.fullName}</p>
        </div>
        <dl className="mx-auto max-w-sm space-y-1 rounded-2xl border bg-card p-4 text-left text-sm">
          <Row label="Given"><Money value={c.principal} /></Row>
          <Row label="Daily collection"><Money value={c.daily} />/day</Row>
          <Row label="Days">{c.days}</Row>
          <Row label="First collection">{formatDay(c.firstCollection)}</Row>
          <Row label="Final collection">{formatDay(c.finalCollection)}</Row>
        </dl>
        <p className="text-xs text-muted-foreground">The principal was recorded as a disbursement. No payment has been recorded.</p>
        <div className="mx-auto grid max-w-sm gap-3">
          <Button asChild className="h-14 rounded-xl text-base">
            <Link href={`/contracts/${c.id}`}>
              <CalendarDays aria-hidden /> View Contract
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-xl">
            <Link href={`/collect?person=${person.slug}&contract=${c.id}`}>
              <HandCoins aria-hidden /> Record First Payment
            </Link>
          </Button>
          <Button asChild variant="ghost" className="h-12 rounded-xl">
            <Link href={`/people/${person.slug}`}>
              <UserRound aria-hidden /> Back to {person.fullName}
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const submit = () => {
    const fd = new FormData();
    fd.set("principalAmount", v.principal);
    fd.set("dailyCollectionAmount", v.daily);
    fd.set("totalCollectionDays", v.days);
    fd.set("startDate", v.start);
    fd.set("firstCollectionDate", v.first);
    fd.set("disbursementMethod", v.method);
    fd.set("disbursementReference", v.reference);
    fd.set("notes", v.notes);
    fd.set("idempotencyKey", key);
    start(async () => {
      const r = await action(fd);
      setResult(r);
      if (!r.ok) {
        setStep("edit");
        if (r.fieldErrors?.idempotencyKey) setKey(crypto.randomUUID());
      }
    });
  };

  if (step === "review" && terms) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setStep("edit")} className="-ml-1 inline-flex h-10 items-center gap-0.5 text-sm text-muted-foreground">
          <ChevronLeft className="size-4" aria-hidden /> Edit
        </button>
        <h2 className="text-xl font-semibold">Review Contract</h2>
        <dl className="space-y-2 rounded-2xl border bg-card p-4 text-sm">
          <Row label="Person"><span className="font-medium">{person.fullName}</span></Row>
          <Row label="Amount given"><Money value={terms.principalAmount} className="font-semibold" /></Row>
          <Row label="Paid out by">{METHODS.find((m) => m[0] === v.method)?.[1]}{v.reference ? ` · ${v.reference}` : ""}</Row>
          <Row label="Daily collection"><Money value={terms.dailyCollectionAmount} /></Row>
          <Row label="Collection days">{terms.totalCollectionDays} (every day)</Row>
          <hr />
          <Row label="Total collection"><Money value={terms.expectedCollectionAmount} className="text-base font-semibold" /></Row>
          <Row label="Contractual margin"><Money value={terms.expectedMargin} /></Row>
          <hr />
          <Row label="Start date">{formatDay(terms.startDate)}</Row>
          <Row label="First collection">{formatDay(terms.firstCollectionDate)}</Row>
          <Row label="Final collection"><span className="font-semibold">{formatDay(terms.expectedEndDate)}</span></Row>
        </dl>
        <p className="text-xs text-muted-foreground">These terms can’t be edited later. Mistakes are fixed by cancelling and creating a new contract.</p>
        <StickyActions>
          <Button onClick={submit} disabled={pending} className="h-14 w-full rounded-xl text-base shadow-sm md:h-12 md:w-auto md:px-8 ">
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            Create Contract
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
        if (terms) setStep("review");
      }}
    >
      {result && !result.ok && result.error && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{result.error}</AlertDescription>
        </Alert>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field id="principal" label="Amount Given" required error={fieldErrors.principalAmount}>
          <RupeeInput id="principal" value={v.principal} onChange={set("principal")} autoFocus />
        </Field>
        <Field id="daily" label="Daily Collection" required error={fieldErrors.dailyCollectionAmount}>
          <RupeeInput id="daily" value={v.daily} onChange={set("daily")} />
        </Field>
      </div>
      <Field id="days" label="Number of Collection Days" required error={fieldErrors.totalCollectionDays} hint="Every calendar day is a collection day.">
        <Input id="days" inputMode="numeric" pattern="[0-9]*" value={v.days} onChange={set("days")} className={inputClass} min={1} max={MAX_COLLECTION_DAYS} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field id="start" label="Contract Start" required error={fieldErrors.startDate}>
          <Input id="start" type="date" value={v.start} onChange={set("start")} className={inputClass} />
        </Field>
        <Field id="first" label="First Collection" required error={fieldErrors.firstCollectionDate}>
          <Input id="first" type="date" value={v.first} min={v.start} onChange={set("first")} className={inputClass} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field id="method" label="Principal given by">
          <select id="method" value={v.method} onChange={set("method")} className="h-12 w-full rounded-xl border border-input bg-transparent px-3 text-base">
            {METHODS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        <Field id="reference" label="Reference">
          <Input id="reference" value={v.reference} onChange={set("reference")} placeholder="Optional" className={inputClass} />
        </Field>
      </div>
      <Field id="notes" label="Notes">
        <Textarea id="notes" rows={2} value={v.notes} onChange={set("notes")} className="rounded-xl text-base" />
      </Field>

      {/* Live calculation */}
      <section aria-live="polite" className="rounded-2xl border bg-muted/40 p-4 text-sm">
        {terms ? (
          <dl className="space-y-1.5">
            <Row label="Daily collection"><Money value={terms.dailyCollectionAmount} /></Row>
            <Row label="Collection days">{terms.totalCollectionDays}</Row>
            <Row label="Total contracted collection"><Money value={terms.expectedCollectionAmount} className="font-semibold" /></Row>
            <Row label="Contractual margin"><Money value={terms.expectedMargin} /></Row>
            <Row label="First collection">{formatDay(terms.firstCollectionDate)}</Row>
            <Row label="Final collection"><span className="font-semibold">{formatDay(terms.expectedEndDate)}</span></Row>
          </dl>
        ) : (
          <p className={termsError ? "text-destructive" : "text-muted-foreground"}>{termsError ?? "Enter the amount, daily collection and days to see the calculation."}</p>
        )}
      </section>

      <StickyActions>
        <Button type="submit" disabled={!terms} className="h-14 w-full rounded-xl text-base shadow-sm md:h-12 md:w-auto md:px-8 ">
          Review Contract
        </Button>
      </StickyActions>
    </form>
  );
}

function RupeeInput(props: { id: string; value: string; onChange: (e: { target: { value: string } }) => void; autoFocus?: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground">₹</span>
      <Input {...props} inputMode="decimal" autoComplete="off" placeholder="0" className={`${inputClass} pl-7 tabular-nums`} />
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}
