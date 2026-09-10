-- V2-M4-02: signed Buyer offer.accept entry gate.
-- A Contract may only be inserted when an immutable Buyer Acceptance receipt
-- binds the exact Firm Offer revision, live AuthoritySnapshot and command TTL.

CREATE TABLE "offer_acceptance_receipts" (
  "id" TEXT NOT NULL,
  "formationIdempotencyKey" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "taskRevision" INTEGER NOT NULL,
  "taskHash" TEXT NOT NULL,
  "offerId" TEXT NOT NULL,
  "offerRevisionId" TEXT NOT NULL,
  "offerRevision" INTEGER NOT NULL,
  "offerHash" TEXT NOT NULL,
  "acceptanceHash" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "buyerPrincipalId" TEXT NOT NULL,
  "buyerAgentIdentityId" TEXT NOT NULL,
  "supplierPrincipalId" TEXT NOT NULL,
  "authoritySnapshotId" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "signatureAlgorithm" TEXT NOT NULL,
  "signingKeyId" TEXT NOT NULL,
  "buyerSignature" TEXT NOT NULL,
  "commandIssuedAt" TIMESTAMP(3) NOT NULL,
  "commandExpiresAt" TIMESTAMP(3) NOT NULL,
  "receiptHash" TEXT NOT NULL,
  "acceptedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "offer_acceptance_receipts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "offer_acceptance_receipts_revision_positive" CHECK ("offerRevision" > 0),
  CONSTRAINT "offer_acceptance_receipts_task_revision_positive" CHECK ("taskRevision" > 0),
  CONSTRAINT "offer_acceptance_receipts_signature_present" CHECK (length("buyerSignature") > 0),
  CONSTRAINT "offer_acceptance_receipts_command_window" CHECK ("commandExpiresAt" > "commandIssuedAt"),
  CONSTRAINT "offer_acceptance_receipts_accepted_in_window" CHECK (
    "acceptedAt" >= "commandIssuedAt" AND "acceptedAt" < "commandExpiresAt"
  )
);

CREATE UNIQUE INDEX "offer_acceptance_receipts_formationIdempotencyKey_key"
  ON "offer_acceptance_receipts"("formationIdempotencyKey");
CREATE UNIQUE INDEX "offer_acceptance_receipts_offerRevisionId_key"
  ON "offer_acceptance_receipts"("offerRevisionId");
CREATE UNIQUE INDEX "offer_acceptance_receipts_acceptanceHash_key"
  ON "offer_acceptance_receipts"("acceptanceHash");
CREATE UNIQUE INDEX "offer_acceptance_receipts_commandHash_key"
  ON "offer_acceptance_receipts"("commandHash");
CREATE UNIQUE INDEX "offer_acceptance_receipts_authoritySnapshotId_key"
  ON "offer_acceptance_receipts"("authoritySnapshotId");
CREATE UNIQUE INDEX "offer_acceptance_receipts_nonce_key"
  ON "offer_acceptance_receipts"("nonce");
CREATE UNIQUE INDEX "offer_acceptance_receipts_receiptHash_key"
  ON "offer_acceptance_receipts"("receiptHash");
CREATE INDEX "offer_acceptance_receipts_taskId_acceptedAt_idx"
  ON "offer_acceptance_receipts"("taskId", "acceptedAt");
CREATE INDEX "offer_acceptance_receipts_buyerPrincipalId_acceptedAt_idx"
  ON "offer_acceptance_receipts"("buyerPrincipalId", "acceptedAt");

ALTER TABLE "offer_acceptance_receipts"
  ADD CONSTRAINT "offer_acceptance_receipts_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_acceptance_receipts"
  ADD CONSTRAINT "offer_acceptance_receipts_offerId_fkey"
  FOREIGN KEY ("offerId") REFERENCES "offers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_acceptance_receipts"
  ADD CONSTRAINT "offer_acceptance_receipts_offerRevisionId_fkey"
  FOREIGN KEY ("offerRevisionId") REFERENCES "offer_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_acceptance_receipts"
  ADD CONSTRAINT "offer_acceptance_receipts_buyerPrincipalId_fkey"
  FOREIGN KEY ("buyerPrincipalId") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_acceptance_receipts"
  ADD CONSTRAINT "offer_acceptance_receipts_buyerAgentIdentityId_fkey"
  FOREIGN KEY ("buyerAgentIdentityId") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_acceptance_receipts"
  ADD CONSTRAINT "offer_acceptance_receipts_supplierPrincipalId_fkey"
  FOREIGN KEY ("supplierPrincipalId") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "offer_acceptance_receipts"
  ADD CONSTRAINT "offer_acceptance_receipts_authoritySnapshotId_fkey"
  FOREIGN KEY ("authoritySnapshotId") REFERENCES "authority_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_validate_offer_acceptance_receipt"()
RETURNS trigger AS $$
DECLARE
  task_row RECORD;
  task_revision_row RECORD;
  offer_row RECORD;
  offer_revision_row RECORD;
  snapshot_row RECORD;
BEGIN
  SELECT "issuerPrincipalId", "issuerAgentIdentityId", "status", "currentRevision"
  INTO task_row
  FROM "tasks"
  WHERE "id" = NEW."taskId"
  FOR SHARE;

  IF NOT FOUND OR task_row.status <> 'open' THEN
    RAISE EXCEPTION 'ACCEPTANCE_REQUIRES_OPEN_TASK';
  END IF;
  IF task_row."issuerPrincipalId" <> NEW."buyerPrincipalId"
     OR task_row."issuerAgentIdentityId" <> NEW."buyerAgentIdentityId" THEN
    RAISE EXCEPTION 'ACCEPTANCE_BUYER_TASK_BINDING_MISMATCH';
  END IF;
  IF task_row."currentRevision" <> NEW."taskRevision" THEN
    RAISE EXCEPTION 'ACCEPTANCE_TASK_REVISION_NOT_CURRENT';
  END IF;

  SELECT "id", "contentHash", "sealedAt"
  INTO task_revision_row
  FROM "task_revisions"
  WHERE "taskId" = NEW."taskId" AND "revision" = NEW."taskRevision";
  IF NOT FOUND OR task_revision_row."sealedAt" IS NULL
     OR task_revision_row."contentHash" <> NEW."taskHash" THEN
    RAISE EXCEPTION 'ACCEPTANCE_TASK_SNAPSHOT_MISMATCH';
  END IF;

  SELECT "taskId", "supplierPrincipalId", "status", "currentRevision"
  INTO offer_row
  FROM "offers"
  WHERE "id" = NEW."offerId"
  FOR SHARE;
  IF NOT FOUND OR offer_row."taskId" <> NEW."taskId"
     OR offer_row."supplierPrincipalId" <> NEW."supplierPrincipalId" THEN
    RAISE EXCEPTION 'ACCEPTANCE_OFFER_BINDING_MISMATCH';
  END IF;
  IF offer_row.status <> 'active' OR offer_row."currentRevision" <> NEW."offerRevision" THEN
    RAISE EXCEPTION 'ACCEPTANCE_REQUIRES_CURRENT_ACTIVE_OFFER';
  END IF;

  SELECT "id", "revision", "taskRevisionId", "taskHash", "offerHash", "validUntil"
  INTO offer_revision_row
  FROM "offer_revisions"
  WHERE "id" = NEW."offerRevisionId";
  IF NOT FOUND
     OR offer_revision_row.revision <> NEW."offerRevision"
     OR offer_revision_row."taskRevisionId" <> task_revision_row.id
     OR offer_revision_row."taskHash" <> NEW."taskHash"
     OR offer_revision_row."offerHash" <> NEW."offerHash" THEN
    RAISE EXCEPTION 'ACCEPTANCE_OFFER_REVISION_MISMATCH';
  END IF;
  IF offer_revision_row."validUntil" <= NEW."acceptedAt" THEN
    RAISE EXCEPTION 'ACCEPTANCE_OFFER_EXPIRED';
  END IF;

  SELECT "principalId", "agentIdentityId", "resolvedAction", "requestEvidence"
  INTO snapshot_row
  FROM "authority_snapshots"
  WHERE "id" = NEW."authoritySnapshotId";
  IF NOT FOUND
     OR snapshot_row."principalId" <> NEW."buyerPrincipalId"
     OR snapshot_row."agentIdentityId" <> NEW."buyerAgentIdentityId"
     OR snapshot_row."resolvedAction" <> 'offer.accept'
     OR snapshot_row."requestEvidence" ->> 'action' IS DISTINCT FROM 'offer.accept'
     OR snapshot_row."requestEvidence" ->> 'payloadHash' IS DISTINCT FROM NEW."acceptanceHash"
     OR snapshot_row."requestEvidence" ->> 'commandHash' IS DISTINCT FROM NEW."commandHash"
     OR snapshot_row."requestEvidence" ->> 'nonce' IS DISTINCT FROM NEW."nonce"
     OR snapshot_row."requestEvidence" ->> 'signingKeyId' IS DISTINCT FROM NEW."signingKeyId"
     OR snapshot_row."requestEvidence" ->> 'signatureAlgorithm' IS DISTINCT FROM NEW."signatureAlgorithm" THEN
    RAISE EXCEPTION 'ACCEPTANCE_AUTHORITY_EVIDENCE_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "offer_acceptance_receipts_binding_guard"
BEFORE INSERT ON "offer_acceptance_receipts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_offer_acceptance_receipt"();

CREATE OR REPLACE FUNCTION "iwantu_prevent_offer_acceptance_receipt_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'OFFER_ACCEPTANCE_RECEIPT_IS_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "offer_acceptance_receipts_update_guard"
BEFORE UPDATE ON "offer_acceptance_receipts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_offer_acceptance_receipt_mutation"();
CREATE TRIGGER "offer_acceptance_receipts_delete_guard"
BEFORE DELETE ON "offer_acceptance_receipts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_offer_acceptance_receipt_mutation"();

CREATE OR REPLACE FUNCTION "iwantu_require_signed_buyer_acceptance"()
RETURNS trigger AS $$
DECLARE
  snapshot_row RECORD;
  acceptance_row RECORD;
BEGIN
  SELECT "requestEvidence"
  INTO snapshot_row
  FROM "authority_snapshots"
  WHERE "id" = NEW."buyerAuthoritySnapshotId";

  SELECT *
  INTO acceptance_row
  FROM "offer_acceptance_receipts"
  WHERE "authoritySnapshotId" = NEW."buyerAuthoritySnapshotId";

  IF NOT FOUND
     OR acceptance_row."formationIdempotencyKey" <> NEW."formationIdempotencyKey"
     OR acceptance_row."taskId" <> NEW."taskId"
     OR acceptance_row."offerRevisionId" <> NEW."acceptedOfferRevisionId"
     OR acceptance_row."offerHash" <> NEW."offerSnapshotHash"
     OR acceptance_row."buyerPrincipalId" <> NEW."buyerPrincipalId"
     OR acceptance_row."buyerAgentIdentityId" <> NEW."buyerAgentIdentityId"
     OR acceptance_row."supplierPrincipalId" <> NEW."supplierPrincipalId"
     OR acceptance_row."acceptanceHash" IS DISTINCT FROM snapshot_row."requestEvidence" ->> 'payloadHash'
     OR acceptance_row."commandHash" IS DISTINCT FROM snapshot_row."requestEvidence" ->> 'commandHash'
     OR acceptance_row."commandIssuedAt" > NEW."activatedAt"
     OR acceptance_row."commandExpiresAt" <= NEW."activatedAt" THEN
    RAISE EXCEPTION 'CONTRACT_SIGNED_BUYER_ACCEPTANCE_REQUIRED';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contracts_signed_buyer_acceptance_guard"
BEFORE INSERT ON "contracts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_require_signed_buyer_acceptance"();
