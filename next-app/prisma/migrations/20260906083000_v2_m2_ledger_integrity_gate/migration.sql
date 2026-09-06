-- V2-M2-05: each non-root ledger hash may have at most one successor.
-- Application posting serializes the global head before assigning previousHash.
CREATE UNIQUE INDEX "ledger_transactions_previousHash_unique_nonnull"
ON "ledger_transactions"("previousHash")
WHERE "previousHash" IS NOT NULL;
