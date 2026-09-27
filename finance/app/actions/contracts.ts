"use server";

import { revalidatePath } from "next/cache";
import { adminActorOrRedirect } from "@/lib/auth/dal";
import { fromDbDate } from "@/lib/finance/dates";
import { paise } from "@/lib/finance/money";
import { createContract, formatContractNumber } from "@/lib/services/contracts";
import { findPerson } from "@/lib/services/read-models";
import { contractInputSchema } from "@/lib/validation/schemas";
import { failure, zodFailure, type FormFailure } from "./forms";

export type CreateContractState =
  | {
      ok: true;
      contract: {
        id: string;
        label: string;
        principal: number;
        daily: number;
        days: number;
        expected: number;
        firstCollection: string;
        finalCollection: string;
        personSlug: string;
      };
    }
  | FormFailure;

/** All derived numbers are recomputed on the server by createContract; nothing from the client is trusted. */
export async function createContractAction(personKey: string, fd: FormData): Promise<CreateContractState> {
  const { actor } = await adminActorOrRedirect();
  const person = await findPerson(personKey);
  if (!person) return { ok: false, error: "Person not found." };

  const parsed = contractInputSchema.safeParse({
    personId: person.id,
    principalAmount: fd.get("principalAmount"),
    dailyCollectionAmount: fd.get("dailyCollectionAmount"),
    totalCollectionDays: fd.get("totalCollectionDays"),
    startDate: fd.get("startDate"),
    firstCollectionDate: fd.get("firstCollectionDate"),
    disbursementMethod: fd.get("disbursementMethod"),
    disbursementReference: fd.get("disbursementReference") ?? undefined,
    notes: fd.get("notes") ?? undefined,
    idempotencyKey: fd.get("idempotencyKey"),
  });
  if (!parsed.success) return zodFailure(parsed.error);

  try {
    const { contract } = await createContract(parsed.data, actor);
    revalidatePath(`/people/${person.slug}`);
    return {
      ok: true,
      contract: {
        id: contract.id,
        label: formatContractNumber(contract.contractNumber),
        principal: paise(contract.principalAmount),
        daily: paise(contract.dailyCollectionAmount),
        days: contract.totalCollectionDays,
        expected: paise(contract.expectedCollectionAmount),
        firstCollection: fromDbDate(contract.firstCollectionDate),
        finalCollection: fromDbDate(contract.expectedEndDate),
        personSlug: person.slug,
      },
    };
  } catch (err) {
    return failure(err, "create contract");
  }
}
