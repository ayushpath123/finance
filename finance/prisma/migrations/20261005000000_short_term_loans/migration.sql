-- ═══════════════════════════════════════════════════════════════════════
-- Short-term loans: lump sum out, fixed interest amount, no schedule.
-- Generated part (Prisma diff) followed by hand-written invariants.
-- Purely additive for existing data: new enum values, new tables, and
-- ledger_entries.contractId becomes nullable (existing rows all keep theirs).
-- ═══════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "ShortTermLoanStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "LedgerEntryType" ADD VALUE 'SHORT_TERM_GIVEN';
ALTER TYPE "LedgerEntryType" ADD VALUE 'SHORT_TERM_CANCELLED';
ALTER TYPE "LedgerEntryType" ADD VALUE 'SHORT_TERM_REPAYMENT';
ALTER TYPE "LedgerEntryType" ADD VALUE 'SHORT_TERM_REPAYMENT_REVERSAL';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'SHORT_TERM_LOAN_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'SHORT_TERM_LOAN_CLOSED';
ALTER TYPE "AuditAction" ADD VALUE 'SHORT_TERM_LOAN_REOPENED';
ALTER TYPE "AuditAction" ADD VALUE 'SHORT_TERM_LOAN_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE 'SHORT_TERM_REPAYMENT_RECORDED';
ALTER TYPE "AuditAction" ADD VALUE 'SHORT_TERM_REPAYMENT_REVERSED';

-- AlterTable
ALTER TABLE "ledger_entries" ADD COLUMN     "shortTermLoanId" UUID,
ADD COLUMN     "shortTermRepaymentId" UUID,
ALTER COLUMN "contractId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "short_term_loans" (
    "id" UUID NOT NULL,
    "loanNumber" SERIAL NOT NULL,
    "personId" UUID NOT NULL,
    "principalAmount" INTEGER NOT NULL,
    "interestAmount" INTEGER NOT NULL,
    "givenOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "status" "ShortTermLoanStatus" NOT NULL DEFAULT 'OPEN',
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "closedOn" DATE,
    "closedAt" TIMESTAMPTZ(3),
    "closedById" UUID,
    "waivedAmount" INTEGER,
    "closeNote" TEXT,
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledById" UUID,
    "cancelReason" TEXT,

    CONSTRAINT "short_term_loans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "short_term_repayments" (
    "id" UUID NOT NULL,
    "loanId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "receivedOn" DATE NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "PaymentMethod" NOT NULL,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "reversedAt" TIMESTAMPTZ(3),
    "reversedById" UUID,
    "reversalReason" TEXT,

    CONSTRAINT "short_term_repayments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "short_term_loans_loanNumber_key" ON "short_term_loans"("loanNumber");

-- CreateIndex
CREATE UNIQUE INDEX "short_term_loans_idempotencyKey_key" ON "short_term_loans"("idempotencyKey");

-- CreateIndex
CREATE INDEX "short_term_loans_personId_idx" ON "short_term_loans"("personId");

-- CreateIndex
CREATE INDEX "short_term_loans_status_idx" ON "short_term_loans"("status");

-- CreateIndex
CREATE UNIQUE INDEX "short_term_loans_id_personId_key" ON "short_term_loans"("id", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "short_term_repayments_idempotencyKey_key" ON "short_term_repayments"("idempotencyKey");

-- CreateIndex
CREATE INDEX "short_term_repayments_loanId_status_idx" ON "short_term_repayments"("loanId", "status");

-- CreateIndex
CREATE INDEX "short_term_repayments_personId_idx" ON "short_term_repayments"("personId");

-- CreateIndex
CREATE INDEX "short_term_repayments_receivedOn_idx" ON "short_term_repayments"("receivedOn");

-- CreateIndex
CREATE INDEX "ledger_entries_shortTermLoanId_idx" ON "ledger_entries"("shortTermLoanId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_entryType_shortTermLoanId_shortTermRepayment_key" ON "ledger_entries"("entryType", "shortTermLoanId", "shortTermRepaymentId");

-- AddForeignKey
ALTER TABLE "short_term_loans" ADD CONSTRAINT "short_term_loans_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_term_loans" ADD CONSTRAINT "short_term_loans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_term_loans" ADD CONSTRAINT "short_term_loans_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_term_loans" ADD CONSTRAINT "short_term_loans_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_term_repayments" ADD CONSTRAINT "short_term_repayments_loanId_personId_fkey" FOREIGN KEY ("loanId", "personId") REFERENCES "short_term_loans"("id", "personId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_term_repayments" ADD CONSTRAINT "short_term_repayments_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_term_repayments" ADD CONSTRAINT "short_term_repayments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "short_term_repayments" ADD CONSTRAINT "short_term_repayments_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_shortTermLoanId_personId_fkey" FOREIGN KEY ("shortTermLoanId", "personId") REFERENCES "short_term_loans"("id", "personId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_shortTermRepaymentId_fkey" FOREIGN KEY ("shortTermRepaymentId") REFERENCES "short_term_repayments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══ Invariants (hand-written) ═══════════════════════════════════════════
-- Enum literals are compared as ::text so this migration also works when run
-- inside a single transaction together with the ADD VALUE statements above.

-- ── Ledger: each row belongs to exactly one contract OR one short-term loan ──
ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_single_owner" CHECK (("contractId" IS NULL) <> ("shortTermLoanId" IS NULL)),
  ADD CONSTRAINT "ledger_short_term_shape" CHECK (
    ("entryType"::text LIKE 'SHORT\_TERM\_%') = ("shortTermLoanId" IS NOT NULL)
    AND (("entryType"::text IN ('SHORT_TERM_REPAYMENT', 'SHORT_TERM_REPAYMENT_REVERSAL')) = ("shortTermRepaymentId" IS NOT NULL))
  );
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_sign_matches_type";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_sign_matches_type" CHECK (
  ("entryType"::text = 'DISBURSEMENT'                  AND "amount" < 0) OR
  ("entryType"::text = 'DISBURSEMENT_REVERSAL'         AND "amount" > 0) OR
  ("entryType"::text = 'COLLECTION'                    AND "amount" > 0) OR
  ("entryType"::text = 'COLLECTION_REVERSAL'           AND "amount" < 0) OR
  ("entryType"::text = 'SCHEDULE_MISSED'               AND "amount" = 0) OR
  ("entryType"::text = 'SHORT_TERM_GIVEN'              AND "amount" < 0) OR
  ("entryType"::text = 'SHORT_TERM_CANCELLED'          AND "amount" > 0) OR
  ("entryType"::text = 'SHORT_TERM_REPAYMENT'          AND "amount" > 0) OR
  ("entryType"::text = 'SHORT_TERM_REPAYMENT_REVERSAL' AND "amount" < 0)
);
-- Postgres treats NULLs as distinct, so (GIVEN, loan, NULL) would not be unique on its own.
CREATE UNIQUE INDEX "ledger_entries_one_loan_event_idx"
  ON "ledger_entries" ("entryType", "shortTermLoanId") WHERE "shortTermRepaymentId" IS NULL AND "shortTermLoanId" IS NOT NULL;

-- ── Loans ──
ALTER TABLE "short_term_loans"
  ADD CONSTRAINT "st_loans_principal_positive" CHECK ("principalAmount" > 0),
  ADD CONSTRAINT "st_loans_interest_nonneg"    CHECK ("interestAmount" >= 0),
  ADD CONSTRAINT "st_loans_total_fits"         CHECK ("principalAmount"::bigint + "interestAmount" <= 2147483647),
  ADD CONSTRAINT "st_loans_waiver_positive"    CHECK ("waivedAmount" IS NULL OR "waivedAmount" > 0),
  ADD CONSTRAINT "st_loans_closed_shape"       CHECK (
    ("status"::text = 'CLOSED') = ("closedAt" IS NOT NULL)
    AND ("closedAt" IS NULL) = ("closedOn" IS NULL)
    AND ("closedAt" IS NULL) = ("closedById" IS NULL)
    AND ("waivedAmount" IS NULL OR "status"::text = 'CLOSED')
  ),
  ADD CONSTRAINT "st_loans_cancelled_shape"    CHECK (
    ("status"::text = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
    AND ("cancelledAt" IS NULL) = ("cancelledById" IS NULL)
  ),
  ADD CONSTRAINT "st_loans_closed_after_given" CHECK ("closedOn" IS NULL OR "closedOn" >= "givenOn");

CREATE OR REPLACE FUNCTION af_st_loans_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Short-term loans cannot be deleted; cancel them instead' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."id", NEW."loanNumber", NEW."personId", NEW."principalAmount", NEW."interestAmount", NEW."givenOn",
      NEW."method", NEW."referenceNumber", NEW."idempotencyKey", NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."loanNumber", OLD."personId", OLD."principalAmount", OLD."interestAmount", OLD."givenOn",
      OLD."method", OLD."referenceNumber", OLD."idempotencyKey", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Terms of short-term loan % are immutable', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status"::text = 'CANCELLED' AND NEW."status"::text <> 'CANCELLED' THEN
    RAISE EXCEPTION 'Short-term loan % is CANCELLED', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status"::text = 'CLOSED' AND NEW."status"::text = 'CANCELLED' THEN
    RAISE EXCEPTION 'A closed short-term loan cannot be cancelled' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "short_term_loans_guard" BEFORE UPDATE OR DELETE ON "short_term_loans"
  FOR EACH ROW EXECUTE FUNCTION af_st_loans_guard();

-- ── Repayments: immutable except ACTIVE -> REVERSED ──
ALTER TABLE "short_term_repayments"
  ADD CONSTRAINT "st_repayments_amount_positive"     CHECK ("amount" > 0),
  ADD CONSTRAINT "st_repayments_reversal_consistent" CHECK (
    ("status"::text = 'REVERSED') = ("reversedAt" IS NOT NULL) AND ("reversedAt" IS NULL) = ("reversedById" IS NULL)
  );

CREATE OR REPLACE FUNCTION af_st_repayments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Repayments cannot be deleted; reverse them instead' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."id", NEW."loanId", NEW."personId", NEW."amount", NEW."receivedOn", NEW."recordedAt", NEW."method",
      NEW."referenceNumber", NEW."notes", NEW."idempotencyKey", NEW."createdById")
     IS DISTINCT FROM
     (OLD."id", OLD."loanId", OLD."personId", OLD."amount", OLD."receivedOn", OLD."recordedAt", OLD."method",
      OLD."referenceNumber", OLD."notes", OLD."idempotencyKey", OLD."createdById") THEN
    RAISE EXCEPTION 'Repayment % is immutable', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT (OLD."status"::text = 'ACTIVE' AND NEW."status"::text = 'REVERSED') THEN
    RAISE EXCEPTION 'Repayment % may only transition ACTIVE -> REVERSED', OLD."id" USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "short_term_repayments_guard" BEFORE UPDATE OR DELETE ON "short_term_repayments"
  FOR EACH ROW EXECUTE FUNCTION af_st_repayments_guard();

-- ── Cross-row balance rules, checked at COMMIT ──
--   Σ active repayments ≤ principal + interest (never over-collected)
--   OPEN      ⇒ Σ < due   (a fully repaid loan must be closed)
--   CLOSED    ⇒ Σ + waived = due
--   CANCELLED ⇒ no active repayments
CREATE OR REPLACE FUNCTION af_check_st_loan(p_loan uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  l RECORD;
  v_received bigint;
  v_due bigint;
BEGIN
  SELECT * INTO l FROM "short_term_loans" WHERE "id" = p_loan;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT COALESCE(SUM("amount"), 0) INTO v_received FROM "short_term_repayments"
    WHERE "loanId" = p_loan AND "status"::text = 'ACTIVE';
  v_due := l."principalAmount"::bigint + l."interestAmount";
  IF v_received > v_due THEN
    RAISE EXCEPTION 'Short-term loan % over-repaid: % > %', p_loan, v_received, v_due USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF l."status"::text = 'OPEN' AND v_received >= v_due THEN
    RAISE EXCEPTION 'Short-term loan % is fully repaid but still OPEN', p_loan USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF l."status"::text = 'CLOSED' AND v_received + COALESCE(l."waivedAmount", 0) <> v_due THEN
    RAISE EXCEPTION 'Short-term loan % closed with % received + % waived <> % due', p_loan, v_received, COALESCE(l."waivedAmount", 0), v_due
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF l."status"::text = 'CANCELLED' AND v_received > 0 THEN
    RAISE EXCEPTION 'Cancelled short-term loan % still has repayments', p_loan USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION af_st_loans_deferred_check() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN PERFORM af_check_st_loan(NEW."id"); RETURN NULL; END $$;
CREATE OR REPLACE FUNCTION af_st_repayments_deferred_check() RETURNS trigger
LANGUAGE plpgsql AS $$ BEGIN PERFORM af_check_st_loan(NEW."loanId"); RETURN NULL; END $$;

CREATE CONSTRAINT TRIGGER "short_term_loans_consistency"
  AFTER INSERT OR UPDATE ON "short_term_loans" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION af_st_loans_deferred_check();
CREATE CONSTRAINT TRIGGER "short_term_repayments_consistency"
  AFTER INSERT OR UPDATE ON "short_term_repayments" DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION af_st_repayments_deferred_check();
