import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createContractAction } from "@/app/actions/contracts";
import { ContractForm } from "@/components/contracts/contract-form";
import { PageHeader } from "@/components/shell/page-header";
import { requireAdmin } from "@/lib/auth/dal";
import { findPerson } from "@/lib/services/read-models";
import { businessNow, getSettings } from "@/lib/services/settings";

export const metadata: Metadata = { title: "New Contract" };

export default async function NewContractPage({ params }: PageProps<"/people/[personId]/contracts/new">) {
  await requireAdmin();
  const person = await findPerson((await params).personId);
  if (!person) notFound();
  const settings = await getSettings();
  const bn = businessNow(settings);
  return (
    <div className="mx-auto max-w-lg">
      <PageHeader back={{ href: `/people/${person.slug}`, label: person.fullName }} title="New Contract" subtitle={person.fullName} />
      <ContractForm
        person={{ slug: person.slug, fullName: person.fullName }}
        today={bn.today}
        defaultMethod={settings.defaultPaymentMethod}
        action={createContractAction.bind(null, person.slug)}
      />
    </div>
  );
}
