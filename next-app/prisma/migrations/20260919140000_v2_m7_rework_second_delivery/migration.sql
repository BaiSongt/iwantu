-- V2-M7-01: signed-contract REWORK authorization + second Delivery foundation.
-- REJECT remains a Buyer claim. Rework rights come only from immutable accepted
-- Firm Offer termsPayload.deliveryPolicy and never release/refund Escrow.

CREATE TABLE "rework_authorizations" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "rejectionDecisionId" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "effectiveContractHash" TEXT NOT NULL,
  "deliveryHash" TEXT NOT NULL,
  "rejectedSequence" INTEGER NOT NULL,
  "nextSequence" INTEGER NOT NULL,
  "maxAttempts" INTEGER NOT NULL,
  "reworkWindowSeconds" INTEGER NOT NULL,
  "reworkDeadline" TIMESTAMP(3) NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "rework_authorizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "rework_authorizations_sequence_shape" CHECK (
    "rejectedSequence" > 0
    AND "nextSequence" = "rejectedSequence" + 1
    AND "maxAttempts" >= "nextSequence"
    AND "maxAttempts" <= 10
  ),
  CONSTRAINT "rework_authorizations_window_shape" CHECK (
    "reworkWindowSeconds" > 0
    AND "reworkWindowSeconds" <= 604800
  ),
  CONSTRAINT "rework_authorizations_hash_shape" CHECK (length("evidenceHash") = 64)
);

CREATE UNIQUE INDEX "rework_authorizations_rejection_key"
  ON "rework_authorizations"("rejectionDecisionId");
CREATE UNIQUE INDEX "rework_authorizations_delivery_key"
  ON "rework_authorizations"("deliveryId");
CREATE UNIQUE INDEX "rework_authorizations_contract_sequence_key"
  ON "rework_authorizations"("contractId", "nextSequence");
CREATE UNIQUE INDEX "rework_authorizations_evidence_hash_key"
  ON "rework_authorizations"("evidenceHash");
CREATE INDEX "rework_authorizations_contract_deadline_idx"
  ON "rework_authorizations"("contractId", "reworkDeadline");

ALTER TABLE "rework_authorizations"
  ADD CONSTRAINT "rework_authorizations_contract_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rework_authorizations"
  ADD CONSTRAINT "rework_authorizations_rejection_fkey"
  FOREIGN KEY ("rejectionDecisionId") REFERENCES "delivery_acceptance_decisions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "rework_authorizations"
  ADD CONSTRAINT "rework_authorizations_delivery_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_validate_rework_authorization"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  rejection_row RECORD;
  delivery_row RECORD;
  offer_row RECORD;
  latest_delivery_id TEXT;
  policy_max_attempts INTEGER;
  policy_rework_window INTEGER;
  expected_deadline TIMESTAMP(3);
BEGIN
  SELECT * INTO contract_row
  FROM "contracts"
  WHERE "id" = NEW."contractId"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REWORK_CONTRACT_NOT_FOUND';
  END IF;
  IF contract_row."lifecycleState" <> 'acceptance_pending'::"ContractLifecycleState" THEN
    RAISE EXCEPTION 'REWORK_AUTHORIZATION_REQUIRES_ACCEPTANCE_PENDING';
  END IF;
  IF contract_row."effectiveContractHash" <> NEW."effectiveContractHash" THEN
    RAISE EXCEPTION 'REWORK_CONTRACT_HASH_MISMATCH';
  END IF;

  SELECT * INTO rejection_row
  FROM "delivery_acceptance_decisions"
  WHERE "id" = NEW."rejectionDecisionId";
  IF NOT FOUND
     OR rejection_row."contractId" <> NEW."contractId"
     OR rejection_row."deliveryId" <> NEW."deliveryId"
     OR rejection_row."effectiveContractHash" <> NEW."effectiveContractHash"
     OR rejection_row."deliveryHash" <> NEW."deliveryHash"
     OR rejection_row."decision" <> 'reject' THEN
    RAISE EXCEPTION 'REWORK_REJECTION_EVIDENCE_INVALID';
  END IF;

  SELECT * INTO delivery_row
  FROM "deliveries"
  WHERE "id" = NEW."deliveryId";
  IF NOT FOUND
     OR delivery_row."contractId" <> NEW."contractId"
     OR delivery_row."effectiveContractHash" <> NEW."effectiveContractHash"
     OR delivery_row."deliveryHash" <> NEW."deliveryHash" THEN
    RAISE EXCEPTION 'REWORK_DELIVERY_EVIDENCE_INVALID';
  END IF;

  SELECT "id" INTO latest_delivery_id
  FROM "deliveries"
  WHERE "contractId" = NEW."contractId"
  ORDER BY "sequence" DESC
  LIMIT 1;
  IF latest_delivery_id IS DISTINCT FROM NEW."deliveryId" THEN
    RAISE EXCEPTION 'REWORK_REQUIRES_LATEST_DELIVERY';
  END IF;

  SELECT "termsPayload" INTO offer_row
  FROM "offer_revisions"
  WHERE "id" = contract_row."acceptedOfferRevisionId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'REWORK_OFFER_REVISION_NOT_FOUND';
  END IF;

  IF jsonb_typeof(offer_row."termsPayload" -> 'deliveryPolicy') IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'REWORK_POLICY_NOT_GRANTED';
  END IF;
  IF jsonb_typeof(offer_row."termsPayload" #> '{deliveryPolicy,maxAttempts}') IS DISTINCT FROM 'number'
     OR jsonb_typeof(offer_row."termsPayload" #> '{deliveryPolicy,reworkWindowSeconds}') IS DISTINCT FROM 'number' THEN
    RAISE EXCEPTION 'REWORK_POLICY_INVALID';
  END IF;

  policy_max_attempts := (offer_row."termsPayload" #>> '{deliveryPolicy,maxAttempts}')::INTEGER;
  policy_rework_window := (offer_row."termsPayload" #>> '{deliveryPolicy,reworkWindowSeconds}')::INTEGER;

  IF policy_max_attempts < 2 OR policy_max_attempts > 10
     OR policy_rework_window < 1 OR policy_rework_window > 604800 THEN
    RAISE EXCEPTION 'REWORK_POLICY_INVALID';
  END IF;
  IF delivery_row."sequence" >= policy_max_attempts THEN
    RAISE EXCEPTION 'REWORK_ATTEMPTS_EXHAUSTED';
  END IF;
  IF NEW."rejectedSequence" <> delivery_row."sequence"
     OR NEW."nextSequence" <> delivery_row."sequence" + 1
     OR NEW."maxAttempts" <> policy_max_attempts
     OR NEW."reworkWindowSeconds" <> policy_rework_window THEN
    RAISE EXCEPTION 'REWORK_POLICY_BINDING_MISMATCH';
  END IF;

  expected_deadline :=
    rejection_row."decidedAt" + make_interval(secs => policy_rework_window);
  IF NEW."reworkDeadline" <> expected_deadline THEN
    RAISE EXCEPTION 'REWORK_DEADLINE_BINDING_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "rework_authorizations_binding_guard"
BEFORE INSERT ON "rework_authorizations"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_rework_authorization"();

CREATE OR REPLACE FUNCTION "iwantu_prevent_rework_authorization_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'REWORK_AUTHORIZATION_IS_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "rework_authorizations_update_guard"
BEFORE UPDATE ON "rework_authorizations"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_rework_authorization_mutation"();

CREATE TRIGGER "rework_authorizations_delete_guard"
BEFORE DELETE ON "rework_authorizations"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_rework_authorization_mutation"();

-- REWORK is no longer authorized by a bare rejection alone. It requires the
-- immutable authorization derived from the accepted signed Offer.
CREATE OR REPLACE FUNCTION "iwantu_require_rejection_for_rework"()
RETURNS trigger AS $$
DECLARE
  valid_authorization BOOLEAN;
  escrow_status "EscrowStatus";
BEGIN
  IF NEW."lifecycleState" = 'rework'::"ContractLifecycleState"
     AND OLD."lifecycleState" = 'acceptance_pending'::"ContractLifecycleState" THEN
    SELECT EXISTS(
      SELECT 1
      FROM "rework_authorizations" r
      JOIN "deliveries" d ON d."id" = r."deliveryId"
      JOIN "delivery_acceptance_decisions" a ON a."id" = r."rejectionDecisionId"
      WHERE r."contractId" = NEW."id"
        AND r."effectiveContractHash" = NEW."effectiveContractHash"
        AND a."decision" = 'reject'
        AND d."sequence" = (
          SELECT MAX(d2."sequence")
          FROM "deliveries" d2
          WHERE d2."contractId" = NEW."id"
        )
        AND r."nextSequence" = d."sequence" + 1
    ) INTO valid_authorization;

    IF NOT valid_authorization THEN
      RAISE EXCEPTION 'REWORK_REQUIRES_PROTOCOL_AUTHORIZATION';
    END IF;

    SELECT "status" INTO escrow_status
    FROM "escrows"
    WHERE "id" = NEW."escrowId";
    IF escrow_status IS DISTINCT FROM 'locked'::"EscrowStatus" THEN
      RAISE EXCEPTION 'REWORK_REQUIRES_LOCKED_ESCROW';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Once attempts are exhausted (or the signed Contract grants no rework),
-- a rejection can move to DISPUTED, but still cannot settle funds.
CREATE OR REPLACE FUNCTION "iwantu_require_exhausted_rejection_for_dispute"()
RETURNS trigger AS $$
DECLARE
  delivery_row RECORD;
  rejection_exists BOOLEAN;
  terms_payload JSONB;
  policy_max_attempts INTEGER;
  escrow_status "EscrowStatus";
BEGIN
  IF NEW."lifecycleState" = 'disputed'::"ContractLifecycleState"
     AND OLD."lifecycleState" = 'acceptance_pending'::"ContractLifecycleState" THEN
    SELECT * INTO delivery_row
    FROM "deliveries"
    WHERE "contractId" = NEW."id"
    ORDER BY "sequence" DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'DISPUTE_REQUIRES_DELIVERY';
    END IF;

    SELECT EXISTS(
      SELECT 1
      FROM "delivery_acceptance_decisions" a
      WHERE a."contractId" = NEW."id"
        AND a."deliveryId" = delivery_row."id"
        AND a."decision" = 'reject'
    ) INTO rejection_exists;
    IF NOT rejection_exists THEN
      RAISE EXCEPTION 'DISPUTE_REQUIRES_PROTOCOL_REJECTION';
    END IF;

    SELECT "termsPayload" INTO terms_payload
    FROM "offer_revisions"
    WHERE "id" = NEW."acceptedOfferRevisionId";

    policy_max_attempts := 1;
    IF jsonb_typeof(terms_payload -> 'deliveryPolicy') = 'object'
       AND jsonb_typeof(terms_payload #> '{deliveryPolicy,maxAttempts}') = 'number' THEN
      policy_max_attempts := (terms_payload #>> '{deliveryPolicy,maxAttempts}')::INTEGER;
    END IF;

    IF delivery_row."sequence" < policy_max_attempts THEN
      RAISE EXCEPTION 'DISPUTE_REWORK_ATTEMPTS_REMAIN';
    END IF;

    SELECT "status" INTO escrow_status
    FROM "escrows"
    WHERE "id" = NEW."escrowId";
    IF escrow_status IS DISTINCT FROM 'locked'::"EscrowStatus" THEN
      RAISE EXCEPTION 'DISPUTE_REQUIRES_LOCKED_ESCROW';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "contracts_rejection_dispute_guard" ON "contracts";
CREATE TRIGGER "contracts_rejection_dispute_guard"
BEFORE UPDATE OF "lifecycleState" ON "contracts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_require_exhausted_rejection_for_dispute"();

ALTER TABLE "deliveries"
  DROP CONSTRAINT "deliveries_deadline_status_valid";
ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_deadline_status_valid"
  CHECK ("deadlineStatus" IN ('on_time', 'rework_on_time', 'no_explicit_deadline'));

-- Rework Deliveries use the immutable ReworkAuthorization deadline, not the
-- original first-delivery deadline. Database current time also prevents
-- backdating through a service-level test clock.
CREATE OR REPLACE FUNCTION "iwantu_validate_delivery_binding"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  offer_revision_row RECORD;
  snapshot_row RECORD;
  escrow_row RECORD;
  rework_row RECORD;
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

  IF contract_row."lifecycleState" = 'rework'::"ContractLifecycleState" THEN
    SELECT * INTO rework_row
    FROM "rework_authorizations"
    WHERE "contractId" = NEW."contractId"
      AND "nextSequence" = NEW."sequence";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'REWORK_DELIVERY_REQUIRES_AUTHORIZATION';
    END IF;
    IF NEW."contractDeliveryDeadline" IS DISTINCT FROM rework_row."reworkDeadline"
       OR NEW."deadlineStatus" <> 'rework_on_time' THEN
      RAISE EXCEPTION 'REWORK_DELIVERY_DEADLINE_EVIDENCE_MISMATCH';
    END IF;
    IF NEW."submittedAt" > rework_row."reworkDeadline"
       OR CURRENT_TIMESTAMP > rework_row."reworkDeadline" THEN
      RAISE EXCEPTION 'REWORK_WINDOW_EXPIRED';
    END IF;
  ELSE
    SELECT "deliveryCommitmentSeconds" INTO offer_revision_row
    FROM "offer_revisions"
    WHERE "id" = NEW."acceptedOfferRevisionId";
    IF NOT FOUND THEN
      RAISE EXCEPTION 'DELIVERY_OFFER_REVISION_NOT_FOUND';
    END IF;

    IF offer_revision_row."deliveryCommitmentSeconds" IS NOT NULL THEN
      derived_deadline :=
        contract_row."activatedAt" + make_interval(secs => offer_revision_row."deliveryCommitmentSeconds");
      IF NEW."contractDeliveryDeadline" IS DISTINCT FROM derived_deadline THEN
        RAISE EXCEPTION 'DELIVERY_DEADLINE_EVIDENCE_MISMATCH';
      END IF;
      IF NEW."submittedAt" > derived_deadline
         OR CURRENT_TIMESTAMP > derived_deadline
         OR NEW."deadlineStatus" <> 'on_time' THEN
        RAISE EXCEPTION 'DELIVERY_DEADLINE_EXCEEDED';
      END IF;
    ELSE
      IF NEW."contractDeliveryDeadline" IS NOT NULL
         OR NEW."deadlineStatus" <> 'no_explicit_deadline' THEN
        RAISE EXCEPTION 'DELIVERY_DEADLINE_EVIDENCE_MISMATCH';
      END IF;
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
