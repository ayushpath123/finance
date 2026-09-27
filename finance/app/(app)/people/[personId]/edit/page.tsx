import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { updatePersonAction } from "@/app/actions/people";
import { PersonForm } from "@/components/people/person-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireAdmin } from "@/lib/auth/dal";
import { findPerson } from "@/lib/services/read-models";

export const metadata: Metadata = { title: "Edit Person" };

export default async function EditPersonPage({ params }: PageProps<"/people/[personId]/edit">) {
  await requireAdmin();
  const person = await findPerson((await params).personId);
  if (!person) notFound();
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader back={{ href: `/people/${person.slug}`, label: person.fullName }} title="Edit Person" />
      <PersonForm action={updatePersonAction.bind(null, person.slug)} mode="edit" defaults={person} />
    </div>
  );
}
