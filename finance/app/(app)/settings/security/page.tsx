import type { Metadata } from "next";
import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireAdmin } from "@/lib/auth/dal";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password";

export const metadata: Metadata = { title: "Security" };

export default async function SecurityPage() {
  await requireAdmin();
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight">Security</h1>
      <Card>
        <CardHeader>
          <CardTitle>Change password</CardTitle>
          <CardDescription>
            At least {MIN_PASSWORD_LENGTH} characters with letters and numbers. Other signed-in devices will be signed out.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChangePasswordForm />
        </CardContent>
      </Card>
    </div>
  );
}
