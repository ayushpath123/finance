import type { Metadata } from "next";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/dal";
import { prisma } from "@/lib/db/client";
import { formatDateTimeIST } from "@/lib/format";

export const metadata: Metadata = { title: "Account" };

export default async function AccountPage() {
  const me = await requireAdmin();
  const [user, activeSessions] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: me.id }, select: { mobileNumber: true, role: true, lastLoginAt: true, createdAt: true } }),
    prisma.session.count({ where: { userId: me.id, revokedAt: null, expiresAt: { gt: new Date() } } }),
  ]);
  const rows = [
    ["Mobile number", <span key="m" className="font-mono">{user.mobileNumber}</span>],
    ["Role", <Badge key="r" variant="secondary">{user.role}</Badge>],
    ["Last sign-in", formatDateTimeIST(user.lastLoginAt)],
    ["Account created", formatDateTimeIST(user.createdAt)],
    ["Active sessions", activeSessions],
  ] as const;
  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
      <Card>
        <CardHeader>
          <CardTitle>Your administrator account</CardTitle>
          <CardDescription>Times are shown in India Standard Time.</CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="divide-y text-sm">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between py-2.5">
                <dt className="text-muted-foreground">{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
