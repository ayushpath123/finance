-- ════════════════════════════════════════════════════════════════════════
-- ARTI FINANCE — database-enforced financial invariants
--
-- Prisma cannot express CHECK constraints, partial indexes or triggers, so
-- they live here and are appended to the initial migration. The application
-- also validates everything, but the database is the last line of defence:
-- even a buggy code path or a hand-written SQL session cannot break these.
--
-- This file is the initial set (appended to 20260927000000_init). Later
-- constraints live in their own migrations, e.g. 20260927120000_mobile_auth.
-- ════════════════════════════════════════════════════════════════════════

-- ─────────────────────────── CHECK constraints ───────────────────────────

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_principal_positive"   CHECK ("principalAmount" > 0),
  ADD CONSTRAINT "contracts_daily_positive"       CHECK ("dailyCollectionAmount" > 0),
  ADD CONSTRAINT "contracts_days_range"           CHECK ("totalCollectionDays" BETWEEN 1 AND 3650),
  ADD CONSTRAINT "contracts_expected_is_product"  CHECK ("expectedCollectionAmount"::bigint = "dailyCollectionAmount"::bigint * "totalCollectionDays"),
  ADD CONSTRAINT "contracts_first_after_start"    CHECK ("firstCollectionDate" >= "startDate"),
  -- Every calendar day is a collection day: no holidays, no skips, no shifting.
  ADD CONSTRAINT "contracts_end_matches_days"     CHECK ("expectedEndDate" = "firstCollectionDate" + ("totalCollectionDays" - 1)),
  ADD CONSTRAINT "contracts_status_timestamps"    CHECK (
    ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
    AND ("status" <> 'COMPLETED' OR "completedAt" IS NOT NULL)
  );

ALTER TABLE "disbursements"
  ADD CONSTRAINT "disbursements_amount_positive" CHECK ("amount" > 0),
  ADD CONSTRAINT "disbursements_reversal_consistent" CHECK (("status" = 'REVERSED') = ("reversedAt" IS NOT NULL));

ALTER TABLE "collection_schedules"
  ADD CONSTRAINT "schedules_sequence_positive"   CHECK ("sequence" >= 1),
  ADD CONSTRAINT "schedules_expected_nonneg"     CHECK ("expectedAmount" >= 0),
  ADD CONSTRAINT "schedules_allocated_in_range"  CHECK ("allocatedAmount" BETWEEN 0 AND "expectedAmount"),
  ADD CONSTRAINT "schedules_shortfall_positive"  CHECK ("shortfallAtClose" IS NULL OR "shortfallAtClose" > 0),
  ADD CONSTRAINT "schedules_missed_consistent"   CHECK (("missedAt" IS NULL) = ("shortfallAtClose" IS NULL)),
  -- A cancelled day is no longer an obligation and holds no money.
  ADD CONSTRAINT "schedules_cancel_consistent"   CHECK (
    ("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL)
    AND ("cancelledAt" IS NULL OR "allocatedAmount" = 0)
  ),
  ADD CONSTRAINT "schedules_paid_means_full"     CHECK (
    ("status" IN ('PAID', 'SETTLED_LATE')) = ("allocatedAmount" = "expectedAmount" AND "cancelledAt" IS NULL)
  ),
  ADD CONSTRAINT "schedules_missed_means_zero"   CHECK ("status" <> 'MISSED' OR "allocatedAmount" = 0);

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive"      CHECK ("amount" > 0),
  ADD CONSTRAINT "payments_reversal_consistent"  CHECK (("status" = 'REVERSED') = ("reversedAt" IS NOT NULL)),
  ADD CONSTRAINT "payments_not_self_correction"  CHECK ("correctsPaymentId" IS NULL OR "correctsPaymentId" <> "id");

ALTER TABLE "payment_allocations"
  ADD CONSTRAINT "allocations_amount_positive"   CHECK ("amount" > 0),
  ADD CONSTRAINT "allocations_void_consistent"   CHECK (("voidedAt" IS NULL) = ("voidedRunId" IS NULL));

ALTER TABLE "ledger_entries"
  ADD CONSTRAINT "ledger_sign_matches_type" CHECK (
    ("entryType" = 'DISBURSEMENT'          AND "amount" < 0) OR
    ("entryType" = 'DISBURSEMENT_REVERSAL' AND "amount" > 0) OR
    ("entryType" = 'COLLECTION'            AND "amount" > 0) OR
    ("entryType" = 'COLLECTION_REVERSAL'   AND "amount" < 0) OR
    ("entryType" = 'SCHEDULE_MISSED'       AND "amount" = 0)
  ),
  ADD CONSTRAINT "ledger_memo_only_for_missed" CHECK (
    ("entryType" = 'SCHEDULE_MISSED') = ("memoAmount" IS NOT NULL) AND ("memoAmount" IS NULL OR "memoAmount" > 0)
  );

ALTER TABLE "business_settings"
  ADD CONSTRAINT "settings_single_row"     CHECK ("id" = 1),
  ADD CONSTRAINT "settings_cutoff_format"  CHECK ("dayCutoffTime" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- ─────────────────────────── Partial indexes ───────────────────────────
-- Hot paths only ever read ACTIVE allocations.

CREATE INDEX "payment_allocations_active_schedule_idx"
  ON "payment_allocations" ("scheduleId") WHERE "voidedAt" IS NULL;
CREATE INDEX "payment_allocations_active_payment_idx"
  ON "payment_allocations" ("paymentId") WHERE "voidedAt" IS NULL;
CREATE INDEX "collection_schedules_open_idx"
  ON "collection_schedules" ("scheduledDate") WHERE "status" IN ('PENDING', 'PARTIAL');

-- ─────────────────────────── Append-only tables ───────────────────────────

CREATE OR REPLACE FUNCTION af_forbid_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (% rejected)', TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'integrity_constraint_violation';
END $$;

CREATE TRIGGER "audit_logs_append_only"
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION af_forbid_mutation();
CREATE TRIGGER "audit_logs_no_truncate"
  BEFORE TRUNCATE ON "audit_logs"
  FOR EACH STATEMENT EXECUTE FUNCTION af_forbid_mutation();

CREATE TRIGGER "ledger_entries_append_only"
  BEFORE UPDATE OR DELETE ON "ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION af_forbid_mutation();
CREATE TRIGGER "ledger_entries_no_truncate"
  BEFORE TRUNCATE ON "ledger_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION af_forbid_mutation();

-- ─────────────── Payments: immutable except ACTIVE -> REVERSED ───────────────

CREATE OR REPLACE FUNCTION af_payments_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments cannot be deleted; reverse them instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."id", NEW."contractId", NEW."personId", NEW."amount", NEW."paymentDate",
      NEW."recordedAt", NEW."paymentMethod", NEW."referenceNumber", NEW."notes",
      NEW."idempotencyKey", NEW."createdById", NEW."correctsPaymentId")
     IS DISTINCT FROM
     (OLD."id", OLD."contractId", OLD."personId", OLD."amount", OLD."paymentDate",
      OLD."recordedAt", OLD."paymentMethod", OLD."referenceNumber", OLD."notes",
      OLD."idempotencyKey", OLD."createdById", OLD."correctsPaymentId") THEN
    RAISE EXCEPTION 'Payment % is immutable', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT (OLD."status" = 'ACTIVE' AND NEW."status" = 'REVERSED') THEN
    RAISE EXCEPTION 'Payment % may only transition ACTIVE -> REVERSED', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "payments_guard"
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION af_payments_guard();

-- ─────────────── Disbursements: immutable except ACTIVE -> REVERSED ───────────────

CREATE OR REPLACE FUNCTION af_disbursements_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Disbursements cannot be deleted; reverse them instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."id", NEW."contractId", NEW."personId", NEW."amount", NEW."disbursedOn",
      NEW."method", NEW."referenceNumber", NEW."notes", NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."contractId", OLD."personId", OLD."amount", OLD."disbursedOn",
      OLD."method", OLD."referenceNumber", OLD."notes", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Disbursement % is immutable', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT (OLD."status" = 'ACTIVE' AND NEW."status" = 'REVERSED') THEN
    RAISE EXCEPTION 'Disbursement % may only transition ACTIVE -> REVERSED', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "disbursements_guard"
  BEFORE UPDATE OR DELETE ON "disbursements"
  FOR EACH ROW EXECUTE FUNCTION af_disbursements_guard();

-- ─────────────── Allocations: append-only, void exactly once ───────────────

CREATE OR REPLACE FUNCTION af_allocations_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Allocations cannot be deleted; void them instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."id", NEW."contractId", NEW."paymentId", NEW."scheduleId", NEW."amount",
      NEW."createdRunId", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."contractId", OLD."paymentId", OLD."scheduleId", OLD."amount",
      OLD."createdRunId", OLD."createdAt")
     OR OLD."voidedAt" IS NOT NULL
     OR NEW."voidedAt" IS NULL THEN
    RAISE EXCEPTION 'Allocation % may only be voided once, nothing else may change', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "payment_allocations_guard"
  BEFORE UPDATE OR DELETE ON "payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION af_allocations_guard();

-- ─────────────── Contracts: financial terms are immutable ───────────────

CREATE OR REPLACE FUNCTION af_contracts_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Contracts cannot be deleted; cancel them instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."id", NEW."contractNumber", NEW."personId", NEW."principalAmount",
      NEW."dailyCollectionAmount", NEW."totalCollectionDays", NEW."expectedCollectionAmount",
      NEW."startDate", NEW."firstCollectionDate", NEW."expectedEndDate",
      NEW."idempotencyKey", NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."contractNumber", OLD."personId", OLD."principalAmount",
      OLD."dailyCollectionAmount", OLD."totalCollectionDays", OLD."expectedCollectionAmount",
      OLD."startDate", OLD."firstCollectionDate", OLD."expectedEndDate",
      OLD."idempotencyKey", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Financial terms of contract % are immutable', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- CANCELLED is terminal. COMPLETED may only be reopened to ACTIVE (a reversal
  -- left obligations unpaid again) — never cancelled or defaulted directly.
  IF OLD."status" = 'CANCELLED' AND NEW."status" <> 'CANCELLED' THEN
    RAISE EXCEPTION 'Contract % is CANCELLED and cannot change status', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."status" = 'COMPLETED' AND NEW."status" NOT IN ('COMPLETED', 'ACTIVE') THEN
    RAISE EXCEPTION 'Contract % is COMPLETED; it can only be reopened to ACTIVE', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'Contract % cancelledAt is permanent history', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "contracts_guard"
  BEFORE UPDATE OR DELETE ON "contracts"
  FOR EACH ROW EXECUTE FUNCTION af_contracts_guard();

-- ─────────────── Schedules: expectation immutable, missedAt sticky ───────────────

CREATE OR REPLACE FUNCTION af_schedules_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Schedule rows cannot be deleted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."id", NEW."contractId", NEW."sequence", NEW."scheduledDate", NEW."expectedAmount", NEW."createdAt")
     IS DISTINCT FROM
     (OLD."id", OLD."contractId", OLD."sequence", OLD."scheduledDate", OLD."expectedAmount", OLD."createdAt") THEN
    RAISE EXCEPTION 'Schedule % expectation is immutable', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."missedAt" IS NOT NULL AND (NEW."missedAt", NEW."shortfallAtClose") IS DISTINCT FROM (OLD."missedAt", OLD."shortfallAtClose") THEN
    RAISE EXCEPTION 'Schedule % missed-at-close record is permanent history', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."cancelledAt" IS NOT NULL AND NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt" THEN
    RAISE EXCEPTION 'Schedule % cancellation is permanent history', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "collection_schedules_guard"
  BEFORE UPDATE OR DELETE ON "collection_schedules"
  FOR EACH ROW EXECUTE FUNCTION af_schedules_guard();

-- ─────────────── Deferred cross-row invariants (checked at COMMIT) ───────────────
-- 1. Σ active allocations of a schedule = its allocatedAmount projection (≤ expected by CHECK).
-- 2. Σ active allocations of a payment ≤ payment amount.
-- 3. A REVERSED payment has no active allocations.

CREATE OR REPLACE FUNCTION af_check_schedule(p_schedule uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_projection integer;
  v_actual bigint;
BEGIN
  SELECT "allocatedAmount" INTO v_projection FROM "collection_schedules" WHERE "id" = p_schedule;
  SELECT COALESCE(SUM("amount"), 0) INTO v_actual
    FROM "payment_allocations" WHERE "scheduleId" = p_schedule AND "voidedAt" IS NULL;
  IF v_projection IS DISTINCT FROM v_actual THEN
    RAISE EXCEPTION 'Schedule % allocatedAmount (%) != sum of active allocations (%)',
      p_schedule, v_projection, v_actual USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION af_check_payment(p_payment uuid) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  v_amount integer;
  v_status "TransactionStatus";
  v_allocated bigint;
BEGIN
  SELECT "amount", "status" INTO v_amount, v_status FROM "payments" WHERE "id" = p_payment;
  SELECT COALESCE(SUM("amount"), 0) INTO v_allocated
    FROM "payment_allocations" WHERE "paymentId" = p_payment AND "voidedAt" IS NULL;
  IF v_allocated > v_amount THEN
    RAISE EXCEPTION 'Payment % over-allocated: % > %', p_payment, v_allocated, v_amount
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF v_status = 'REVERSED' AND v_allocated > 0 THEN
    RAISE EXCEPTION 'Reversed payment % still has active allocations', p_payment
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION af_allocations_deferred_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM af_check_schedule(NEW."scheduleId");
  PERFORM af_check_payment(NEW."paymentId");
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "payment_allocations_consistency"
  AFTER INSERT OR UPDATE ON "payment_allocations"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION af_allocations_deferred_check();

CREATE OR REPLACE FUNCTION af_schedules_deferred_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM af_check_schedule(NEW."id");
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "collection_schedules_consistency"
  AFTER INSERT OR UPDATE OF "allocatedAmount" ON "collection_schedules"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION af_schedules_deferred_check();

CREATE OR REPLACE FUNCTION af_payments_deferred_check() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM af_check_payment(NEW."id");
  RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER "payments_consistency"
  AFTER UPDATE OF "status" ON "payments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION af_payments_deferred_check();
