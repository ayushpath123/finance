import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getSessionUser } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  const user = await getSessionUser();
  if (user) redirect(user.role === "ADMIN" ? "/dashboard" : "/access-denied");

  return (
    // Centred both ways on every screen size, with equal breathing room on all sides.
    <main className="flex min-h-svh w-full items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-xl font-semibold tracking-[0.2em]">ARTI FINANCE</h1>
        <div className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
          <LoginForm />
        </div>
        <p className="mt-6 text-center text-xs text-muted-foreground">Authorised administrators only. All activity is recorded.</p>
      </div>
    </main>
  );
}
