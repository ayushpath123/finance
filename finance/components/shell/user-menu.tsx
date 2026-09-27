"use client";

import { ChevronDown, KeyRound, LogOut, UserRound } from "lucide-react";
import Link from "next/link";
import { useRef } from "react";
import { logoutAction } from "@/app/actions/auth";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Top-right account menu. Receives only display fields — never tokens or ids. */
export function UserMenu({ mobileNumber, role }: { mobileNumber: string; role: string }) {
  const logoutForm = useRef<HTMLFormElement>(null);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-left outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="leading-tight">
            <span className="block font-mono text-sm tabular-nums">{mobileNumber}</span>
            <Badge variant="secondary" className="mt-0.5 h-4 px-1.5 text-[10px]">
              {role}
            </Badge>
          </span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          <DropdownMenuLabel className="font-mono text-xs text-muted-foreground">{mobileNumber}</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/settings/account">
              <UserRound /> Account
            </Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <Link href="/settings/security">
              <KeyRound /> Security
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => logoutForm.current?.requestSubmit()}>
            <LogOut /> Logout
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form ref={logoutForm} action={logoutAction} className="hidden" />
    </>
  );
}
