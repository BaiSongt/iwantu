-- V2-M5-01: signed, immutable Delivery foundation.
-- Delivery is a protocol fact only: it moves an ACTIVE/REWORK Contract to
-- ACCEPTANCE_PENDING and MUST NOT release or refund Escrow.

CREATE TABLE "deliveries" (
  "id" TEXT NOT NULL,
  "deliveryIdempotencyKey" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "effectiveContractHash" TEXT NOT NULL,
  "acceptedOfferRevisionId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "supplierPrincipalId" TEXT NOT NULL,
  "supplierAgentIdentityId" TEXT NOT NULL,
  "authoritySnapshotId" TEXT NOT NULL,
  "deliverables" JSONB NOT NULL,
  "evidence" JSONB NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "deliveryHash" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL,
  "nonce" TEXT NOT NULL,
  "signatureAlgorithm" TEXT NOT NULL,
  "signingKeyId" TEXT NOT NULL,
  "supplierSignature" TEXT NOT NULL,
  "commandIssuedAt" TIMESTAMP(3) NOT NULL,
  "commandExpiresAt" TIMESTAMP(3) NOT NULL,
  "contractDeliveryDeadline" TIMESTAMP(3),
  "deadlineStatus" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "deliveries_sequence_positive" CHECK ("sequence" > 0),
  CONSTRAINT "deliveries_signature_present" CHECK (length("supplierSignature") > 0),
  CONSTRAINT "deliveries_command_window" CHECK ("commandExpiresAt" > "commandIssuedAt"),
  CONSTRAINT "deliveries_submitted_in_command_window" CHECK (
    "submittedAt" >= "commandIssuedAt" AND "submittedAt" < "commandExpiresAt"
  ),
  CONSTRAINT "deliveries_deadline_status_valid" CHECK ("deadlineStatus" IN ('on_time', 'no_explicit_deadline'))
);

CREATE UNIQUE INDEX "deliveries_deliveryIdempotencyKey_key" ON "deliveries"("deliveryIdempotencyKey");
CREATE UNIQUE INDEX "deliveries_contractId_sequence_key" ON "deliveries"("contractId", "sequence");
CREATE UNIQUE INDEX "deliveries_authoritySnapshotId_key" ON "deliveries"("authoritySnapshotId");
CREATE UNIQUE INDEX "deliveries_deliveryHash_key" ON "deliveries"("deliveryHash");
CREATE UNIQUE INDEX "deliveries_commandHash_key" ON "deliveries"("commandHash");
CREATE UNIQUE INDEX "deliveries_nonce_key" ON "deliveries"("nonce");
CREATE INDEX "deliveries_contractId_submittedAt_idx" ON "deliveries"("contractId", "submittedAt");
CREATE INDEX "deliveries_supplierPrincipalId_submittedAt_idx" ON "deliveries"("supplierPrincipalId", "submittedAt");

ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_acceptedOfferRevisionId_fkey"
  FOREIGN KEY ("acceptedOfferRevisionId") REFERENCES "offer_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_supplierPrincipalId_fkey"
  FOREIGN KEY ("supplierPrincipalId") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_supplierAgentIdentityId_fkey"
  FOREIGN KEY ("supplierAgentIdentityId") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_authoritySnapshotId_fkey"
  FOREIGN KEY ("authoritySnapshotId") REFERENCES "authority_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_validate_delivery_binding"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  offer_revision_row RECORD;
  snapshot_row RECORD;
  escrow_row RECORD;
  expected_sequence INTEGER;
  derived_deadline TIMESTAMP(3);
BEGIN
  SELECT * INTO contract_row
  FROM "contracts"
  WHERE "id" = NEW."contractId"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_CONTRACT_NOT_FOUND';
  END IF;
  IF contract_row."lifecycleState" NOT IN ('active', 'rework') THEN
    RAISE EXCEPTION 'DELIVERY_CONTRACT_STATE_INVALID';
  END IF;
  IF contract_row."effectiveContractHash" <> NEW."effectiveContractHash"
     OR contract_row."acceptedOfferRevisionId" <> NEW."acceptedOfferRevisionId" THEN
    RAISE EXCEPTION 'DELIVERY_CONTRACT_EVIDENCE_MISMATCH';
  END IF;
  IF contract_row."supplierPrincipalId" <> NEW."supplierPrincipalId"
     OR contract_row."supplierAgentIdentityId" <> NEW."supplierAgentIdentityId" THEN
    RAISE EXCEPTION 'DELIVERY_SUPPLIER_BINDING_MISMATCH';
  END IF;

  SELECT "status" INTO escrow_row
  FROM "escrows"
  WHERE "id" = contract_row."escrowId";
  IF NOT FOUND OR escrow_row.status <> 'locked' THEN
    RAISE EXCEPTION 'DELIVERY_REQUIRES_LOCKED_ESCROW';
  END IF;

  SELECT COALESCE(MAX("sequence"), 0) + 1 INTO expected_sequence
  FROM "deliveries"
  WHERE "contractId" = NEW."contractId";
  IF NEW."sequence" <> expected_sequence THEN
    RAISE EXCEPTION 'DELIVERY_SEQUENCE_INVALID';
  END IF;

  SELECT "deliveryCommitmentSeconds" INTO offer_revision_row
  FROM "offer_revisions"
  WHERE "id" = NEW."acceptedOfferRevisionId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'DELIVERY_OFFER_REVISION_NOT_FOUND';
  END IF;

  IF offer_revision_row."deliveryCommitmentSeconds" IS NOT NULL THEN
    derived_deadline := contract_row."activatedAt" + make_interval(secs => offer_revision_row."deliveryCommitmentSeconds");
    IF NEW."contractDeliveryDeadline" IS DISTINCT FROM derived_deadline THEN
      RAISE EXCEPTION 'DELIVERY_DEADLINE_EVIDENCE_MISMATCH';
    END IF;
    IF NEW."submittedAt" > derived_deadline OR NEW."deadlineStatus" <> 'on_time' THEN
      RAISE EXCEPTION 'DELIVERY_DEADLINE_EXCEEDED';
    END IF;
  ELSE
    IF NEW."contractDeliveryDeadline" IS NOT NULL OR NEW."deadlineStatus" <> 'no_explicit_deadline' THEN
      RAISE EXCEPTION 'DELIVERY_DEADLINE_EVIDENCE_MISMATCH';
    END IF;
  END IF;

  SELECT "principalId", "agentIdentityId", "resolvedAction", "requestEvidence"
  INTO snapshot_row
  FROM "authority_snapshots"
  WHERE "id" = NEW."authoritySnapshotId";
  IF NOT FOUND
     OR snapshot_row."principalId" <> NEW."supplierPrincipalId"
     OR snapshot_row."agentIdentityId" <> NEW."supplierAgentIdentityId"
     OR snapshot_row."resolvedAction" <> 'delivery.submit'
     OR snapshot_row."requestEvidence" ->> 'action' IS DISTINCT FROM 'delivery.submit'
     OR snapshot_row."requestEvidence" ->> 'payloadHash' IS DISTINCT FROM NEW."deliveryHash"
     OR snapshot_row."requestEvidence" ->> 'commandHash' IS DISTINCT FROM NEW."commandHash"
     OR snapshot_row."requestEvidence" ->> 'nonce' IS DISTINCT FROM NEW."nonce"
     OR snapshot_row."requestEvidence" ->> 'signingKeyId' IS DISTINCT FROM NEW."signingKeyId"
     OR snapshot_row."requestEvidence" ->> 'signatureAlgorithm' IS DISTINCT FROM NEW."signatureAlgorithm" THEN
    RAISE EXCEPTION 'DELIVERY_AUTHORITY_EVIDENCE_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "deliveries_binding_guard"
BEFORE INSERT ON "deliveries"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_delivery_binding"();

CREATE OR REPLACE FUNCTION "iwantu_prevent_delivery_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DELIVERY_IS_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "deliveries_update_guard"
BEFORE UPDATE ON "deliveries"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_delivery_mutation"();
CREATE TRIGGER "deliveries_delete_guard"
BEFORE DELETE ON "deliveries"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_delivery_mutation"();

CREATE OR REPLACE FUNCTION "iwantu_require_delivery_for_acceptance_pending"()
RETURNS trigger AS $$
DECLARE
  delivery_exists BOOLEAN;
  escrow_status "EscrowStatus";
BEGIN
  IF NEW."lifecycleState" = 'acceptance_pending'
     AND OLD."lifecycleState" IN ('active', 'rework') THEN
    SELECT EXISTS(
      SELECT 1 FROM "deliveries" d
      WHERE d."contractId" = NEW."id"
        AND d."effectiveContractHash" = NEW."effectiveContractHash"
        AND d."acceptedOfferRevisionId" = NEW."acceptedOfferRevisionId"
        AND d."supplierPrincipalId" = NEW."supplierPrincipalId"
        AND d."supplierAgentIdentityId" = NEW."supplierAgentIdentityId"
    ) INTO delivery_exists;

    IF NOT delivery_exists THEN
      RAISE EXCEPTION 'ACCEPTANCE_PENDING_REQUIRES_PROTOCOL_DELIVERY';
    END IF;

    SELECT "status" INTO escrow_status FROM "escrows" WHERE "id" = NEW."escrowId";
    IF escrow_status IS DISTINCT FROM 'locked'::"EscrowStatus" THEN
      RAISE EXCEPTION 'DELIVERY_TRANSITION_REQUIRES_LOCKED_ESCROW';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contracts_delivery_transition_guard"
BEFORE UPDATE OF "lifecycleState" ON "contracts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_require_delivery_for_acceptance_pending"();