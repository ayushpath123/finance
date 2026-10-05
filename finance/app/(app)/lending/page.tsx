import type { Metadata } from "next";
import { BookPage } from "@/components/short-term/book-page";
import { requireAdmin } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Lending" };

export default async function LendingPage({ searchParams }: PageProps<"/lending">) {
  await requireAdmin();
  return <BookPage direction="LENT" show={(await searchParams).show === "closed" ? "CLOSED" : "OPEN"} />;
}
