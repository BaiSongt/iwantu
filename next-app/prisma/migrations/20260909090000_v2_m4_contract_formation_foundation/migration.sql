-- V2-M4-01: Contract Formation persistence foundation.
-- This migration establishes protocol-native Contract truth and the database
-- uniqueness/immutability gates required before exposing ACCEPT_OFFER.

CREATE TYPE "ContractLifecycleState" AS ENUM (
  'active',
  'acceptance_pending',
  'rework',
  'disputed',
  'closed'
);

CREATE TABLE "contracts" (
  "id" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "acceptedOfferRevisionId" TEXT NOT NULL,
  "buyerPrincipalId" TEXT NOT NULL,
  "buyerAgentIdentityId" TEXT NOT NULL,
  "supplierPrincipalId" TEXT NOT NULL,
  "supplierAgentIdentityId" TEXT NOT NULL,
  "buyerAuthoritySnapshotId" TEXT NOT NULL,
  "supplierAuthoritySnapshotId" TEXT NOT NULL,
  "taskSnapshotHash" TEXT NOT NULL,
  "offerSnapshotHash" TEXT NOT NULL,
  "effectiveContractHash" TEXT NOT NULL,
  "formationIdempotencyKey" TEXT NOT NULL,
  "lifecycleState" "ContractLifecycleState" NOT NULL DEFAULT 'active',
  "escrowId" TEXT,
  "activatedAt" TIMESTAMP(3) NOT NULL,
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "contracts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "contracts_taskId_key" ON "contracts"("taskId");
CREATE UNIQUE INDEX "contracts_acceptedOfferRevisionId_key" ON "contracts"("acceptedOfferRevisionId");
CREATE UNIQUE INDEX "contracts_effectiveContractHash_key" ON "contracts"("effectiveContractHash");
CREATE UNIQUE INDEX "contracts_formationIdempotencyKey_key" ON "contracts"("formationIdempotencyKey");
CREATE UNIQUE INDEX "contracts_escrowId_key" ON "contracts"("escrowId");
CREATE INDEX "contracts_buyerPrincipalId_lifecycleState_createdAt_idx"
  ON "contracts"("buyerPrincipalId", "lifecycleState", "createdAt");
CREATE INDEX "contracts_supplierPrincipalId_lifecycleState_createdAt_idx"
  ON "contracts"("supplierPrincipalId", "lifecycleState", "createdAt");

ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_taskId_fkey"
  FOREIGN KEY ("taskId") REFERENCES "tasks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_acceptedOfferRevisionId_fkey"
  FOREIGN KEY ("acceptedOfferRevisionId") REFERENCES "offer_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_buyerPrincipalId_fkey"
  FOREIGN KEY ("buyerPrincipalId") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_buyerAgentIdentityId_fkey"
  FOREIGN KEY ("buyerAgentIdentityId") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_supplierPrincipalId_fkey"
  FOREIGN KEY ("supplierPrincipalId") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_supplierAgentIdentityId_fkey"
  FOREIGN KEY ("supplierAgentIdentityId") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_buyerAuthoritySnapshotId_fkey"
  FOREIGN KEY ("buyerAuthoritySnapshotId") REFERENCES "authority_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_supplierAuthoritySnapshotId_fkey"
  FOREIGN KEY ("supplierAuthoritySnapshotId") REFERENCES "authority_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "contracts"
  ADD CONSTRAINT "contracts_escrowId_fkey"
  FOREIGN KEY ("escrowId") REFERENCES "escrows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_validate_contract_formation_binding"()
RETURNS trigger AS $$
DECLARE
  task_row RECORD;
  offer_revision_row RECORD;
  offer_row RECORD;
  buyer_snapshot RECORD;
  supplier_snapshot RECORD;
BEGIN
  SELECT "issuerPrincipalId", "issuerAgentIdentityId", "status", "currentRevision"
  INTO task_row
  FROM "tasks"
  WHERE "id" = NEW."taskId"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTRACT_TASK_NOT_FOUND';
  END IF;
  IF task_row.status <> 'open' THEN
    RAISE EXCEPTION 'CONTRACT_REQUIRES_OPEN_TASK';
  END IF;
  IF task_row."issuerPrincipalId" <> NEW."buyerPrincipalId"
     OR task_row."issuerAgentIdentityId" <> NEW."buyerAgentIdentityId" THEN
    RAISE EXCEPTION 'CONTRACT_BUYER_TASK_BINDING_MISMATCH';
  END IF;

  SELECT r."offerId", r."revision", r."taskRevisionId", r."taskHash", r."offerHash",
         r."supplierAuthoritySnapshotId", r."validUntil"
  INTO offer_revision_row
  FROM "offer_revisions" r
  WHERE r."id" = NEW."acceptedOfferRevisionId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'CONTRACT_OFFER_REVISION_NOT_FOUND';
  END IF;

  SELECT "taskId", "supplierPrincipalId", "supplierAgentIdentityId", "status", "currentRevision"
  INTO offer_row
  FROM "offers"
  WHERE "id" = offer_revision_row."offerId"
  FOR SHARE;

  IF NOT FOUND OR offer_row."taskId" <> NEW."taskId" THEN
    RAISE EXCEPTION 'CONTRACT_OFFER_TASK_BINDING_MISMATCH';
  END IF;
  IF offer_row.status <> 'active'
     OR offer_row."currentRevision" <> offer_revision_row.revision THEN
    RAISE EXCEPTION 'CONTRACT_REQUIRES_CURRENT_ACTIVE_OFFER';
  END IF;
  IF offer_revision_row."validUntil" <= NEW."activatedAt" THEN
    RAISE EXCEPTION 'CONTRACT_OFFER_EXPIRED';
  END IF;
  IF offer_row."supplierPrincipalId" <> NEW."supplierPrincipalId"
     OR offer_row."supplierAgentIdentityId" <> NEW."supplierAgentIdentityId" THEN
    RAISE EXCEPTION 'CONTRACT_SUPPLIER_OFFER_BINDING_MISMATCH';
  END IF;
  IF offer_revision_row."taskHash" <> NEW."taskSnapshotHash"
     OR offer_revision_row."offerHash" <> NEW."offerSnapshotHash" THEN
    RAISE EXCEPTION 'CONTRACT_SNAPSHOT_HASH_MISMATCH';
  END IF;
  IF offer_revision_row."supplierAuthoritySnapshotId" <> NEW."supplierAuthoritySnapshotId" THEN
    RAISE EXCEPTION 'CONTRACT_SUPPLIER_SNAPSHOT_MISMATCH';
  END IF;

  SELECT "principalId", "agentIdentityId", "resolvedAction", "requestEvidence"
  INTO buyer_snapshot
  FROM "authority_snapshots"
  WHERE "id" = NEW."buyerAuthoritySnapshotId";

  IF NOT FOUND
     OR buyer_snapshot."principalId" <> NEW."buyerPrincipalId"
     OR buyer_snapshot."agentIdentityId" <> NEW."buyerAgentIdentityId"
     OR buyer_snapshot."resolvedAction" <> 'offer.accept' THEN
    RAISE EXCEPTION 'CONTRACT_BUYER_AUTHORITY_BINDING_MISMATCH';
  END IF;

  SELECT "principalId", "agentIdentityId", "resolvedAction", "requestEvidence"
  INTO supplier_snapshot
  FROM "authority_snapshots"
  WHERE "id" = NEW."supplierAuthoritySnapshotId";

  IF NOT FOUND
     OR supplier_snapshot."principalId" <> NEW."supplierPrincipalId"
     OR supplier_snapshot."agentIdentityId" <> NEW."supplierAgentIdentityId"
     OR supplier_snapshot."resolvedAction" NOT IN ('offer.issue', 'offer.revise')
     OR supplier_snapshot."requestEvidence" ->> 'payloadHash' IS DISTINCT FROM NEW."offerSnapshotHash" THEN
    RAISE EXCEPTION 'CONTRACT_SUPPLIER_AUTHORITY_BINDING_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contracts_formation_binding_guard"
BEFORE INSERT ON "contracts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_contract_formation_binding"();

CREATE OR REPLACE FUNCTION "iwantu_prevent_active_contract_mutation"()
RETURNS trigger AS $$
BEGIN
  IF OLD."lifecycleState" <> 'closed' THEN
    IF NEW."taskId" IS DISTINCT FROM OLD."taskId"
       OR NEW."acceptedOfferRevisionId" IS DISTINCT FROM OLD."acceptedOfferRevisionId"
       OR NEW."buyerPrincipalId" IS DISTINCT FROM OLD."buyerPrincipalId"
       OR NEW."buyerAgentIdentityId" IS DISTINCT FROM OLD."buyerAgentIdentityId"
       OR NEW."supplierPrincipalId" IS DISTINCT FROM OLD."supplierPrincipalId"
       OR NEW."supplierAgentIdentityId" IS DISTINCT FROM OLD."supplierAgentIdentityId"
       OR NEW."buyerAuthoritySnapshotId" IS DISTINCT FROM OLD."buyerAuthoritySnapshotId"
       OR NEW."supplierAuthoritySnapshotId" IS DISTINCT FROM OLD."supplierAuthoritySnapshotId"
       OR NEW."taskSnapshotHash" IS DISTINCT FROM OLD."taskSnapshotHash"
       OR NEW."offerSnapshotHash" IS DISTINCT FROM OLD."offerSnapshotHash"
       OR NEW."effectiveContractHash" IS DISTINCT FROM OLD."effectiveContractHash"
       OR NEW."formationIdempotencyKey" IS DISTINCT FROM OLD."formationIdempotencyKey"
       OR NEW."escrowId" IS DISTINCT FROM OLD."escrowId"
       OR NEW."activatedAt" IS DISTINCT FROM OLD."activatedAt" THEN
      RAISE EXCEPTION 'ACTIVE_CONTRACT_IS_IMMUTABLE';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contracts_active_immutability_guard"
BEFORE UPDATE ON "contracts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_active_contract_mutation"();
