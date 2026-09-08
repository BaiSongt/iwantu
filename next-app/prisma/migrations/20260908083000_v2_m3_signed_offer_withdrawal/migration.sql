CREATE TABLE "offer_withdrawal_receipts" (
  "id" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "offerRevision" INTEGER NOT NULL,
  "offerHash" TEXT NOT NULL,
  "withdrawalHash" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "supplierPrincipalId" TEXT NOT NULL,
  "supplierAgentIdentityId" TEXT NOT NULL,
  "authoritySnapshotId" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "signatureAlgorithm" TEXT NOT NULL,
  "signingKeyId" TEXT NOT NULL,
  "supplierSignature" TEXT NOT NULL,
  "receiptHash" TEXT NOT NULL,
  "withdrawnAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "offer_withdrawal_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "offer_withdrawal_receipts_offerId_fkey"
    FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "offer_withdrawal_receipts_authoritySnapshotId_fkey"
    FOREIGN KEY ("authoritySnapshotId") REFERENCES "authority_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "offer_withdrawal_receipts_offerId_key"
  ON "offer_withdrawal_receipts"("offerId");
CREATE UNIQUE INDEX "offer_withdrawal_receipts_nonce_key"
  ON "offer_withdrawal_receipts"("nonce");
CREATE UNIQUE INDEX "offer_withdrawal_receipts_withdrawalHash_key"
  ON "offer_withdrawal_receipts"("withdrawalHash");
CREATE UNIQUE INDEX "offer_withdrawal_receipts_commandHash_key"
  ON "offer_withdrawal_receipts"("commandHash");
CREATE UNIQUE INDEX "offer_withdrawal_receipts_receiptHash_key"
  ON "offer_withdrawal_receipts"("receiptHash");
CREATE INDEX "offer_withdrawal_receipts_supplierPrincipalId_withdrawnAt_idx"
  ON "offer_withdrawal_receipts"("supplierPrincipalId", "withdrawnAt");

CREATE OR REPLACE FUNCTION "iwantu_offer_withdrawal_receipt_immutable"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'offer withdrawal receipts are append-only immutable evidence';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "offer_withdrawal_receipts_no_update"
BEFORE UPDATE ON "offer_withdrawal_receipts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_offer_withdrawal_receipt_immutable"();

CREATE TRIGGER "offer_withdrawal_receipts_no_delete"
BEFORE DELETE ON "offer_withdrawal_receipts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_offer_withdrawal_receipt_immutable"();
