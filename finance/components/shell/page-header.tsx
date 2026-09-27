import { ChevronLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, back, actions }: { title: ReactNode; subtitle?: ReactNode; back?: { href: string; label: string }; actions?: ReactNode }) {
  return (
    <div className="mb-4 space-y-1">
      {back && (
        <Link href={back.href} className="-ml-1 inline-flex h-9 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft className="size-4" aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <div className="text-sm text-muted-foreground">{subtitle}</div>}
        </div>
        {actions}
      </div>
    </div>
  );
}
