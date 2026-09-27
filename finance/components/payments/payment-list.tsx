import Link from "next/link";
import { Money } from "@/components/finance/money";
import { formatDayShort, PAYMENT_METHOD_LABEL } from "@/lib/format";
import type { PaymentListItem } from "@/lib/services/read-models";
import { cn } from "@/lib/utils";

export function PaymentList({ payments, showContract = true }: { payments: PaymentListItem[]; showContract?: boolean }) {
  if (payments.length === 0) return <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">No payments yet.</p>;
  return (
    <ul className="divide-y rounded-xl border bg-card">
      {payments.map((p) => {
        const reversed = p.status === "REVERSED";
        return (
          <li key={p.id}>
            <Link href={`/contracts/${p.contractId}`} className="flex min-h-14 items-center justify-between gap-3 px-4 py-2.5 hover:bg-muted/40">
              <div className="min-w-0">
                <p className="text-sm font-medium">{formatDayShort(p.paymentDate)}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {PAYMENT_METHOD_LABEL[p.method]}
                  {p.referenceNumber ? ` · ${p.referenceNumber}` : ""}
                  {showContract ? ` · ${p.contractLabel}` : ""}
                  {p.correctsPaymentId ? " · correction" : ""}
                </p>
              </div>
              <div className="text-right">
                <Money value={p.amount} className={cn("font-semibold", reversed && "text-muted-foreground line-through")} />
                {reversed && <p className="text-[11px] font-medium text-red-600">REVERSED</p>}
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
