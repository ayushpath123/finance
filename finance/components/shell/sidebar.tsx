"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { isActive, NAV_ITEMS } from "./nav-items";

export function Sidebar() {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="hidden w-56 shrink-0 border-r bg-background md:block">
      <div className="sticky top-14 space-y-1 p-3">
        {NAV_ITEMS.map(({ href, label, icon: Icon, match }) => {
          const active = isActive(pathname, match);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium",
                active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
              {href === "/collect" ? "Collect payment" : label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
