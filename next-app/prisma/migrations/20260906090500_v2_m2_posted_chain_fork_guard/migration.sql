-- V2 M2 closure hardening: draft ledger work must not reserve a chain predecessor.
-- Only posted transactions participate in the immutable ledger chain.
DROP INDEX IF EXISTS "ledger_transactions_previousHash_unique_nonnull";

CREATE UNIQUE INDEX "ledger_transactions_previousHash_unique_posted"
ON "ledger_transactions"("previousHash")
WHERE "previousHash" IS NOT NULL AND "status" = 'posted';
