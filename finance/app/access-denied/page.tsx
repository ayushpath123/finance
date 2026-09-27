import { ShieldAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { logoutAction } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { getSessionUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Access restricted" };

/** Public page. Shows no financial data — only who is signed in and a way out. */
export default async function AccessDeniedPage() {
  const user = await getSessionUser();
  return (
    <main className="flex min-h-svh items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-8 text-center shadow-sm">
        <ShieldAlert className="mx-auto size-10 text-destructive" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">Access Restricted</h1>
        <p className="mt-3 text-sm text-muted-foreground">Your account does not have permission to access this application.</p>
        <p className="mt-1 text-sm text-muted-foreground">Please contact an administrator.</p>
        <div className="mt-6">
          {user ? (
            <form action={logoutAction}>
              <Button type="submit" variant="outline">
                Sign out
              </Button>
            </form>
          ) : (
            <Button asChild variant="outline">
              <Link href="/login">Back to sign in</Link>
            </Button>
          )}
        </div>
      </div>
    </main>
  );
}
