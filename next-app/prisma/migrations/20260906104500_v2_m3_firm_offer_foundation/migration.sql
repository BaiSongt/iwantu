-- V2-M3-02: protocol-native Firm Offer / immutable OfferRevision foundation.
-- A2A messages and indicative quotes remain non-binding and are not represented
-- by these tables. OfferRevision stores commitment evidence; cryptographic
-- verification/live authority command gating is completed in a later M3 slice.

CREATE TYPE "OfferStatus" AS ENUM (
  'active',
  'accepted',
  'withdrawn',
  'not_selected',
  'closed'
);

CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "supplierPrincipalId" TEXT NOT NULL,
    "supplierAgentIdentityId" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'active',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "offer_revisions" (
    "id" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "taskRevisionId" TEXT NOT NULL,
    "taskHash" TEXT NOT NULL,
    "priceAmount" DECIMAL(36,8) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'IWC',
    "deliveryCommitmentSeconds" INTEGER,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "termsPayload" JSONB NOT NULL,
    "termsHash" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "offerHash" TEXT NOT NULL,
    "supplierAuthoritySnapshotId" TEXT NOT NULL,
    "signatureAlgorithm" TEXT NOT NULL,
    "signatureKeyId" TEXT NOT NULL,
    "supplierSignature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "offer_revisions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "offers_taskId_supplierPrincipalId_key"
ON "offers"("taskId", "supplierPrincipalId");
CREATE INDEX "offers_taskId_status_createdAt_idx"
ON "offers"("taskId", "status", "createdAt");
CREATE INDEX "offers_supplierPrincipalId_status_idx"
ON "offers"("supplierPrincipalId", "status");
CREATE INDEX "offers_supplierAgentIdentityId_status_idx"
ON "offers"("supplierAgentIdentityId", "status");

CREATE UNIQUE INDEX "offer_revisions_offerId_revision_key"
ON "offer_revisions"("offerId", "revision");
CREATE UNIQUE INDEX "offer_revisions_offerHash_key"
ON "offer_revisions"("offerHash");
CREATE UNIQUE INDEX "offer_revisions_nonce_key"
ON "offer_revisions"("nonce");
CREATE INDEX "offer_revisions_taskRevisionId_idx"
ON "offer_revisions"("taskRevisionId");
CREATE INDEX "offer_revisions_validUntil_idx"
ON "offer_revisions"("validUntil");
CREATE INDEX "offer_revisions_supplierAuthoritySnapshotId_idx"
ON "offer_revisions"("supplierAuthoritySnapshotId");

ALTER TABLE "offers"
ADD CONSTRAINT "offers_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "tasks"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "offers"
ADD CONSTRAINT "offers_supplierPrincipalId_fkey"
FOREIGN KEY ("supplierPrincipalId") REFERENCES "principals"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "offers"
ADD CONSTRAINT "offers_supplierAgentIdentityId_fkey"
FOREIGN KEY ("supplierAgentIdentityId") REFERENCES "agent_identities"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "offer_revisions"
ADD CONSTRAINT "offer_revisions_offerId_fkey"
FOREIGN KEY ("offerId") REFERENCES "offers"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "offer_revisions"
ADD CONSTRAINT "offer_revisions_taskRevisionId_fkey"
FOREIGN KEY ("taskRevisionId") REFERENCES "task_revisions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "offer_revisions"
ADD CONSTRAINT "offer_revisions_supplierAuthoritySnapshotId_fkey"
FOREIGN KEY ("supplierAuthoritySnapshotId") REFERENCES "authority_snapshots"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "offers"
ADD CONSTRAINT "offers_current_revision_positive_check"
CHECK ("currentRevision" >= 1);

ALTER TABLE "offer_revisions"
ADD CONSTRAINT "offer_revisions_revision_positive_check"
CHECK ("revision" >= 1);

ALTER TABLE "offer_revisions"
ADD CONSTRAINT "offer_revisions_price_nonnegative_check"
CHECK ("priceAmount" >= 0);

ALTER TABLE "offer_revisions"
ADD CONSTRAINT "offer_revisions_iwc_currency_check"
CHECK ("currency" = 'IWC');

ALTER TABLE "offer_revisions"
ADD CONSTRAINT "offer_revisions_delivery_commitment_check"
CHECK ("deliveryCommitmentSeconds" IS NULL OR "deliveryCommitmentSeconds" > 0);

ALTER TABLE "offer_revisions"
ADD CONSTRAINT "offer_revisions_ttl_check"
CHECK ("validUntil" > "createdAt");

ALTER TABLE "offer_revisions"
ADD CONSTRAINT "offer_revisions_terms_payload_check"
CHECK (jsonb_typeof("termsPayload") = 'object');

ALTER TABLE "offer_revisions"
ADD CONSTRAINT "offer_revisions_hashes_check" CHECK (
  "taskHash" ~ '^[0-9a-f]{64}$'
  AND "termsHash" ~ '^[0-9a-f]{64}$'
  AND "offerHash" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "offer_revisions"
ADD CONSTRAINT "offer_revisions_nonempty_commitment_check" CHECK (
  length(btrim("nonce")) > 0
  AND length(btrim("signatureAlgorithm")) > 0
  AND length(btrim("signatureKeyId")) > 0
  AND length(btrim("supplierSignature")) > 0
);

CREATE OR REPLACE FUNCTION "enforce_offer_supplier_ownership"()
RETURNS TRIGGER AS $$
DECLARE
  agent_principal_id TEXT;
BEGIN
  SELECT "principalId" INTO agent_principal_id
  FROM "agent_identities"
  WHERE "id" = NEW."supplierAgentIdentityId";

  IF agent_principal_id IS NULL THEN
    RAISE EXCEPTION 'Offer supplier AgentIdentity does not exist';
  END IF;

  IF agent_principal_id <> NEW."supplierPrincipalId" THEN
    RAISE EXCEPTION 'Offer supplier AgentIdentity must belong to supplier Principal';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "offers_supplier_ownership_trigger"
BEFORE INSERT OR UPDATE OF "supplierPrincipalId", "supplierAgentIdentityId"
ON "offers"
FOR EACH ROW EXECUTE FUNCTION "enforce_offer_supplier_ownership"();

CREATE OR REPLACE FUNCTION "protect_offer_envelope"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Offer rows are protocol history and cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."taskId" IS DISTINCT FROM OLD."taskId"
     OR NEW."supplierPrincipalId" IS DISTINCT FROM OLD."supplierPrincipalId"
     OR NEW."supplierAgentIdentityId" IS DISTINCT FROM OLD."supplierAgentIdentityId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Offer protocol identity and supplier ownership are immutable';
  END IF;

  IF NEW."currentRevision" < OLD."currentRevision"
     OR NEW."currentRevision" > OLD."currentRevision" + 1 THEN
    RAISE EXCEPTION 'Offer currentRevision may only advance by one';
  END IF;

  IF NEW."currentRevision" <> OLD."currentRevision" AND OLD."status" <> 'active' THEN
    RAISE EXCEPTION 'Only an active Offer may create a new revision';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "offers_protocol_history_trigger"
BEFORE UPDATE OR DELETE ON "offers"
FOR EACH ROW EXECUTE FUNCTION "protect_offer_envelope"();

CREATE OR REPLACE FUNCTION "validate_offer_revision_binding"()
RETURNS TRIGGER AS $$
DECLARE
  offer_task_id TEXT;
  offer_supplier_principal_id TEXT;
  offer_supplier_agent_id TEXT;
  revision_task_id TEXT;
  revision_task_hash TEXT;
  snapshot_principal_id TEXT;
  snapshot_agent_id TEXT;
BEGIN
  SELECT "taskId", "supplierPrincipalId", "supplierAgentIdentityId"
    INTO offer_task_id, offer_supplier_principal_id, offer_supplier_agent_id
  FROM "offers"
  WHERE "id" = NEW."offerId";

  SELECT "taskId", "contentHash"
    INTO revision_task_id, revision_task_hash
  FROM "task_revisions"
  WHERE "id" = NEW."taskRevisionId" AND "sealedAt" IS NOT NULL;

  IF revision_task_id IS NULL
     OR revision_task_id <> offer_task_id
     OR revision_task_hash <> NEW."taskHash" THEN
    RAISE EXCEPTION 'OfferRevision must bind an exact sealed TaskRevision/hash for its Offer Task';
  END IF;

  SELECT "principalId", "agentIdentityId"
    INTO snapshot_principal_id, snapshot_agent_id
  FROM "authority_snapshots"
  WHERE "id" = NEW."supplierAuthoritySnapshotId";

  IF snapshot_principal_id IS DISTINCT FROM offer_supplier_principal_id
     OR snapshot_agent_id IS DISTINCT FROM offer_supplier_agent_id THEN
    RAISE EXCEPTION 'OfferRevision AuthoritySnapshot must belong to the supplier Principal/Agent';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "offer_revisions_binding_trigger"
BEFORE INSERT ON "offer_revisions"
FOR EACH ROW EXECUTE FUNCTION "validate_offer_revision_binding"();

CREATE OR REPLACE FUNCTION "prevent_offer_revision_change"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'OfferRevision is immutable commitment evidence and cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "offer_revisions_immutable_update"
BEFORE UPDATE ON "offer_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_offer_revision_change"();

CREATE TRIGGER "offer_revisions_immutable_delete"
BEFORE DELETE ON "offer_revisions"
FOR EACH ROW EXECUTE FUNCTION "prevent_offer_revision_change"();

CREATE OR REPLACE FUNCTION "assert_offer_revision_consistency"()
RETURNS TRIGGER AS $$
DECLARE
  target_offer_id TEXT;
  offer_current_revision INTEGER;
  revision_count INTEGER;
  min_revision INTEGER;
  max_revision INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'offers' THEN
    target_offer_id := NEW."id";
  ELSE
    target_offer_id := NEW."offerId";
  END IF;

  SELECT "currentRevision" INTO offer_current_revision
  FROM "offers"
  WHERE "id" = target_offer_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::INTEGER, min("revision"), max("revision")
    INTO revision_count, min_revision, max_revision
  FROM "offer_revisions"
  WHERE "offerId" = target_offer_id;

  IF revision_count <> offer_current_revision
     OR min_revision <> 1
     OR max_revision <> offer_current_revision THEN
    RAISE EXCEPTION 'Offer currentRevision must reference a contiguous immutable revision chain';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "offers_revision_consistency_trigger"
AFTER INSERT OR UPDATE ON "offers"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_offer_revision_consistency"();

CREATE CONSTRAINT TRIGGER "offer_revisions_consistency_trigger"
AFTER INSERT ON "offer_revisions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_offer_revision_consistency"();
