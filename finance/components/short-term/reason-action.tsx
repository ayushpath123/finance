"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import type { SimpleState } from "@/app/actions/short-term";
import { Button } from "@/components/ui/button";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Textarea } from "@/components/ui/textarea";

/** A small destructive action (reverse / cancel) that always asks for a reason in a bottom sheet. */
export function ReasonAction({
  label,
  title,
  description,
  confirmLabel,
  hidden,
  action,
}: {
  label: string;
  title: string;
  description: string;
  confirmLabel: string;
  hidden: Record<string, string>;
  action: (prev: SimpleState, fd: FormData) => Promise<SimpleState>;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<SimpleState>({});
  const [pending, start] = useTransition();
  const router = useRouter();
  const formAction = (fd: FormData) =>
    start(async () => {
      const r = await action({}, fd);
      setState(r);
      if (r.ok === true) {
        toast.success(r.message);
        setOpen(false);
        router.refresh();
      }
    });

  return (
    <>
      <Button type="button" variant="ghost" size="sm" className="h-9 text-muted-foreground" onClick={() => setOpen(true)}>
        {label}
      </Button>
      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent>
          <form action={formAction} className="mx-auto w-full max-w-md">
            <DrawerHeader className="text-left">
              <DrawerTitle>{title}</DrawerTitle>
              <DrawerDescription>{description}</DrawerDescription>
            </DrawerHeader>
            <div className="space-y-2 px-4">
              {Object.entries(hidden).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <label htmlFor="reason" className="text-sm font-medium">
                Reason <span className="text-destructive">*</span>
              </label>
              <Textarea id="reason" name="reason" rows={2} required minLength={3} className="rounded-xl text-base" />
              {state.ok === false && <p className="text-sm text-destructive">{state.fieldErrors?.reason ?? state.error}</p>}
            </div>
            <DrawerFooter>
              <Button type="submit" variant="destructive" disabled={pending} className="h-12 rounded-xl">
                {pending && <Loader2 className="animate-spin" aria-hidden />}
                {confirmLabel}
              </Button>
            </DrawerFooter>
          </form>
        </DrawerContent>
      </Drawer>
    </>
  );
}
