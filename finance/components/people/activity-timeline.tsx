import { AlertCircle, Ban, CheckCircle2, FilePlus2, HandCoins, Pencil, RotateCcw, UserPlus, Wallet } from "lucide-react";
import type { AuditAction } from "@/lib/generated/prisma/enums";
import { formatDateTimeIST, formatDayShort, PAYMENT_METHOD_LABEL } from "@/lib/format";
import type { ActivityItem } from "@/lib/services/read-models";

const ICON: Partial<Record<AuditAction, typeof Wallet>> = {
  PERSON_CREATED: UserPlus,
  PERSON_UPDATED: Pencil,
  CONTRACT_CREATED: FilePlus2,
  DISBURSEMENT_CREATED: Wallet,
  PAYMENT_CREATED: HandCoins,
  PAYMENT_REVERSED: RotateCcw,
  PAYMENT_CORRECTED: RotateCcw,
  SCHEDULE_MARKED_MISSED: AlertCircle,
  CONTRACT_CANCELLED: Ban,
  CONTRACT_COMPLETED: CheckCircle2,
  SHORT_TERM_LOAN_CREATED: Wallet,
  SHORT_TERM_REPAYMENT_RECORDED: HandCoins,
  SHORT_TERM_REPAYMENT_REVERSED: RotateCcw,
  SHORT_TERM_LOAN_CLOSED: CheckCircle2,
  SHORT_TERM_LOAN_REOPENED: RotateCcw,
  SHORT_TERM_LOAN_CANCELLED: Ban,
};

const TONE: Partial<Record<AuditAction, string>> = {
  SCHEDULE_MARKED_MISSED: "text-red-600 bg-red-50 dark:bg-red-950",
  PAYMENT_CREATED: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950",
  CONTRACT_COMPLETED: "text-sky-700 bg-sky-50 dark:bg-sky-950",
  SHORT_TERM_REPAYMENT_RECORDED: "text-emerald-700 bg-emerald-50 dark:bg-emerald-950",
  SHORT_TERM_LOAN_CLOSED: "text-sky-700 bg-sky-50 dark:bg-sky-950",
  PAYMENT_REVERSED: "text-amber-700 bg-amber-50 dark:bg-amber-950",
};

/** Audit descriptions are precise but terse; make them read naturally ("2026-09-28" → "28 Sep"). */
function humanize(text: string): string {
  return text
    .replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (d) => formatDayShort(d))
    .replace(/ \((MISSED|PARTIAL)\)$/, (_m, s: string) => ` — ${s.toLowerCase()}`)
    .replace(/^(\d{1,2} \w{3}): /, "$1 · ")
    .replace(/\b(CASH|UPI|BANK_TRANSFER|OTHER)\b/g, (m) => PAYMENT_METHOD_LABEL[m].toLowerCase().replace("upi", "UPI"));
}

export function ActivityTimeline({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="space-y-3">
      {items.map((a) => {
        const Icon = ICON[a.action] ?? Pencil;
        return (
          <li key={a.id} className="flex gap-3">
            <span className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-muted ${TONE[a.action] ?? "text-muted-foreground"}`}>
              <Icon className="size-4" aria-hidden />
            </span>
            <div className="min-w-0 text-sm">
              <p className="break-words">{humanize(a.description)}</p>
              <p className="text-xs text-muted-foreground">
                {formatDateTimeIST(a.timestamp)} · {a.by ? `by ${a.by}` : "system"}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
