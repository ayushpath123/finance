import type { Metadata } from "next";
import { createPersonAction } from "@/app/actions/people";
import { PersonForm } from "@/components/people/person-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireAdmin } from "@/lib/auth/dal";

export const metadata: Metadata = { title: "Add Person" };

export default async function NewPersonPage() {
  await requireAdmin();
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader back={{ href: "/people", label: "People" }} title="Add Person" />
      <PersonForm action={createPersonAction} mode="create" />
    </div>
  );
}
