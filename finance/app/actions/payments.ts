"use server";

import { revalidatePath } from "next/cache";
import { adminActorOrRedirect } from "@/lib/auth/dal";
import { formatContractNumber } from "@/lib/services/contracts";
import { recordPayment } from "@/lib/services/payments";
import { getContractSummary } from "@/lib/services/read-models";
import { prisma } from "@/lib/db/client";
import { paymentInputSchema } from "@/lib/validation/schemas";
import { failure, zodFailure, type FormFailure } from "./forms";

export interface PaymentReceipt {
  paymentId: string;
  amount: number;
  paymentDate: string;
  method: string;
  personName: string;
  personSlug: string;
  contractId: string;
  contractLabel: string;
  lines: { date: string; amount: number; kind: "ARREARS" | "CURRENT" | "ADVANCE" }[];
  credit: number;
  outstandingBefore: number;
  outstandingAfter: number;
  overdueAfter: number;
  completed: boolean;
  duplicate: boolean;
}

export type RecordPaymentState = { ok: true; receipt: PaymentReceipt } | FormFailure;

/** Records money received; the allocation explanation comes from the engine, not the browser. */
export async function recordPaymentAction(fd: FormData): Promise<RecordPaymentState> {
  const { actor } = await adminActorOrRedirect();
  const parsed = paymentInputSchema.safeParse({
    contractId: fd.get("contractId"),
    amount: fd.get("amount"),
    paymentDate: fd.get("paymentDate"),
    paymentMethod: fd.get("paymentMethod"),
    referenceNumber: fd.get("referenceNumber") ?? undefined,
    notes: fd.get("notes") ?? undefined,
    idempotencyKey: fd.get("idempotencyKey"),
  });
  if (!parsed.success) return zodFailure(parsed.error);

  try {
    const contract = await prisma.contract.findUnique({
      where: { id: parsed.data.contractId },
      select: { contractNumber: true, person: { select: { fullName: true, slug: true } } },
    });
    if (!contract) return { ok: false, error: "Contract not found." };

    const before = await getContractSummary(parsed.data.contractId);
    const result = await recordPayment(parsed.data, actor);
    const after = await getContractSummary(parsed.data.contractId);
    revalidatePath(`/people/${contract.person.slug}`);
    revalidatePath(`/contracts/${parsed.data.contractId}`);

    return {
      ok: true,
      receipt: {
        paymentId: result.payment.id,
        amount: result.payment.amount,
        paymentDate: parsed.data.paymentDate,
        method: result.payment.paymentMethod,
        personName: contract.person.fullName,
        personSlug: contract.person.slug,
        contractId: parsed.data.contractId,
        contractLabel: formatContractNumber(contract.contractNumber),
        lines: result.explanation.lines.map((l) => ({ date: l.scheduledDate, amount: l.amount, kind: l.kind })),
        credit: result.explanation.credit,
        // A replayed submission already changed the balance; don't show a fake "before".
        outstandingBefore: result.duplicate ? after.outstanding : before.outstanding,
        outstandingAfter: after.outstanding,
        overdueAfter: after.overdue,
        completed: result.contractCompleted,
        duplicate: result.duplicate,
      },
    };
  } catch (err) {
    return failure(err, "record payment");
  }
}
