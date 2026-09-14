-- V2-M5-03A: deterministic acceptance timeout / AUTO_ACCEPT foundation.
-- AUTO_ACCEPT is an immutable protocol fact. It does not itself settle Escrow.
-- The timeout policy is bound through the accepted immutable Offer revision terms;
-- missing policy uses the MVP default of 86400 seconds (24 hours).

ALTER TABLE "delivery_acceptance_decisions"
  DROP CONSTRAINT "delivery_acceptance_decisions_m5_02_source_gate";

ALTER TABLE "delivery_acceptance_decisions"
  ADD COLUMN "autoAcceptDeadline" TIMESTAMP(3),
  ADD COLUMN "autoAcceptPolicySeconds" INTEGER,
  ADD COLUMN "systemEvidenceHash" TEXT;

ALTER TABLE "delivery_acceptance_decisions"
  ADD CONSTRAINT "delivery_acceptance_decisions_auto_accept_shape" CHECK (
    "source" <> 'auto_accept'
    OR (
      "decision" = 'accept'
      AND "reasonCode" IS NULL
      AND "reasonDetail" IS NULL
      AND "authoritySnapshotId" IS NULL
      AND "commandHash" IS NULL
      AND "signatureAlgorithm" IS NULL
      AND "signingKeyId" IS NULL
      AND "buyerSignature" IS NULL
      AND "commandIssuedAt" IS NULL
      AND "commandExpiresAt" IS NULL
      AND "autoAcceptDeadline" IS NOT NULL
      AND "autoAcceptPolicySeconds" IS NOT NULL
      AND "autoAcceptPolicySeconds" BETWEEN 60 AND 604800
      AND "systemEvidenceHash" IS NOT NULL
      AND length("systemEvidenceHash") = 64
      AND "decidedAt" >= "autoAcceptDeadline"
    )
  );

CREATE UNIQUE INDEX "delivery_acceptance_decisions_system_evidence_hash_key"
  ON "delivery_acceptance_decisions"("systemEvidenceHash")
  WHERE "systemEvidenceHash" IS NOT NULL;

CREATE OR REPLACE FUNCTION "iwantu_validate_auto_accept_decision"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  delivery_row RECORD;
  offer_row RECORD;
  expected_timeout INTEGER;
  expected_deadline TIMESTAMP(3);
BEGIN
  IF NEW."source" <> 'auto_accept' THEN
    RETURN NEW;
  END IF;

  SELECT * INTO contract_row
  FROM "contracts"
  WHERE "id" = NEW."contractId"
  FOR SHARE;

  IF NOT FOUND OR contract_row."lifecycleState" <> 'acceptance_pending' THEN
    RAISE EXCEPTION 'AUTO_ACCEPT_REQUIRES_PENDING_CONTRACT';
  END IF;

  SELECT * INTO delivery_row
  FROM "deliveries"
  WHERE "id" = NEW."deliveryId";

  IF NOT FOUND
     OR delivery_row."contractId" <> NEW."contractId"
     OR delivery_row."effectiveContractHash" <> NEW."effectiveContractHash"
     OR delivery_row."deliveryHash" <> NEW."deliveryHash" THEN
    RAISE EXCEPTION 'AUTO_ACCEPT_DELIVERY_BINDING_MISMATCH';
  END IF;

  SELECT "termsPayload" INTO offer_row
  FROM "offer_revisions"
  WHERE "id" = contract_row."acceptedOfferRevisionId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUTO_ACCEPT_OFFER_REVISION_NOT_FOUND';
  END IF;

  BEGIN
    expected_timeout := NULLIF(offer_row."termsPayload" ->> 'acceptanceTimeoutSeconds', '')::INTEGER;
  EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
    RAISE EXCEPTION 'AUTO_ACCEPT_POLICY_INVALID';
  END;

  IF expected_timeout IS NULL THEN
    expected_timeout := 86400;
  END IF;

  IF expected_timeout < 60 OR expected_timeout > 604800 THEN
    RAISE EXCEPTION 'AUTO_ACCEPT_POLICY_INVALID';
  END IF;

  expected_deadline := delivery_row."submittedAt" + make_interval(secs => expected_timeout);

  IF NEW."autoAcceptPolicySeconds" <> expected_timeout
     OR NEW."autoAcceptDeadline" <> expected_deadline THEN
    RAISE EXCEPTION 'AUTO_ACCEPT_POLICY_BINDING_MISMATCH';
  END IF;

  IF NEW."decidedAt" < expected_deadline OR CURRENT_TIMESTAMP < expected_deadline THEN
    RAISE EXCEPTION 'AUTO_ACCEPT_NOT_DUE';
  END IF;

  IF NEW."buyerPrincipalId" <> contract_row."buyerPrincipalId"
     OR NEW."buyerAgentIdentityId" <> contract_row."buyerAgentIdentityId" THEN
    RAISE EXCEPTION 'AUTO_ACCEPT_BUYER_BINDING_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "delivery_acceptance_decisions_auto_accept_guard"
BEFORE INSERT ON "delivery_acceptance_decisions"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_auto_accept_decision"();
