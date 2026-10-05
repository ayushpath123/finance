-- ═══════════════════════════════════════════════════════════════════════
-- Borrowings: money YOU borrow from someone and pay back (principal + a fixed
-- interest amount, no time limit). Same engine as short-term lending, with a
-- direction. Additive: every existing short-term loan becomes direction LENT.
-- ═══════════════════════════════════════════════════════════════════════

-- CreateEnum
CREATE TYPE "ShortTermDirection" AS ENUM ('LENT', 'BORROWED');

-- AlterEnum


ALTER TYPE "LedgerEntryType" ADD VALUE 'BORROWING_RECEIVED';
ALTER TYPE "LedgerEntryType" ADD VALUE 'BORROWING_CANCELLED';
ALTER TYPE "LedgerEntryType" ADD VALUE 'BORROWING_REPAID';
ALTER TYPE "LedgerEntryType" ADD VALUE 'BORROWING_REPAID_REVERSAL';

-- AlterTable
ALTER TABLE "short_term_loans" ADD COLUMN     "direction" "ShortTermDirection" NOT NULL DEFAULT 'LENT';

-- CreateIndex
CREATE INDEX "short_term_loans_direction_status_idx" ON "short_term_loans"("direction", "status");


-- ═══ Invariants ═══════════════════════════════════════════════════════════
-- (enum literals compared as ::text so this also runs inside one transaction)

-- Ledger rows tied to a short-term loan/borrowing, and which of them name a repayment.
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_short_term_shape";
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_short_term_shape" CHECK (
  ("entryType"::text LIKE 'SHORT\_TERM\_%' OR "entryType"::text LIKE 'BORROWING\_%') = ("shortTermLoanId" IS NOT NULL)
  AND (("entryType"::text IN ('SHORT_TERM_REPAYMENT', 'SHORT_TERM_REPAYMENT_REVERSAL', 'BORROWING_REPAID', 'BORROWING_REPAID_REVERSAL'))
       = ("shortTermRepaymentId" IS NOT NULL))
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
  ("entryType"::text = 'SHORT_TERM_REPAYMENT_REVERSAL' AND "amount" < 0) OR
  ("entryType"::text = 'BORROWING_RECEIVED'            AND "amount" > 0) OR
  ("entryType"::text = 'BORROWING_CANCELLED'           AND "amount" < 0) OR
  ("entryType"::text = 'BORROWING_REPAID'              AND "amount" < 0) OR
  ("entryType"::text = 'BORROWING_REPAID_REVERSAL'     AND "amount" > 0)
);

-- A LENT loan only gets SHORT_TERM_* entries; a BORROWED one only BORROWING_*.
CREATE OR REPLACE FUNCTION af_ledger_direction_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_direction text;
BEGIN
  IF NEW."shortTermLoanId" IS NULL THEN RETURN NEW; END IF;
  SELECT "direction"::text INTO v_direction FROM "short_term_loans" WHERE "id" = NEW."shortTermLoanId";
  IF (v_direction = 'LENT' AND NEW."entryType"::text NOT LIKE 'SHORT\_TERM\_%')
     OR (v_direction = 'BORROWED' AND NEW."entryType"::text NOT LIKE 'BORROWING\_%') THEN
    RAISE EXCEPTION 'Ledger entry % does not match the % direction of loan %', NEW."entryType", v_direction, NEW."shortTermLoanId"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "ledger_entries_direction_guard" BEFORE INSERT ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION af_ledger_direction_guard();

-- Direction is part of the agreement: immutable, like the amounts.
CREATE OR REPLACE FUNCTION af_st_loans_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Short-term loans cannot be deleted; cancel them instead' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."id", NEW."loanNumber", NEW."personId", NEW."direction", NEW."principalAmount", NEW."interestAmount", NEW."givenOn",
      NEW."method", NEW."referenceNumber", NEW."idempotencyKey", NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."loanNumber", OLD."personId", OLD."direction", OLD."principalAmount", OLD."interestAmount", OLD."givenOn",
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
