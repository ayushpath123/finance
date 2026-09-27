import { AppHeader } from "@/components/shell/app-header";
import { BottomNav } from "@/components/shell/bottom-nav";
import { Sidebar } from "@/components/shell/sidebar";
import { requireAdmin } from "@/lib/auth/dal";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Runs BEFORE the loading.tsx boundary starts streaming, so a signed-out or
  // non-admin full page load gets a real HTTP 307 (not a streamed soft redirect).
  // Every page still calls requireAdmin() itself: layouts don't re-run on client
  // navigation, so this is an additional gate, never the only one.
  await requireAdmin();
  return (
    <>
      <AppHeader />
      <div className="flex flex-1">
        <Sidebar />
        {/* pb-24 keeps content clear of the fixed bottom bar on phones */}
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-4 pb-24 sm:px-6 md:pt-6 md:pb-10">{children}</main>
      </div>
      <BottomNav />
    </>
  );
}
