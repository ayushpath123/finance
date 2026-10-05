import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/auth/dal";

/** Old combined list → the separate Lending / Borrowing pages (keeps bookmarks and earlier links working). */
export default async function ShortTermListRedirect({ searchParams }: PageProps<"/short-term">) {
  await requireAdmin();
  const sp = await searchParams;
  const base = sp.type === "borrowed" ? "/borrowing" : "/lending";
  redirect(sp.show === "closed" ? `${base}?show=closed` : base);
}
