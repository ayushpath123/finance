import Link from "next/link";
import { getSessionUser } from "@/lib/auth/dal";
import { UserMenu } from "./user-menu";

/** Display only. Authorization happens in each page via requireAdmin(). */
export async function AppHeader() {
  const user = await getSessionUser();
  return (
    <header className="sticky top-0 z-40 border-b bg-background/95 backdrop-blur">
      <div className="flex h-14 items-center gap-6 px-4 sm:px-6">
        <Link href="/dashboard" className="text-sm font-semibold tracking-[0.15em]">
          ARTI FINANCE
        </Link>
        <div className="ml-auto">{user && <UserMenu mobileNumber={user.mobileNumber} role={user.role} />}</div>
      </div>
    </header>
  );
}
