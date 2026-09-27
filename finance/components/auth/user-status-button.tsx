"use client";

import { Loader2 } from "lucide-react";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { setUserActiveAction, type UserStatusState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

export function UserStatusButton({
  userId,
  mobileNumber,
  active,
  disabledReason,
}: {
  userId: string;
  mobileNumber: string;
  active: boolean;
  disabledReason?: string;
}) {
  const [state, action, pending] = useActionState<UserStatusState, FormData>(setUserActiveAction, {});
  useEffect(() => {
    if (state.error) toast.error(state.error);
  }, [state]);

  return (
    <form
      action={action}
      onSubmit={(e) => {
        if (active && !window.confirm(`Disable ${mobileNumber}? They will be signed out immediately.`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="userId" value={userId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      <Button
        type="submit"
        size="sm"
        variant={active ? "destructive" : "outline"}
        disabled={pending || Boolean(disabledReason)}
        title={disabledReason}
      >
        {pending && <Loader2 className="animate-spin" aria-hidden />}
        {active ? "Disable" : "Enable"}
      </Button>
    </form>
  );
}
