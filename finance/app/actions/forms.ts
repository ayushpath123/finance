import type { ZodError } from "zod";
import { describeDbError } from "@/lib/db/describe-error";
import { DomainError } from "@/lib/services/errors";

/** Shape every form action returns on failure. Messages are user-safe; internals are logged only. */
export interface FormFailure {
  ok: false;
  error?: string;
  fieldErrors?: Record<string, string | undefined>;
  /** Submitted values echoed back so a failed submit doesn't clear the form (never passwords). */
  values?: Record<string, string>;
}

export function zodFailure(err: ZodError, values?: Record<string, string>): FormFailure {
  const fieldErrors: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = String(issue.path[0] ?? "form");
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, fieldErrors, values, error: "Please correct the highlighted fields." };
}

export function failure(err: unknown, context: string, values?: Record<string, string>): FormFailure {
  if (err instanceof DomainError) {
    const field = typeof err.details?.field === "string" ? err.details.field : undefined;
    return { ok: false, error: err.message, values, fieldErrors: field ? { [field]: err.message } : undefined };
  }
  console.error(`[action] ${context} failed → ${describeDbError(err)}`);
  return { ok: false, values, error: "Something went wrong. Nothing was saved — please try again." };
}
