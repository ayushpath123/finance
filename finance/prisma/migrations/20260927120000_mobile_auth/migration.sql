-- ═══════════════════════════════════════════════════════════════════════
-- Mobile-number + password authentication for administrators.
--
-- Hand-written (not the Prisma diff) so that:
--   * audit action LOGIN is RENAMED to LOGIN_SUCCESS in place — existing
--     append-only audit rows keep their meaning and are never rewritten;
--   * a database that already has email-based users fails loudly instead of
--     silently producing accounts without a login identifier.
-- ═══════════════════════════════════════════════════════════════════════

-- ── Audit actions ──────────────────────────────────────────────────────
ALTER TYPE "AuditAction" RENAME VALUE 'LOGIN' TO 'LOGIN_SUCCESS';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSWORD_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_DISABLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'ACCOUNT_ENABLED';

-- ── Users: email/name → mobileNumber ────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users") THEN
    RAISE EXCEPTION 'users table is not empty: assign mobile numbers to existing accounts manually before applying this migration';
  END IF;
END $$;

DROP INDEX "users_email_key";
ALTER TABLE "users"
  DROP COLUMN "email",
  DROP COLUMN "name",
  ADD COLUMN "mobileNumber" TEXT NOT NULL,
  ADD COLUMN "lastLoginAt" TIMESTAMPTZ(3);
CREATE UNIQUE INDEX "users_mobileNumber_key" ON "users"("mobileNumber");

-- Only canonical Indian mobile numbers (lib/auth/mobile.ts) — formatting variants can't create duplicates.
ALTER TABLE "users" ADD CONSTRAINT "users_mobile_canonical" CHECK ("mobileNumber" ~ '^[6-9][0-9]{9}$');
-- A plaintext password can never be stored: the column only accepts Argon2id PHC strings.
ALTER TABLE "users" ADD CONSTRAINT "users_password_is_argon2id" CHECK ("passwordHash" LIKE '$argon2id$v=19$%');

-- ── Sessions ───────────────────────────────────────────────────────────
ALTER TABLE "sessions" ADD COLUMN "revokedReason" TEXT;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_revocation_consistent"
  CHECK (("revokedAt" IS NULL) = ("revokedReason" IS NULL));

-- ── Who cancelled / who reversed ─────────────────────────────────────────
ALTER TABLE "contracts" ADD COLUMN "cancelledById" UUID;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_cancelledById_fkey"
  FOREIGN KEY ("cancelledById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts" ADD CONSTRAINT "contracts_cancelled_by_consistent"
  CHECK ("cancelledById" IS NULL OR "cancelledAt" IS NOT NULL);

ALTER TABLE "disbursements" ADD COLUMN "reversedById" UUID;
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_reversedById_fkey"
  FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disbursements" ADD CONSTRAINT "disbursements_reversed_by_consistent"
  CHECK ("reversedById" IS NULL OR "status" = 'REVERSED');

-- cancelledById is history, like cancelledAt.
CREATE OR REPLACE FUNCTION af_contracts_cancelled_by_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."cancelledById" IS NOT NULL AND NEW."cancelledById" IS DISTINCT FROM OLD."cancelledById" THEN
    RAISE EXCEPTION 'Contract % cancelledById is permanent history', OLD."id"
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER "contracts_cancelled_by_guard"
  BEFORE UPDATE ON "contracts"
  FOR EACH ROW EXECUTE FUNCTION af_contracts_cancelled_by_guard();
