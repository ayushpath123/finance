"use client";

import { Activity, FileText, HandCoins, MoreVertical, Pencil, Plus, ReceiptText } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function PersonMenu({ slug }: { slug: string }) {
  const items = [
    { href: `/people/${slug}/edit`, label: "Edit Person", icon: Pencil },
    { href: `/people/${slug}/contracts/new`, label: "Add Contract", icon: Plus },
    { href: `/collect?person=${slug}`, label: "Record Payment", icon: HandCoins },
    { sep: true },
    { href: `/activity?person=${slug}`, label: "View Transactions", icon: ReceiptText },
    { href: `/people/${slug}/statement`, label: "View Statement", icon: FileText },
    { href: `/people/${slug}#activity`, label: "View Activity", icon: Activity },
  ] as const;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="size-11 rounded-full" aria-label="More actions">
          <MoreVertical className="size-5" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {items.map((it, i) =>
          "sep" in it ? (
            <DropdownMenuSeparator key={i} />
          ) : (
            <DropdownMenuItem key={it.href} asChild className="h-10">
              <Link href={it.href}>
                <it.icon /> {it.label}
              </Link>
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
