-- V2-M5-02: signed Buyer acceptance / rejection decision foundation.
-- A decision is immutable protocol evidence. ACCEPT does not settle funds here;
-- REJECT may move ACCEPTANCE_PENDING -> REWORK, while Escrow remains locked.

CREATE TABLE "delivery_acceptance_decisions" (
  "id" TEXT NOT NULL,
  "decisionIdempotencyKey" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "effectiveContractHash" TEXT NOT NULL,
  "deliveryHash" TEXT NOT NULL,
  "decision" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'buyer_signed',
  "reasonCode" TEXT,
  "reasonDetail" TEXT,
  "buyerPrincipalId" TEXT NOT NULL,
  "buyerAgentIdentityId" TEXT NOT NULL,
  "authoritySnapshotId" TEXT,
  "decisionHash" TEXT NOT NULL,
  "commandHash" TEXT,
  "nonce" TEXT NOT NULL,
  "signatureAlgorithm" TEXT,
  "signingKeyId" TEXT,
  "buyerSignature" TEXT,
  "commandIssuedAt" TIMESTAMP(3),
  "commandExpiresAt" TIMESTAMP(3),
  "decidedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "delivery_acceptance_decisions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_acceptance_decisions_decision_valid" CHECK ("decision" IN ('accept', 'reject')),
  CONSTRAINT "delivery_acceptance_decisions_source_valid" CHECK ("source" IN ('buyer_signed', 'auto_accept')),
  CONSTRAINT "delivery_acceptance_decisions_reason_valid" CHECK (
    ("decision" = 'accept' AND "reasonCode" IS NULL)
    OR
    ("decision" = 'reject' AND "reasonCode" IN (
      'MISSING_OUTPUT', 'FORMAT_INVALID', 'CONSTRAINT_NOT_MET',
      'INCOMPLETE', 'DEADLINE_EXCEEDED', 'OTHER'
    ))
  ),
  CONSTRAINT "delivery_acceptance_decisions_signed_shape" CHECK (
    "source" <> 'buyer_signed'
    OR (
      "authoritySnapshotId" IS NOT NULL
      AND "commandHash" IS NOT NULL
      AND "signatureAlgorithm" IS NOT NULL
      AND "signingKeyId" IS NOT NULL
      AND "buyerSignature" IS NOT NULL
      AND length("buyerSignature") > 0
      AND "commandIssuedAt" IS NOT NULL
      AND "commandExpiresAt" IS NOT NULL
      AND "commandExpiresAt" > "commandIssuedAt"
      AND "decidedAt" >= "commandIssuedAt"
      AND "decidedAt" < "commandExpiresAt"
    )
  )
);

CREATE UNIQUE INDEX "delivery_acceptance_decisions_idempotency_key"
  ON "delivery_acceptance_decisions"("decisionIdempotencyKey");
CREATE UNIQUE INDEX "delivery_acceptance_decisions_delivery_key"
  ON "delivery_acceptance_decisions"("deliveryId");
CREATE UNIQUE INDEX "delivery_acceptance_decisions_decision_hash_key"
  ON "delivery_acceptance_decisions"("decisionHash");
CREATE UNIQUE INDEX "delivery_acceptance_decisions_nonce_key"
  ON "delivery_acceptance_decisions"("nonce");
CREATE UNIQUE INDEX "delivery_acceptance_decisions_authority_snapshot_key"
  ON "delivery_acceptance_decisions"("authoritySnapshotId")
  WHERE "authoritySnapshotId" IS NOT NULL;
CREATE UNIQUE INDEX "delivery_acceptance_decisions_command_hash_key"
  ON "delivery_acceptance_decisions"("commandHash")
  WHERE "commandHash" IS NOT NULL;
CREATE INDEX "delivery_acceptance_decisions_contract_decided_idx"
  ON "delivery_acceptance_decisions"("contractId", "decidedAt");

ALTER TABLE "delivery_acceptance_decisions"
  ADD CONSTRAINT "delivery_acceptance_decisions_contract_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_acceptance_decisions"
  ADD CONSTRAINT "delivery_acceptance_decisions_delivery_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_acceptance_decisions"
  ADD CONSTRAINT "delivery_acceptance_decisions_buyer_principal_fkey"
  FOREIGN KEY ("buyerPrincipalId") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_acceptance_decisions"
  ADD CONSTRAINT "delivery_acceptance_decisions_buyer_agent_fkey"
  FOREIGN KEY ("buyerAgentIdentityId") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "delivery_acceptance_decisions"
  ADD CONSTRAINT "delivery_acceptance_decisions_authority_snapshot_fkey"
  FOREIGN KEY ("authoritySnapshotId") REFERENCES "authority_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_validate_delivery_acceptance_decision"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  delivery_row RECORD;
  latest_delivery_id TEXT;
  snapshot_row RECORD;
  escrow_status "EscrowStatus";
  expected_action TEXT;
BEGIN
  SELECT * INTO contract_row
  FROM "contracts"
  WHERE "id" = NEW."contractId"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ACCEPTANCE_CONTRACT_NOT_FOUND';
  END IF;
  IF contract_row."lifecycleState" <> 'acceptance_pending' THEN
    RAISE EXCEPTION 'ACCEPTANCE_REQUIRES_PENDING_CONTRACT';
  END IF;
  IF contract_row."effectiveContractHash" <> NEW."effectiveContractHash" THEN
    RAISE EXCEPTION 'ACCEPTANCE_CONTRACT_HASH_MISMATCH';
  END IF;
  IF contract_row."buyerPrincipalId" <> NEW."buyerPrincipalId"
     OR contract_row."buyerAgentIdentityId" <> NEW."buyerAgentIdentityId" THEN
    RAISE EXCEPTION 'ACCEPTANCE_BUYER_BINDING_MISMATCH';
  END IF;

  SELECT * INTO delivery_row
  FROM "deliveries"
  WHERE "id" = NEW."deliveryId";
  IF NOT FOUND
     OR delivery_row."contractId" <> NEW."contractId"
     OR delivery_row."effectiveContractHash" <> NEW."effectiveContractHash"
     OR delivery_row."deliveryHash" <> NEW."deliveryHash" THEN
    RAISE EXCEPTION 'ACCEPTANCE_DELIVERY_BINDING_MISMATCH';
  END IF;

  SELECT d."id" INTO latest_delivery_id
  FROM "deliveries" d
  WHERE d."contractId" = NEW."contractId"
  ORDER BY d."sequence" DESC
  LIMIT 1;
  IF latest_delivery_id IS DISTINCT FROM NEW."deliveryId" THEN
    RAISE EXCEPTION 'ACCEPTANCE_REQUIRES_LATEST_DELIVERY';
  END IF;

  SELECT "status" INTO escrow_status FROM "escrows" WHERE "id" = contract_row."escrowId";
  IF escrow_status IS DISTINCT FROM 'locked'::"EscrowStatus" THEN
    RAISE EXCEPTION 'ACCEPTANCE_REQUIRES_LOCKED_ESCROW';
  END IF;

  IF NEW."source" = 'buyer_signed' THEN
    expected_action := CASE WHEN NEW."decision" = 'accept' THEN 'delivery.accept' ELSE 'delivery.reject' END;
    SELECT "principalId", "agentIdentityId", "resolvedAction", "requestEvidence"
    INTO snapshot_row
    FROM "authority_snapshots"
    WHERE "id" = NEW."authoritySnapshotId";

    IF NOT FOUND
       OR snapshot_row."principalId" <> NEW."buyerPrincipalId"
       OR snapshot_row."agentIdentityId" <> NEW."buyerAgentIdentityId"
       OR snapshot_row."resolvedAction" <> expected_action
       OR snapshot_row."requestEvidence" ->> 'action' IS DISTINCT FROM expected_action
       OR snapshot_row."requestEvidence" ->> 'payloadHash' IS DISTINCT FROM NEW."decisionHash"
       OR snapshot_row."requestEvidence" ->> 'commandHash' IS DISTINCT FROM NEW."commandHash"
       OR snapshot_row."requestEvidence" ->> 'nonce' IS DISTINCT FROM NEW."nonce"
       OR snapshot_row."requestEvidence" ->> 'signingKeyId' IS DISTINCT FROM NEW."signingKeyId"
       OR snapshot_row."requestEvidence" ->> 'signatureAlgorithm' IS DISTINCT FROM NEW."signatureAlgorithm" THEN
      RAISE EXCEPTION 'ACCEPTANCE_AUTHORITY_EVIDENCE_MISMATCH';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "delivery_acceptance_decisions_binding_guard"
BEFORE INSERT ON "delivery_acceptance_decisions"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_delivery_acceptance_decision"();

CREATE OR REPLACE FUNCTION "iwantu_prevent_delivery_acceptance_decision_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ACCEPTANCE_DECISION_IS_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "delivery_acceptance_decisions_update_guard"
BEFORE UPDATE ON "delivery_acceptance_decisions"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_delivery_acceptance_decision_mutation"();
CREATE TRIGGER "delivery_acceptance_decisions_delete_guard"
BEFORE DELETE ON "delivery_acceptance_decisions"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_delivery_acceptance_decision_mutation"();

CREATE OR REPLACE FUNCTION "iwantu_require_rejection_for_rework"()
RETURNS trigger AS $$
DECLARE
  valid_rejection BOOLEAN;
  escrow_status "EscrowStatus";
BEGIN
  IF NEW."lifecycleState" = 'rework' AND OLD."lifecycleState" = 'acceptance_pending' THEN
    SELECT EXISTS(
      SELECT 1
      FROM "delivery_acceptance_decisions" a
      JOIN "deliveries" d ON d."id" = a."deliveryId"
      WHERE a."contractId" = NEW."id"
        AND a."decision" = 'reject'
        AND a."effectiveContractHash" = NEW."effectiveContractHash"
        AND d."sequence" = (
          SELECT MAX(d2."sequence") FROM "deliveries" d2 WHERE d2."contractId" = NEW."id"
        )
    ) INTO valid_rejection;

    IF NOT valid_rejection THEN
      RAISE EXCEPTION 'REWORK_REQUIRES_PROTOCOL_REJECTION';
    END IF;

    SELECT "status" INTO escrow_status FROM "escrows" WHERE "id" = NEW."escrowId";
    IF escrow_status IS DISTINCT FROM 'locked'::"EscrowStatus" THEN
      RAISE EXCEPTION 'REWORK_REQUIRES_LOCKED_ESCROW';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contracts_rework_transition_guard"
BEFORE UPDATE OF "lifecycleState" ON "contracts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_require_rejection_for_rework"();
