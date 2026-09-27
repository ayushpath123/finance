"use client";

import { CheckCircle2, Loader2, Plus, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import type { PersonFormState } from "@/app/actions/people";
import { Field, inputClass } from "@/components/finance/field";
import { StickyActions } from "@/components/finance/sticky-actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface Defaults {
  fullName?: string;
  phoneNumber?: string;
  alternatePhone?: string | null;
  address?: string | null;
  notes?: string | null;
  status?: string;
}

export function PersonForm({
  action,
  mode,
  defaults = {},
}: {
  action: (prev: PersonFormState, fd: FormData) => Promise<PersonFormState>;
  mode: "create" | "edit";
  defaults?: Defaults;
}) {
  const [state, formAction, pending] = useActionState<PersonFormState, FormData>(action, {});
  const router = useRouter();
  const err = state.ok === false ? state.fieldErrors ?? {} : {};
  // After a failed submit React resets the form; re-seed it with what was typed.
  const v = { ...defaults, ...(state.ok === false ? state.values : {}) } as Defaults;

  useEffect(() => {
    if (mode === "edit" && state.ok === true) {
      toast.success("Person updated");
      router.push(`/people/${state.person.slug}`);
    }
  }, [mode, state, router]);

  // After creating a person, the natural next step is their first contract.
  if (mode === "create" && state.ok === true) {
    return (
      <div className="space-y-6 py-4 text-center">
        <CheckCircle2 className="mx-auto size-12 text-emerald-600" aria-hidden />
        <div>
          <p className="text-sm text-muted-foreground">Person created</p>
          <p className="mt-1 text-2xl font-semibold">{state.person.fullName}</p>
        </div>
        <p className="text-sm text-muted-foreground">What would you like to do?</p>
        <div className="mx-auto grid max-w-sm gap-3">
          <Button asChild className="h-14 rounded-xl text-base">
            <Link href={`/people/${state.person.slug}/contracts/new`}>
              <Plus aria-hidden /> Add Contract
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-xl">
            <Link href={`/people/${state.person.slug}`}>
              <UserRound aria-hidden /> View Person
            </Link>
          </Button>
        </div>
      </div>
    );
  }

  const aria = (name: string) => ({ "aria-invalid": Boolean(err[name]) || undefined, "aria-describedby": err[name] ? `${name}-error` : undefined });

  return (
    <form key={state.ok === false ? JSON.stringify(state.values) : "initial"} action={formAction} className="space-y-4" noValidate>
      {state.ok === false && state.error && !Object.keys(err).length && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      <Field id="fullName" label="Full Name" required error={err.fullName}>
        <Input id="fullName" name="fullName" autoComplete="name" autoCapitalize="words" required defaultValue={v.fullName} className={inputClass} {...aria("fullName")} />
      </Field>
      <Field id="phoneNumber" label="Mobile Number" required error={err.phoneNumber}>
        <Input id="phoneNumber" name="phoneNumber" type="tel" inputMode="tel" autoComplete="tel" required defaultValue={v.phoneNumber} className={inputClass} {...aria("phoneNumber")} />
      </Field>
      <Field id="alternatePhone" label="Alternate Mobile" error={err.alternatePhone}>
        <Input id="alternatePhone" name="alternatePhone" type="tel" inputMode="tel" defaultValue={v.alternatePhone ?? ""} className={inputClass} {...aria("alternatePhone")} />
      </Field>
      <Field id="address" label="Address" error={err.address}>
        <Textarea id="address" name="address" rows={2} defaultValue={v.address ?? ""} className="rounded-xl text-base" {...aria("address")} />
      </Field>
      <Field id="notes" label="Notes" error={err.notes}>
        <Textarea id="notes" name="notes" rows={2} defaultValue={v.notes ?? ""} className="rounded-xl text-base" {...aria("notes")} />
      </Field>
      {mode === "edit" && (
        <Field id="status" label="Status" hint="People are never deleted — set INACTIVE instead. Financial history is always kept.">
          <select id="status" name="status" defaultValue={v.status} className="h-12 w-full rounded-xl border border-input bg-transparent px-3 text-base">
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="COMPLETED">Completed</option>
            <option value="DEFAULTED">Defaulted</option>
          </select>
        </Field>
      )}
      <StickyActions>
        <Button type="submit" disabled={pending} className="h-14 w-full rounded-xl text-base shadow-sm md:h-12 md:w-auto md:px-8 ">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {mode === "create" ? "Create Person" : "Save changes"}
        </Button>
      </StickyActions>
    </form>
  );
}
