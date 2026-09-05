-- V2-M2-01: strict IWC double-entry ledger foundation.
--
-- Design rules:
-- 1. Ledger is the economic source of truth; no mutable Principal.balance.
-- 2. Transactions begin as draft, accumulate append-only entries, then finalize
--    exactly once to posted.
-- 3. Posting is rejected unless the transaction has >= 2 positive entries and
--    total debit = total credit.
-- 4. Posted transactions and all ledger entries are immutable.
-- 5. First-stage currency is closed-loop IWC only.

CREATE TYPE "LedgerAccountType" AS ENUM (
  'principal_available',
  'principal_locked',
  'principal_pending',
  'system_reserve',
  'system_clearing',
  'system_fee',
  'system_incentive'
);

CREATE TYPE "LedgerAccountStatus" AS ENUM ('active', 'frozen', 'closed');
CREATE TYPE "LedgerTransactionStatus" AS ENUM ('draft', 'posted');
CREATE TYPE "LedgerEntrySide" AS ENUM ('debit', 'credit');
CREATE TYPE "EscrowStatus" AS ENUM ('locked', 'released', 'refunded');

CREATE TYPE "LedgerTransactionType" AS ENUM (
  'genesis',
  'purchased_credit',
  'contract_escrow',
  'settlement',
  'refund',
  'protocol_fee',
  'incentive',
  'penalty',
  'reserve'
);

CREATE TABLE "ledger_accounts" (
  "id" TEXT NOT NULL,
  "principalId" TEXT,
  "type" "LedgerAccountType" NOT NULL,
  "status" "LedgerAccountStatus" NOT NULL DEFAULT 'active',
  "currency" TEXT NOT NULL DEFAULT 'IWC',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "closedAt" TIMESTAMP(3),
  CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_transactions" (
  "id" TEXT NOT NULL,
  "type" "LedgerTransactionType" NOT NULL,
  "status" "LedgerTransactionStatus" NOT NULL DEFAULT 'draft',
  "referenceType" TEXT NOT NULL,
  "referenceId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "metadata" JSONB,
  "previousHash" TEXT,
  "transactionHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "postedAt" TIMESTAMP(3),
  CONSTRAINT "ledger_transactions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ledger_entries" (
  "id" TEXT NOT NULL,
  "transactionId" TEXT NOT NULL,
  "entryIndex" INTEGER NOT NULL,
  "accountId" TEXT NOT NULL,
  "side" "LedgerEntrySide" NOT NULL,
  "amount" DECIMAL(36,8) NOT NULL,
  "provenance" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- Contract is introduced in M3+. contractId is deliberately an opaque protocol
-- reference for now; a foreign key can be added atomically when Contract exists.
CREATE TABLE "escrows" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "buyerAccountId" TEXT NOT NULL,
  "amount" DECIMAL(36,8) NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'IWC',
  "status" "EscrowStatus" NOT NULL DEFAULT 'locked',
  "lockLedgerTransactionId" TEXT NOT NULL,
  "releaseLedgerTransactionId" TEXT,
  "refundLedgerTransactionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "refundedAt" TIMESTAMP(3),
  CONSTRAINT "escrows_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ledger_accounts_principalId_type_currency_key"
ON "ledger_accounts"("principalId", "type", "currency");

-- PostgreSQL UNIQUE treats NULLs as distinct. System accounts have no Principal,
-- so enforce one system account per type/currency with a partial unique index.
CREATE UNIQUE INDEX "ledger_accounts_system_type_currency_key"
ON "ledger_accounts"("type", "currency") WHERE "principalId" IS NULL;

CREATE INDEX "ledger_accounts_principalId_status_idx"
ON "ledger_accounts"("principalId", "status");
CREATE INDEX "ledger_accounts_type_status_idx"
ON "ledger_accounts"("type", "status");

CREATE UNIQUE INDEX "ledger_transactions_idempotencyKey_key"
ON "ledger_transactions"("idempotencyKey");
CREATE UNIQUE INDEX "ledger_transactions_transactionHash_key"
ON "ledger_transactions"("transactionHash");
CREATE INDEX "ledger_transactions_referenceType_referenceId_idx"
ON "ledger_transactions"("referenceType", "referenceId");
CREATE INDEX "ledger_transactions_type_status_createdAt_idx"
ON "ledger_transactions"("type", "status", "createdAt");
CREATE INDEX "ledger_transactions_previousHash_idx"
ON "ledger_transactions"("previousHash");

CREATE UNIQUE INDEX "ledger_entries_transactionId_entryIndex_key"
ON "ledger_entries"("transactionId", "entryIndex");
CREATE INDEX "ledger_entries_accountId_createdAt_idx"
ON "ledger_entries"("accountId", "createdAt");
CREATE INDEX "ledger_entries_transactionId_side_idx"
ON "ledger_entries"("transactionId", "side");

CREATE UNIQUE INDEX "escrows_contractId_key" ON "escrows"("contractId");
CREATE UNIQUE INDEX "escrows_lockLedgerTransactionId_key"
ON "escrows"("lockLedgerTransactionId");
CREATE UNIQUE INDEX "escrows_releaseLedgerTransactionId_key"
ON "escrows"("releaseLedgerTransactionId");
CREATE UNIQUE INDEX "escrows_refundLedgerTransactionId_key"
ON "escrows"("refundLedgerTransactionId");
CREATE INDEX "escrows_buyerAccountId_status_idx"
ON "escrows"("buyerAccountId", "status");
CREATE INDEX "escrows_status_createdAt_idx"
ON "escrows"("status", "createdAt");

ALTER TABLE "ledger_accounts"
ADD CONSTRAINT "ledger_accounts_principalId_fkey"
FOREIGN KEY ("principalId") REFERENCES "principals"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
ADD CONSTRAINT "ledger_entries_transactionId_fkey"
FOREIGN KEY ("transactionId") REFERENCES "ledger_transactions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_entries"
ADD CONSTRAINT "ledger_entries_accountId_fkey"
FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "escrows"
ADD CONSTRAINT "escrows_buyerAccountId_fkey"
FOREIGN KEY ("buyerAccountId") REFERENCES "ledger_accounts"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "escrows"
ADD CONSTRAINT "escrows_lockLedgerTransactionId_fkey"
FOREIGN KEY ("lockLedgerTransactionId") REFERENCES "ledger_transactions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "escrows"
ADD CONSTRAINT "escrows_releaseLedgerTransactionId_fkey"
FOREIGN KEY ("releaseLedgerTransactionId") REFERENCES "ledger_transactions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "escrows"
ADD CONSTRAINT "escrows_refundLedgerTransactionId_fkey"
FOREIGN KEY ("refundLedgerTransactionId") REFERENCES "ledger_transactions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ledger_accounts"
ADD CONSTRAINT "ledger_accounts_currency_check" CHECK ("currency" = 'IWC');

ALTER TABLE "ledger_accounts"
ADD CONSTRAINT "ledger_accounts_owner_shape_check" CHECK (
  (
    "type" IN ('principal_available', 'principal_locked', 'principal_pending')
    AND "principalId" IS NOT NULL
  ) OR (
    "type" IN ('system_reserve', 'system_clearing', 'system_fee', 'system_incentive')
    AND "principalId" IS NULL
  )
);

ALTER TABLE "ledger_accounts"
ADD CONSTRAINT "ledger_accounts_closed_state_check" CHECK (
  ("status" = 'closed' AND "closedAt" IS NOT NULL)
  OR ("status" <> 'closed' AND "closedAt" IS NULL)
);

ALTER TABLE "ledger_transactions"
ADD CONSTRAINT "ledger_transactions_nonempty_check" CHECK (
  length("referenceType") > 0
  AND length("referenceId") > 0
  AND length("idempotencyKey") > 0
);

ALTER TABLE "ledger_transactions"
ADD CONSTRAINT "ledger_transactions_hash_format_check" CHECK (
  ("previousHash" IS NULL OR "previousHash" ~ '^[0-9a-f]{64}$')
  AND ("transactionHash" IS NULL OR "transactionHash" ~ '^[0-9a-f]{64}$')
);

ALTER TABLE "ledger_transactions"
ADD CONSTRAINT "ledger_transactions_posted_shape_check" CHECK (
  ("status" = 'draft' AND "postedAt" IS NULL AND "transactionHash" IS NULL)
  OR ("status" = 'posted' AND "postedAt" IS NOT NULL AND "transactionHash" IS NOT NULL)
);

ALTER TABLE "ledger_entries"
ADD CONSTRAINT "ledger_entries_positive_amount_check" CHECK ("amount" > 0);

ALTER TABLE "ledger_entries"
ADD CONSTRAINT "ledger_entries_entry_index_check" CHECK ("entryIndex" >= 0);

ALTER TABLE "escrows"
ADD CONSTRAINT "escrows_nonempty_contract_check" CHECK (length("contractId") > 0);

ALTER TABLE "escrows"
ADD CONSTRAINT "escrows_amount_currency_check" CHECK (
  "amount" > 0 AND "currency" = 'IWC'
);

ALTER TABLE "escrows"
ADD CONSTRAINT "escrows_lifecycle_shape_check" CHECK (
  (
    "status" = 'locked'
    AND "releaseLedgerTransactionId" IS NULL
    AND "refundLedgerTransactionId" IS NULL
    AND "releasedAt" IS NULL
    AND "refundedAt" IS NULL
  ) OR (
    "status" = 'released'
    AND "releaseLedgerTransactionId" IS NOT NULL
    AND "refundLedgerTransactionId" IS NULL
    AND "releasedAt" IS NOT NULL
    AND "refundedAt" IS NULL
  ) OR (
    "status" = 'refunded'
    AND "releaseLedgerTransactionId" IS NULL
    AND "refundLedgerTransactionId" IS NOT NULL
    AND "releasedAt" IS NULL
    AND "refundedAt" IS NOT NULL
  )
);

CREATE OR REPLACE FUNCTION validate_ledger_account_change()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LedgerAccount cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."principalId" IS DISTINCT FROM NEW."principalId"
     OR OLD."type" IS DISTINCT FROM NEW."type"
     OR OLD."currency" IS DISTINCT FROM NEW."currency"
     OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'LedgerAccount ownership/type/currency identity is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'closed' AND NEW."status" <> 'closed' THEN
    RAISE EXCEPTION 'Closed LedgerAccount cannot be reactivated'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_accounts_validate_update"
BEFORE UPDATE ON "ledger_accounts"
FOR EACH ROW EXECUTE FUNCTION validate_ledger_account_change();

CREATE TRIGGER "ledger_accounts_prevent_delete"
BEFORE DELETE ON "ledger_accounts"
FOR EACH ROW EXECUTE FUNCTION validate_ledger_account_change();

CREATE OR REPLACE FUNCTION validate_ledger_entry_insert()
RETURNS trigger AS $$
DECLARE
  parent_status "LedgerTransactionStatus";
BEGIN
  SELECT "status" INTO parent_status
  FROM "ledger_transactions"
  WHERE "id" = NEW."transactionId"
  FOR UPDATE;

  IF parent_status IS NULL THEN
    RAISE EXCEPTION 'LedgerEntry parent transaction does not exist'
      USING ERRCODE = '23503';
  END IF;

  IF parent_status <> 'draft' THEN
    RAISE EXCEPTION 'LedgerEntry can only be appended to a draft transaction'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entries_validate_insert"
BEFORE INSERT ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION validate_ledger_entry_insert();

CREATE OR REPLACE FUNCTION prevent_ledger_entry_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'LedgerEntry is append-only and cannot be updated or deleted'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_entries_immutable_update"
BEFORE UPDATE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_change();

CREATE TRIGGER "ledger_entries_immutable_delete"
BEFORE DELETE ON "ledger_entries"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_change();

CREATE OR REPLACE FUNCTION validate_ledger_transaction_change()
RETURNS trigger AS $$
DECLARE
  entry_count INTEGER;
  debit_total DECIMAL(36,8);
  credit_total DECIMAL(36,8);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'LedgerTransaction is append-only and cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" = 'posted' THEN
    RAISE EXCEPTION 'Posted LedgerTransaction is immutable'
      USING ERRCODE = '23514';
  END IF;

  -- A draft transaction is immutable except for one finalization update.
  IF OLD."status" <> 'draft' OR NEW."status" <> 'posted' THEN
    RAISE EXCEPTION 'LedgerTransaction only supports draft to posted finalization'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."type" IS DISTINCT FROM NEW."type"
     OR OLD."referenceType" IS DISTINCT FROM NEW."referenceType"
     OR OLD."referenceId" IS DISTINCT FROM NEW."referenceId"
     OR OLD."idempotencyKey" IS DISTINCT FROM NEW."idempotencyKey"
     OR OLD."metadata" IS DISTINCT FROM NEW."metadata"
     OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'LedgerTransaction identity/metadata cannot change during posting'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    count(*)::INTEGER,
    COALESCE(sum(CASE WHEN "side" = 'debit' THEN "amount" ELSE 0 END), 0),
    COALESCE(sum(CASE WHEN "side" = 'credit' THEN "amount" ELSE 0 END), 0)
  INTO entry_count, debit_total, credit_total
  FROM "ledger_entries"
  WHERE "transactionId" = OLD."id";

  IF entry_count < 2 THEN
    RAISE EXCEPTION 'Posted LedgerTransaction requires at least two entries'
      USING ERRCODE = '23514';
  END IF;

  IF debit_total <> credit_total THEN
    RAISE EXCEPTION 'LedgerTransaction is not balanced: debit %, credit %', debit_total, credit_total
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "ledger_transactions_validate_posting"
BEFORE UPDATE ON "ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION validate_ledger_transaction_change();

CREATE TRIGGER "ledger_transactions_prevent_delete"
BEFORE DELETE ON "ledger_transactions"
FOR EACH ROW EXECUTE FUNCTION validate_ledger_transaction_change();

CREATE OR REPLACE FUNCTION validate_escrow_change()
RETURNS trigger AS $$
DECLARE
  buyer_account_principal TEXT;
  lock_status "LedgerTransactionStatus";
  lock_type "LedgerTransactionType";
  terminal_status "LedgerTransactionStatus";
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Escrow is protocol evidence and cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT "principalId" INTO buyer_account_principal
    FROM "ledger_accounts"
    WHERE "id" = NEW."buyerAccountId";

    IF buyer_account_principal IS NULL THEN
      RAISE EXCEPTION 'Escrow buyerAccountId must reference a Principal-owned account'
        USING ERRCODE = '23514';
    END IF;

    SELECT "status", "type" INTO lock_status, lock_type
    FROM "ledger_transactions"
    WHERE "id" = NEW."lockLedgerTransactionId";

    IF lock_status IS DISTINCT FROM 'posted'
       OR lock_type IS DISTINCT FROM 'contract_escrow' THEN
      RAISE EXCEPTION 'Escrow lock must reference a posted contract_escrow LedgerTransaction'
        USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
  END IF;

  IF OLD."contractId" IS DISTINCT FROM NEW."contractId"
     OR OLD."buyerAccountId" IS DISTINCT FROM NEW."buyerAccountId"
     OR OLD."amount" IS DISTINCT FROM NEW."amount"
     OR OLD."currency" IS DISTINCT FROM NEW."currency"
     OR OLD."lockLedgerTransactionId" IS DISTINCT FROM NEW."lockLedgerTransactionId"
     OR OLD."createdAt" IS DISTINCT FROM NEW."createdAt" THEN
    RAISE EXCEPTION 'Escrow identity/amount/lock evidence is immutable'
      USING ERRCODE = '23514';
  END IF;

  IF OLD."status" <> 'locked' OR NEW."status" NOT IN ('released', 'refunded') THEN
    RAISE EXCEPTION 'Escrow only supports locked to released/refunded transition'
      USING ERRCODE = '23514';
  END IF;

  IF NEW."status" = 'released' THEN
    SELECT "status" INTO terminal_status
    FROM "ledger_transactions"
    WHERE "id" = NEW."releaseLedgerTransactionId";
  ELSE
    SELECT "status" INTO terminal_status
    FROM "ledger_transactions"
    WHERE "id" = NEW."refundLedgerTransactionId";
  END IF;

  IF terminal_status IS DISTINCT FROM 'posted' THEN
    RAISE EXCEPTION 'Escrow terminal transition must reference a posted LedgerTransaction'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "escrows_validate_insert"
BEFORE INSERT ON "escrows"
FOR EACH ROW EXECUTE FUNCTION validate_escrow_change();

CREATE TRIGGER "escrows_validate_update"
BEFORE UPDATE ON "escrows"
FOR EACH ROW EXECUTE FUNCTION validate_escrow_change();

CREATE TRIGGER "escrows_prevent_delete"
BEFORE DELETE ON "escrows"
FOR EACH ROW EXECUTE FUNCTION validate_escrow_change();
