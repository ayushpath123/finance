-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "PersonStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'COMPLETED', 'DEFAULTED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'DEFAULTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AllocationPolicy" AS ENUM ('OLDEST_FIRST');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'UPI', 'BANK_TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "TransactionStatus" AS ENUM ('ACTIVE', 'REVERSED');

-- CreateEnum
CREATE TYPE "ScheduleStatus" AS ENUM ('PENDING', 'PAID', 'PARTIAL', 'MISSED', 'SETTLED_LATE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AllocationTrigger" AS ENUM ('PAYMENT_CREATED', 'PAYMENT_REVERSED', 'PAYMENT_CORRECTED', 'CONTRACT_CANCELLED', 'RECONCILIATION');

-- CreateEnum
CREATE TYPE "LedgerEntryType" AS ENUM ('DISBURSEMENT', 'DISBURSEMENT_REVERSAL', 'COLLECTION', 'COLLECTION_REVERSAL', 'SCHEDULE_MISSED');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('PERSON_CREATED', 'PERSON_UPDATED', 'PERSON_DELETED', 'CONTRACT_CREATED', 'CONTRACT_UPDATED', 'CONTRACT_CANCELLED', 'CONTRACT_DEFAULTED', 'CONTRACT_COMPLETED', 'CONTRACT_REOPENED', 'DISBURSEMENT_CREATED', 'DISBURSEMENT_REVERSED', 'PAYMENT_CREATED', 'PAYMENT_REVERSED', 'PAYMENT_CORRECTED', 'PAYMENT_ALLOCATED', 'PAYMENT_UNALLOCATED', 'SCHEDULE_MARKED_MISSED', 'RECONCILIATION_RUN', 'SETTINGS_UPDATED', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT');

-- CreateEnum
CREATE TYPE "ReconciliationTrigger" AS ENUM ('CRON', 'DASHBOARD', 'MANUAL');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'ADMIN',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "lastSeenAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMPTZ(3),
    "ipAddress" TEXT,
    "userAgent" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "id" UUID NOT NULL,
    "identifier" TEXT NOT NULL,
    "ipAddress" TEXT,
    "succeeded" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "people" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "alternatePhone" TEXT,
    "address" TEXT,
    "notes" TEXT,
    "status" "PersonStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),

    CONSTRAINT "people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contracts" (
    "id" UUID NOT NULL,
    "contractNumber" SERIAL NOT NULL,
    "personId" UUID NOT NULL,
    "principalAmount" INTEGER NOT NULL,
    "dailyCollectionAmount" INTEGER NOT NULL,
    "totalCollectionDays" INTEGER NOT NULL,
    "expectedCollectionAmount" INTEGER NOT NULL,
    "startDate" DATE NOT NULL,
    "firstCollectionDate" DATE NOT NULL,
    "expectedEndDate" DATE NOT NULL,
    "allocationPolicy" "AllocationPolicy" NOT NULL DEFAULT 'OLDEST_FIRST',
    "status" "ContractStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "notes" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "defaultedAt" TIMESTAMPTZ(3),

    CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "disbursements" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "disbursedOn" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedAt" TIMESTAMPTZ(3),
    "reversalReason" TEXT,

    CONSTRAINT "disbursements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_schedules" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "expectedAmount" INTEGER NOT NULL,
    "allocatedAmount" INTEGER NOT NULL DEFAULT 0,
    "status" "ScheduleStatus" NOT NULL DEFAULT 'PENDING',
    "missedAt" TIMESTAMPTZ(3),
    "shortfallAtClose" INTEGER,
    "settledAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "collection_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "paymentDate" DATE NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentMethod" "PaymentMethod" NOT NULL,
    "referenceNumber" TEXT,
    "notes" TEXT,
    "status" "TransactionStatus" NOT NULL DEFAULT 'ACTIVE',
    "idempotencyKey" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "reversedAt" TIMESTAMPTZ(3),
    "reversedById" UUID,
    "reversalReason" TEXT,
    "correctsPaymentId" UUID,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocation_runs" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "trigger" "AllocationTrigger" NOT NULL,
    "triggerPaymentId" UUID,
    "policy" "AllocationPolicy" NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "voidedCount" INTEGER NOT NULL,
    "summary" JSONB NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "allocation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "paymentId" UUID NOT NULL,
    "scheduleId" UUID NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdRunId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMPTZ(3),
    "voidedRunId" UUID,
    "voidReason" TEXT,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" UUID NOT NULL,
    "contractId" UUID NOT NULL,
    "personId" UUID NOT NULL,
    "entryType" "LedgerEntryType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "memoAmount" INTEGER,
    "effectiveDate" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "paymentId" UUID,
    "disbursementId" UUID,
    "scheduleId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "action" "AuditAction" NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "personId" UUID,
    "contractId" UUID,
    "description" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "metadata" JSONB,
    "dedupeKey" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" UUID NOT NULL,
    "trigger" "ReconciliationTrigger" NOT NULL,
    "closedThrough" DATE NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    "contractsChecked" INTEGER NOT NULL DEFAULT 0,
    "schedulesMarkedMissed" INTEGER NOT NULL DEFAULT 0,
    "schedulesUpdated" INTEGER NOT NULL DEFAULT 0,
    "contractsCompleted" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_settings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "businessName" TEXT NOT NULL DEFAULT 'ARTI FINANCE',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "defaultPaymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "dayCutoffTime" TEXT NOT NULL DEFAULT '23:59',
    "defaultAllocationPolicy" "AllocationPolicy" NOT NULL DEFAULT 'OLDEST_FIRST',
    "notificationPrefs" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "updatedById" UUID,

    CONSTRAINT "business_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE INDEX "login_attempts_identifier_createdAt_idx" ON "login_attempts"("identifier", "createdAt");

-- CreateIndex
CREATE INDEX "login_attempts_ipAddress_createdAt_idx" ON "login_attempts"("ipAddress", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "people_slug_key" ON "people"("slug");

-- CreateIndex
CREATE INDEX "people_phoneNumber_idx" ON "people"("phoneNumber");

-- CreateIndex
CREATE INDEX "people_fullName_idx" ON "people"("fullName");

-- CreateIndex
CREATE INDEX "people_status_idx" ON "people"("status");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_contractNumber_key" ON "contracts"("contractNumber");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_idempotencyKey_key" ON "contracts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "contracts_personId_idx" ON "contracts"("personId");

-- CreateIndex
CREATE INDEX "contracts_status_idx" ON "contracts"("status");

-- CreateIndex
CREATE INDEX "contracts_expectedEndDate_idx" ON "contracts"("expectedEndDate");

-- CreateIndex
CREATE UNIQUE INDEX "contracts_id_personId_key" ON "contracts"("id", "personId");

-- CreateIndex
CREATE INDEX "disbursements_contractId_idx" ON "disbursements"("contractId");

-- CreateIndex
CREATE INDEX "disbursements_personId_idx" ON "disbursements"("personId");

-- CreateIndex
CREATE INDEX "disbursements_disbursedOn_idx" ON "disbursements"("disbursedOn");

-- CreateIndex
CREATE INDEX "collection_schedules_scheduledDate_status_idx" ON "collection_schedules"("scheduledDate", "status");

-- CreateIndex
CREATE INDEX "collection_schedules_status_idx" ON "collection_schedules"("status");

-- CreateIndex
CREATE UNIQUE INDEX "collection_schedules_contractId_sequence_key" ON "collection_schedules"("contractId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "collection_schedules_contractId_scheduledDate_key" ON "collection_schedules"("contractId", "scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "collection_schedules_id_contractId_key" ON "collection_schedules"("id", "contractId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotencyKey_key" ON "payments"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "payments_correctsPaymentId_key" ON "payments"("correctsPaymentId");

-- CreateIndex
CREATE INDEX "payments_contractId_status_paymentDate_idx" ON "payments"("contractId", "status", "paymentDate");

-- CreateIndex
CREATE INDEX "payments_personId_idx" ON "payments"("personId");

-- CreateIndex
CREATE INDEX "payments_paymentDate_idx" ON "payments"("paymentDate");

-- CreateIndex
CREATE INDEX "payments_referenceNumber_idx" ON "payments"("referenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_id_contractId_key" ON "payments"("id", "contractId");

-- CreateIndex
CREATE INDEX "allocation_runs_contractId_createdAt_idx" ON "allocation_runs"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "payment_allocations_contractId_idx" ON "payment_allocations"("contractId");

-- CreateIndex
CREATE INDEX "payment_allocations_paymentId_idx" ON "payment_allocations"("paymentId");

-- CreateIndex
CREATE INDEX "payment_allocations_scheduleId_idx" ON "payment_allocations"("scheduleId");

-- CreateIndex
CREATE INDEX "ledger_entries_contractId_effectiveDate_idx" ON "ledger_entries"("contractId", "effectiveDate");

-- CreateIndex
CREATE INDEX "ledger_entries_personId_effectiveDate_idx" ON "ledger_entries"("personId", "effectiveDate");

-- CreateIndex
CREATE INDEX "ledger_entries_effectiveDate_idx" ON "ledger_entries"("effectiveDate");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_entryType_paymentId_key" ON "ledger_entries"("entryType", "paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_entryType_disbursementId_key" ON "ledger_entries"("entryType", "disbursementId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_entryType_scheduleId_key" ON "ledger_entries"("entryType", "scheduleId");

-- CreateIndex
CREATE UNIQUE INDEX "audit_logs_dedupeKey_key" ON "audit_logs"("dedupeKey");

-- CreateIndex
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_action_timestamp_idx" ON "audit_logs"("action", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_userId_timestamp_idx" ON "audit_logs"("userId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_personId_timestamp_idx" ON "audit_logs"("personId", "timestamp");

-- CreateIndex
CREATE INDEX "audit_logs_contractId_timestamp_idx" ON "audit_logs"("contractId", "timestamp");

-- CreateIndex
CREATE INDEX "reconciliation_runs_startedAt_idx" ON "reconciliation_runs"("startedAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "people" ADD CONSTRAINT "people_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_contractId_personId_fkey" FOREIGN KEY ("contractId", "personId") REFERENCES "contracts"("id", "personId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_schedules" ADD CONSTRAINT "collection_schedules_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_contractId_personId_fkey" FOREIGN KEY ("contractId", "personId") REFERENCES "contracts"("id", "personId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_correctsPaymentId_fkey" FOREIGN KEY ("correctsPaymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_triggerPaymentId_fkey" FOREIGN KEY ("triggerPaymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocation_runs" ADD CONSTRAINT "allocation_runs_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_paymentId_contractId_fkey" FOREIGN KEY ("paymentId", "contractId") REFERENCES "payments"("id", "contractId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_scheduleId_contractId_fkey" FOREIGN KEY ("scheduleId", "contractId") REFERENCES "collection_schedules"("id", "contractId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_createdRunId_fkey" FOREIGN KEY ("createdRunId") REFERENCES "allocation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_voidedRunId_fkey" FOREIGN KEY ("voidedRunId") REFERENCES "allocation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_contractId_personId_fkey" FOREIGN KEY ("contractId", "personId") REFERENCES "contracts"("id", "personId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_personId_fkey" FOREIGN KEY ("personId") REFERENCES "people"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_disbursementId_fkey" FOREIGN KEY ("disbursementId") REFERENCES "disbursements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "collection_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_settings" ADD CONSTRAINT "business_settings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ═══ Appended from prisma/sql/invariants.sql ═══
-- ════════════════════════════════════════════════════════════════════════
-- ARTI FINANCE — database-enforced financial invariants
--
-- Prisma cannot express CHECK constraints, partial indexes or triggers, so
-- they live here and are appended to the initial migration. The application
-- also validates everything, but the database is the last line of defence:
-- even a buggy code path or a hand-written SQL session cannot break these.
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
