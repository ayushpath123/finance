import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createShortTermLoanAction } from "@/app/actions/short-term";
import { PageHeader } from "@/components/shell/page-header";
import { ShortTermForm } from "@/components/short-term/short-term-form";
import { requireAdmin } from "@/lib/auth/dal";
import { findPerson } from "@/lib/services/read-models";
import { businessNow, getSettings } from "@/lib/services/settings";

export const metadata: Metadata = { title: "Short-term loan" };

export default async function NewShortTermPage({ params }: PageProps<"/people/[personId]/short-term/new">) {
  await requireAdmin();
  const person = await findPerson((await params).personId);
  if (!person) notFound();
  const settings = await getSettings();
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader back={{ href: `/people/${person.slug}`, label: person.fullName }} title="Short-term loan" subtitle={person.fullName} />
      <ShortTermForm
        person={{ slug: person.slug, fullName: person.fullName }}
        today={businessNow(settings).today}
        defaultMethod={settings.defaultPaymentMethod}
        action={createShortTermLoanAction.bind(null, person.slug)}
      />
    </div>
  );
}
