"use server";

import { revalidatePath } from "next/cache";
import { adminActorOrRedirect } from "@/lib/auth/dal";
import { createPerson, updatePerson } from "@/lib/services/people";
import { findPerson } from "@/lib/services/read-models";
import { personInputSchema, personUpdateSchema } from "@/lib/validation/schemas";
import { failure, zodFailure, type FormFailure } from "./forms";

export type PersonFormState = { ok: true; person: { slug: string; fullName: string } } | FormFailure | { ok?: undefined };

const fields = (fd: FormData) => ({
  fullName: String(fd.get("fullName") ?? ""),
  phoneNumber: String(fd.get("phoneNumber") ?? ""),
  alternatePhone: String(fd.get("alternatePhone") ?? ""),
  address: String(fd.get("address") ?? ""),
  notes: String(fd.get("notes") ?? ""),
});

export async function createPersonAction(_prev: PersonFormState, fd: FormData): Promise<PersonFormState> {
  const { actor } = await adminActorOrRedirect();
  const values = fields(fd);
  const parsed = personInputSchema.safeParse(values);
  if (!parsed.success) return zodFailure(parsed.error, values);
  try {
    const person = await createPerson(parsed.data, actor);
    revalidatePath("/people");
    return { ok: true, person: { slug: person.slug, fullName: person.fullName } };
  } catch (err) {
    return failure(err, "create person", values);
  }
}

export async function updatePersonAction(personKey: string, _prev: PersonFormState, fd: FormData): Promise<PersonFormState> {
  const { actor } = await adminActorOrRedirect();
  const person = await findPerson(personKey);
  if (!person) return { ok: false, error: "Person not found." };
  const values = { ...fields(fd), status: String(fd.get("status") ?? person.status) };
  const parsed = personUpdateSchema.safeParse(values);
  if (!parsed.success) return zodFailure(parsed.error, values);
  try {
    // Blank optional fields mean "clear it".
    const { alternatePhone, address, notes, ...rest } = parsed.data;
    const updated = await updatePerson(person.id, { ...rest, alternatePhone: alternatePhone ?? null, address: address ?? null, notes: notes ?? null }, actor);
    revalidatePath(`/people/${updated.slug}`);
    return { ok: true, person: { slug: updated.slug, fullName: updated.fullName } };
  } catch (err) {
    return failure(err, "update person", values);
  }
}
