import { ChevronRight, FileBarChart, KeyRound, LogOut, ScrollText, UserRound, Users } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { PageHeader } from "@/components/shell/page-header";
import { requireAdmin } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "More" };

export default async function MorePage() {
  const me = await requireAdmin();
  const groups = [
    {
      title: "Account",
      items: [
        { href: "/settings/account", label: "Account", icon: UserRound, hint: me.mobileNumber },
        { href: "/settings/security", label: "Security", icon: KeyRound, hint: "Change password" },
      ],
    },
    {
      title: "Administration",
      items: [
        { href: "/settings/users", label: "Users", icon: Users, hint: "Enable / disable administrators" },
        { href: null, label: "Reports", icon: FileBarChart, hint: "Coming next" },
        { href: null, label: "Audit log", icon: ScrollText, hint: "Coming next" },
      ],
    },
  ];
  return (
    <div className="mx-auto max-w-lg space-y-5">
      <PageHeader title="More" />
      {groups.map((g) => (
        <section key={g.title}>
          <h2 className="mb-1.5 px-1 text-xs font-medium tracking-wider text-muted-foreground uppercase">{g.title}</h2>
          <ul className="divide-y rounded-2xl border bg-card">
            {g.items.map((it) => {
              const body = (
                <>
                  <it.icon className="size-5 text-muted-foreground" aria-hidden />
                  <span className="flex-1">
                    <span className="block font-medium">{it.label}</span>
                    <span className="block text-xs text-muted-foreground">{it.hint}</span>
                  </span>
                  {it.href && <ChevronRight className="size-4 text-muted-foreground" aria-hidden />}
                </>
              );
              return (
                <li key={it.label}>
                  {it.href ? (
                    <Link href={it.href} className="flex min-h-14 items-center gap-3 px-4 py-2 hover:bg-muted/40">{body}</Link>
                  ) : (
                    <div className="flex min-h-14 items-center gap-3 px-4 py-2 opacity-60" aria-disabled>{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      <form action={logoutAction}>
        <button type="submit" className="flex h-14 w-full items-center justify-center gap-2 rounded-2xl border bg-card font-medium text-red-600 hover:bg-muted/40">
          <LogOut className="size-5" aria-hidden /> Logout
        </button>
      </form>
    </div>
  );
}
