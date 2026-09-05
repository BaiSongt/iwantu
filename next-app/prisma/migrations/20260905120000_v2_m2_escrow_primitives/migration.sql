-- V2-M2-04: strengthen Escrow from status-only evidence to exact ledger evidence.
-- Contract remains an opaque protocol reference until the protocol-native Contract
-- model is introduced. These invariants bind Escrow lifecycle changes to exact
-- IWC movements without introducing a premature Contract foreign key.

CREATE OR REPLACE FUNCTION validate_escrow_change()
RETURNS trigger AS $$
DECLARE
  buyer_principal_id TEXT;
  buyer_account_type "LedgerAccountType";
  buyer_account_currency TEXT;
  locked_account_id TEXT;
  tx_status "LedgerTransactionStatus";
  tx_type "LedgerTransactionType";
  tx_reference_type TEXT;
  tx_reference_id TEXT;
  entry_count INTEGER;
  matched_count INTEGER;
  debit_amount DECIMAL(36,8);
  credit_amount DECIMAL(36,8);
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Escrow is protocol evidence and cannot be deleted'
      USING ERRCODE = '23514';
  END IF;

  SELECT "principalId", "type", "currency"
    INTO buyer_principal_id, buyer_account_type, buyer_account_currency
  FROM "ledger_accounts"
  WHERE "id" = NEW."buyerAccountId";

  IF buyer_principal_id IS NULL
     OR buyer_account_type IS DISTINCT FROM 'principal_available'
     OR buyer_account_currency IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION 'Escrow buyerAccountId must be the buyer Principal available account in the Escrow currency'
      USING ERRCODE = '23514';
  END IF;

  SELECT "id" INTO locked_account_id
  FROM "ledger_accounts"
  WHERE "principalId" = buyer_principal_id
    AND "type" = 'principal_locked'
    AND "currency" = NEW."currency";

  IF locked_account_id IS NULL THEN
    RAISE EXCEPTION 'Escrow buyer Principal must have a locked account in the Escrow currency'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT "status", "type", "referenceType", "referenceId"
      INTO tx_status, tx_type, tx_reference_type, tx_reference_id
    FROM "ledger_transactions"
    WHERE "id" = NEW."lockLedgerTransactionId";

    IF tx_status IS DISTINCT FROM 'posted'
       OR tx_type IS DISTINCT FROM 'contract_escrow'
       OR tx_reference_type IS DISTINCT FROM 'escrow_lock'
       OR tx_reference_id IS DISTINCT FROM NEW."contractId" THEN
      RAISE EXCEPTION 'Escrow lock transaction identity/type/reference is invalid'
        USING ERRCODE = '23514';
    END IF;

    SELECT
      count(*)::INTEGER,
      count(*) FILTER (
        WHERE ("side" = 'debit' AND "accountId" = NEW."buyerAccountId")
           OR ("side" = 'credit' AND "accountId" = locked_account_id)
      )::INTEGER,
      COALESCE(sum(CASE
        WHEN "side" = 'debit' AND "accountId" = NEW."buyerAccountId" THEN "amount"
        ELSE 0
      END), 0),
      COALESCE(sum(CASE
        WHEN "side" = 'credit' AND "accountId" = locked_account_id THEN "amount"
        ELSE 0
      END), 0)
    INTO entry_count, matched_count, debit_amount, credit_amount
    FROM "ledger_entries"
    WHERE "transactionId" = NEW."lockLedgerTransactionId";

    IF entry_count <> 2
       OR matched_count <> 2
       OR debit_amount <> NEW."amount"
       OR credit_amount <> NEW."amount" THEN
      RAISE EXCEPTION 'Escrow lock must move exactly the Escrow amount from buyer available to buyer locked'
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
    SELECT "status", "type", "referenceType", "referenceId"
      INTO tx_status, tx_type, tx_reference_type, tx_reference_id
    FROM "ledger_transactions"
    WHERE "id" = NEW."releaseLedgerTransactionId";

    IF tx_status IS DISTINCT FROM 'posted'
       OR tx_type IS DISTINCT FROM 'settlement'
       OR tx_reference_type IS DISTINCT FROM 'escrow_release'
       OR tx_reference_id IS DISTINCT FROM NEW."contractId" THEN
      RAISE EXCEPTION 'Escrow release transaction identity/type/reference is invalid'
        USING ERRCODE = '23514';
    END IF;

    SELECT
      count(*)::INTEGER,
      count(*) FILTER (
        WHERE (e."side" = 'debit' AND e."accountId" = locked_account_id)
           OR (
             e."side" = 'credit'
             AND a."type" = 'principal_available'
             AND a."principalId" IS NOT NULL
             AND a."currency" = NEW."currency"
           )
      )::INTEGER,
      COALESCE(sum(CASE
        WHEN e."side" = 'debit' AND e."accountId" = locked_account_id THEN e."amount"
        ELSE 0
      END), 0),
      COALESCE(sum(CASE
        WHEN e."side" = 'credit'
         AND a."type" = 'principal_available'
         AND a."principalId" IS NOT NULL
         AND a."currency" = NEW."currency" THEN e."amount"
        ELSE 0
      END), 0)
    INTO entry_count, matched_count, debit_amount, credit_amount
    FROM "ledger_entries" e
    JOIN "ledger_accounts" a ON a."id" = e."accountId"
    WHERE e."transactionId" = NEW."releaseLedgerTransactionId";

    IF entry_count <> 2
       OR matched_count <> 2
       OR debit_amount <> NEW."amount"
       OR credit_amount <> NEW."amount" THEN
      RAISE EXCEPTION 'Escrow release must move exactly the Escrow amount from buyer locked to a Principal available account'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    SELECT "status", "type", "referenceType", "referenceId"
      INTO tx_status, tx_type, tx_reference_type, tx_reference_id
    FROM "ledger_transactions"
    WHERE "id" = NEW."refundLedgerTransactionId";

    IF tx_status IS DISTINCT FROM 'posted'
       OR tx_type IS DISTINCT FROM 'refund'
       OR tx_reference_type IS DISTINCT FROM 'escrow_refund'
       OR tx_reference_id IS DISTINCT FROM NEW."contractId" THEN
      RAISE EXCEPTION 'Escrow refund transaction identity/type/reference is invalid'
        USING ERRCODE = '23514';
    END IF;

    SELECT
      count(*)::INTEGER,
      count(*) FILTER (
        WHERE ("side" = 'debit' AND "accountId" = locked_account_id)
           OR ("side" = 'credit' AND "accountId" = NEW."buyerAccountId")
      )::INTEGER,
      COALESCE(sum(CASE
        WHEN "side" = 'debit' AND "accountId" = locked_account_id THEN "amount"
        ELSE 0
      END), 0),
      COALESCE(sum(CASE
        WHEN "side" = 'credit' AND "accountId" = NEW."buyerAccountId" THEN "amount"
        ELSE 0
      END), 0)
    INTO entry_count, matched_count, debit_amount, credit_amount
    FROM "ledger_entries"
    WHERE "transactionId" = NEW."refundLedgerTransactionId";

    IF entry_count <> 2
       OR matched_count <> 2
       OR debit_amount <> NEW."amount"
       OR credit_amount <> NEW."amount" THEN
      RAISE EXCEPTION 'Escrow refund must return exactly the Escrow amount from buyer locked to buyer available'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
