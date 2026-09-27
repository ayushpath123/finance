import type { Metadata } from "next";
import { UserStatusButton } from "@/components/auth/user-status-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listUsers } from "@/lib/auth/account";
import { requireAdmin } from "@/lib/auth/dal";
import { formatDateTimeIST } from "@/lib/format";

export const metadata: Metadata = { title: "Users" };

export default async function UsersPage() {
  const me = await requireAdmin();
  const users = await listUsers();
  const activeAdmins = users.filter((u) => u.role === "ADMIN" && u.isActive).length;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <Card>
        <CardHeader>
          <CardTitle>Accounts</CardTitle>
          <CardDescription>
            Accounts are never deleted — they are referenced by financial and audit records. Disable an account to revoke access
            immediately.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Mobile Number</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Last Login</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => {
                const isSelf = u.id === me.id;
                const lastAdmin = u.role === "ADMIN" && u.isActive && activeAdmins <= 1;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-mono">
                      {u.mobileNumber}
                      {isSelf && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{u.role}</Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={u.isActive ? "default" : "outline"}>{u.isActive ? "ACTIVE" : "DISABLED"}</Badge>
                    </TableCell>
                    <TableCell>{formatDateTimeIST(u.lastLoginAt)}</TableCell>
                    <TableCell>{formatDateTimeIST(u.createdAt)}</TableCell>
                    <TableCell className="text-right">
                      <UserStatusButton
                        userId={u.id}
                        mobileNumber={u.mobileNumber}
                        active={u.isActive}
                        disabledReason={u.isActive && isSelf ? "You cannot disable your own account" : u.isActive && lastAdmin ? "Last active administrator" : undefined}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
