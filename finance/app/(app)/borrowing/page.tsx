import type { Metadata } from "next";
import { BookPage } from "@/components/short-term/book-page";
import { requireAdmin } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Borrowing" };

export default async function BorrowingPage({ searchParams }: PageProps<"/borrowing">) {
  await requireAdmin();
  return <BookPage direction="BORROWED" show={(await searchParams).show === "closed" ? "CLOSED" : "OPEN"} />;
}
