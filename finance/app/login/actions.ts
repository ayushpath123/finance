"use server";

import { AuthError, CredentialsSignin } from "next-auth";
import { signIn } from "@/lib/auth/auth";
import { loginSchema } from "@/lib/validation/auth";

export interface LoginState {
  error?: string;
  fieldErrors?: { mobileNumber?: string; password?: string };
  /** Echoed back so the field isn't cleared after a failed attempt. Never the password. */
  mobileNumber?: string;
}

const MESSAGES: Record<string, string> = {
  invalid_credentials: "Invalid mobile number or password.",
  account_disabled: "This account is currently disabled. Please contact an administrator.",
  rate_limited: "Too many sign-in attempts. Please wait 15 minutes and try again.",
};
const UNAVAILABLE = "Unable to sign in right now. Please try again.";

export async function loginAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const raw = { mobileNumber: String(formData.get("mobileNumber") ?? ""), password: String(formData.get("password") ?? "") };
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) {
    const f = parsed.error.flatten().fieldErrors;
    return { mobileNumber: raw.mobileNumber, fieldErrors: { mobileNumber: f.mobileNumber?.[0], password: f.password?.[0] } };
  }

  try {
    // On success this throws Next's redirect to /dashboard, which then applies the ADMIN check
    // (non-admin accounts land on /access-denied).
    await signIn("credentials", { ...parsed.data, redirectTo: "/dashboard" });
  } catch (err) {
    if (err instanceof CredentialsSignin) return { mobileNumber: raw.mobileNumber, error: MESSAGES[err.code] ?? MESSAGES.invalid_credentials };
    if (err instanceof AuthError) return { mobileNumber: raw.mobileNumber, error: UNAVAILABLE };
    throw err; // redirect
  }
  return { mobileNumber: raw.mobileNumber, error: UNAVAILABLE };
}
