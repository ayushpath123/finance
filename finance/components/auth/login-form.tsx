"use client";

import { AlertCircle, Loader2 } from "lucide-react";
import { useActionState } from "react";
import { loginAction, type LoginState } from "@/app/login/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "./password-input";

export function LoginForm() {
  const [state, action, pending] = useActionState<LoginState, FormData>(loginAction, {});
  const mobileError = state.fieldErrors?.mobileNumber;
  const passwordError = state.fieldErrors?.password;

  return (
    <form action={action} className="space-y-5" noValidate aria-describedby={state.error ? "login-error" : undefined}>
      {state.error && (
        <Alert variant="destructive" id="login-error" role="alert">
          <AlertCircle />
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}

      <div className="space-y-2">
        <Label htmlFor="mobileNumber">Mobile Number</Label>
        <Input
          id="mobileNumber"
          name="mobileNumber"
          type="tel"
          inputMode="numeric"
          autoComplete="username"
          placeholder="10-digit mobile number"
          maxLength={16}
          required
          autoFocus
          defaultValue={state.mobileNumber}
          aria-invalid={Boolean(mobileError)}
          aria-describedby={mobileError ? "mobile-error" : undefined}
          className="h-11 text-base"
        />
        {mobileError && (
          <p id="mobile-error" className="text-sm text-destructive">
            {mobileError}
          </p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          maxLength={128}
          aria-invalid={Boolean(passwordError)}
          aria-describedby={passwordError ? "password-error" : undefined}
          className="h-11 text-base"
        />
        {passwordError && (
          <p id="password-error" className="text-sm text-destructive">
            {passwordError}
          </p>
        )}
      </div>

      <Button type="submit" className="h-11 w-full text-base" disabled={pending} aria-busy={pending}>
        {pending ? (
          <>
            <Loader2 className="animate-spin" aria-hidden />
            Signing in…
          </>
        ) : (
          "Login"
        )}
      </Button>
    </form>
  );
}
