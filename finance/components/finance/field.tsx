import type { ReactNode } from "react";
import { Label } from "@/components/ui/label";

/** Label + control + error, wired for screen readers. */
export function Field({ id, label, required, error, hint, children }: { id: string; label: string; required?: boolean; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm">
        {label}
        {required && <span className="text-destructive" aria-hidden> *</span>}
      </Label>
      {children}
      {hint && !error && <p className="text-xs text-muted-foreground">{hint}</p>}
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

export const inputClass = "h-12 rounded-xl text-base";
