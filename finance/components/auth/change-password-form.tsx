"use client";

import { CheckCircle2, Loader2 } from "lucide-react";
import { useActionState } from "react";
import { changePasswordAction, type ChangePasswordState } from "@/app/actions/auth";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "./password-input";

const FIELDS = [
  { name: "currentPassword", label: "Current Password", autoComplete: "current-password" },
  { name: "newPassword", label: "New Password", autoComplete: "new-password" },
  { name: "confirmPassword", label: "Confirm New Password", autoComplete: "new-password" },
] as const;

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState<ChangePasswordState, FormData>(changePasswordAction, {});
  return (
    <form action={action} className="space-y-4" noValidate>
      {state.ok && (
        <Alert role="status">
          <CheckCircle2 />
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {!state.ok && state.message && (
        <Alert variant="destructive" role="alert">
          <AlertDescription>{state.message}</AlertDescription>
        </Alert>
      )}
      {FIELDS.map((f) => {
        const error = state.fieldErrors?.[f.name];
        return (
          <div key={f.name} className="space-y-2">
            <Label htmlFor={f.name}>{f.label}</Label>
            <PasswordInput
              id={f.name}
              name={f.name}
              autoComplete={f.autoComplete}
              required
              maxLength={128}
              aria-invalid={Boolean(error)}
              aria-describedby={error ? `${f.name}-error` : undefined}
              className="h-10"
            />
            {error && (
              <p id={`${f.name}-error`} className="text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
        );
      })}
      <Button type="submit" disabled={pending} className="h-10">
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        Change password
      </Button>
    </form>
  );
}
