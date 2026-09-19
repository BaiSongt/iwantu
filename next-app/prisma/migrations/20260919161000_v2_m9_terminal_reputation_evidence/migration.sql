-- V2-M9-01: immutable terminal ReputationEvidence foundation.
-- Reputation source-of-truth is evidence, never a mutable score.
-- Only terminal Settlement facts emit reputation evidence; REJECT / REWORK claims
-- are intentionally excluded until a terminal economic outcome exists.

CREATE TABLE "reputation_evidence" (
  "id" TEXT NOT NULL,
  "settlementId" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "subjectRole" TEXT NOT NULL,
  "evidenceClass" TEXT NOT NULL,
  "evidenceType" TEXT NOT NULL,
  "subjectPrincipalId" TEXT NOT NULL,
  "subjectAgentIdentityId" TEXT NOT NULL,
  "counterpartyPrincipalId" TEXT NOT NULL,
  "counterpartyAgentIdentityId" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reputation_evidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reputation_evidence_subject_role_valid"
    CHECK ("subjectRole" IN ('buyer', 'supplier')),
  CONSTRAINT "reputation_evidence_class_valid"
    CHECK ("evidenceClass" IN ('transaction', 'economic')),
  CONSTRAINT "reputation_evidence_type_valid"
    CHECK (
      ("evidenceClass" = 'transaction' AND "evidenceType" = 'terminal_contract_outcome')
      OR
      ("evidenceClass" = 'economic' AND "evidenceType" = 'terminal_credit_flow')
    ),
  CONSTRAINT "reputation_evidence_shape"
    CHECK (jsonb_typeof("evidence") = 'object')
);

CREATE UNIQUE INDEX "reputation_evidence_settlement_subject_class_key"
  ON "reputation_evidence"("settlementId", "subjectRole", "evidenceClass");
CREATE INDEX "reputation_evidence_contract_idx"
  ON "reputation_evidence"("contractId", "occurredAt");
CREATE INDEX "reputation_evidence_subject_principal_idx"
  ON "reputation_evidence"("subjectPrincipalId", "occurredAt");
CREATE INDEX "reputation_evidence_subject_agent_idx"
  ON "reputation_evidence"("subjectAgentIdentityId", "occurredAt");

ALTER TABLE "reputation_evidence"
  ADD CONSTRAINT "reputation_evidence_settlement_fkey"
  FOREIGN KEY ("settlementId") REFERENCES "settlements"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reputation_evidence"
  ADD CONSTRAINT "reputation_evidence_contract_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reputation_evidence"
  ADD CONSTRAINT "reputation_evidence_subject_principal_fkey"
  FOREIGN KEY ("subjectPrincipalId") REFERENCES "principals"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reputation_evidence"
  ADD CONSTRAINT "reputation_evidence_subject_agent_fkey"
  FOREIGN KEY ("subjectAgentIdentityId") REFERENCES "agent_identities"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reputation_evidence"
  ADD CONSTRAINT "reputation_evidence_counterparty_principal_fkey"
  FOREIGN KEY ("counterpartyPrincipalId") REFERENCES "principals"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "reputation_evidence"
  ADD CONSTRAINT "reputation_evidence_counterparty_agent_fkey"
  FOREIGN KEY ("counterpartyAgentIdentityId") REFERENCES "agent_identities"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_build_terminal_reputation_evidence"(
  p_settlement_id TEXT,
  p_subject_role TEXT,
  p_evidence_class TEXT
)
RETURNS JSONB AS $$
DECLARE
  settlement_row RECORD;
  acceptance_source TEXT;
  terminal_outcome TEXT;
  delivery_attempts INTEGER;
  rejection_count INTEGER;
  disputed BOOLEAN;
  subject_received TEXT;
  counterparty_received TEXT;
BEGIN
  SELECT * INTO settlement_row
  FROM "settlements"
  WHERE "id" = p_settlement_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPUTATION_SETTLEMENT_NOT_FOUND';
  END IF;
  IF p_subject_role NOT IN ('buyer', 'supplier') THEN
    RAISE EXCEPTION 'REPUTATION_SUBJECT_ROLE_INVALID';
  END IF;
  IF p_evidence_class NOT IN ('transaction', 'economic') THEN
    RAISE EXCEPTION 'REPUTATION_EVIDENCE_CLASS_INVALID';
  END IF;

  acceptance_source := NULL;
  IF settlement_row."acceptanceDecisionId" IS NOT NULL THEN
    SELECT "source" INTO acceptance_source
    FROM "delivery_acceptance_decisions"
    WHERE "id" = settlement_row."acceptanceDecisionId";
  END IF;

  terminal_outcome := CASE
    WHEN settlement_row."type" = 'full_settlement' AND acceptance_source = 'auto_accept'
      THEN 'auto_accepted'
    WHEN settlement_row."type" = 'full_settlement'
      THEN 'success'
    WHEN settlement_row."type" = 'full_refund'
      THEN 'supplier_default'
    WHEN settlement_row."type" = 'mutual_split'
      THEN 'mutual_split'
    ELSE 'unknown'
  END;

  SELECT count(*)::INTEGER INTO delivery_attempts
  FROM "deliveries"
  WHERE "contractId" = settlement_row."contractId";

  SELECT count(*)::INTEGER INTO rejection_count
  FROM "delivery_acceptance_decisions"
  WHERE "contractId" = settlement_row."contractId"
    AND "decision" = 'reject';

  disputed := settlement_row."disputeId" IS NOT NULL;

  IF p_evidence_class = 'transaction' THEN
    RETURN jsonb_build_object(
      'protocolVersion', 'iwantu.reputation-evidence.v0.1',
      'settlementId', settlement_row."id",
      'contractId', settlement_row."contractId",
      'effectiveContractHash', settlement_row."effectiveContractHash",
      'settlementType', settlement_row."type",
      'terminalOutcome', terminal_outcome,
      'subjectRole', p_subject_role,
      'acceptanceSource', acceptance_source,
      'deliveryAttempts', delivery_attempts,
      'rejectionCount', rejection_count,
      'disputed', disputed,
      'deliveryId', settlement_row."deliveryId",
      'acceptanceDecisionId', settlement_row."acceptanceDecisionId",
      'supplierDefaultId', settlement_row."supplierDefaultId",
      'disputeId', settlement_row."disputeId",
      'mutualSettlementAgreementId', settlement_row."mutualSettlementAgreementId",
      'settlementHash', settlement_row."settlementHash"
    );
  END IF;

  IF p_subject_role = 'supplier' THEN
    subject_received := settlement_row."allocation" ->> 'supplierAmount';
    counterparty_received := settlement_row."allocation" ->> 'buyerRefundAmount';
  ELSE
    subject_received := settlement_row."allocation" ->> 'buyerRefundAmount';
    counterparty_received := settlement_row."allocation" ->> 'supplierAmount';
  END IF;

  RETURN jsonb_build_object(
    'protocolVersion', 'iwantu.reputation-evidence.v0.1',
    'settlementId', settlement_row."id",
    'contractId', settlement_row."contractId",
    'settlementType', settlement_row."type",
    'terminalOutcome', terminal_outcome,
    'subjectRole', p_subject_role,
    'currency', settlement_row."allocation" ->> 'currency',
    'grossAmount', settlement_row."allocation" ->> 'grossAmount',
    'subjectReceivedAmount', subject_received,
    'counterpartyReceivedAmount', counterparty_received,
    'ledgerTransactionId', settlement_row."ledgerTransactionId",
    'settlementHash', settlement_row."settlementHash"
  );
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION "iwantu_validate_reputation_evidence"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  settlement_row RECORD;
  expected_subject_principal_id TEXT;
  expected_subject_agent_id TEXT;
  expected_counterparty_principal_id TEXT;
  expected_counterparty_agent_id TEXT;
  expected_type TEXT;
  expected_evidence JSONB;
BEGIN
  SELECT * INTO settlement_row
  FROM "settlements"
  WHERE "id" = NEW."settlementId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPUTATION_REQUIRES_TERMINAL_SETTLEMENT';
  END IF;
  IF settlement_row."contractId" <> NEW."contractId" THEN
    RAISE EXCEPTION 'REPUTATION_SETTLEMENT_CONTRACT_MISMATCH';
  END IF;
  IF NEW."occurredAt" IS DISTINCT FROM settlement_row."createdAt" THEN
    RAISE EXCEPTION 'REPUTATION_OCCURRED_AT_MISMATCH';
  END IF;

  SELECT * INTO contract_row
  FROM "contracts"
  WHERE "id" = NEW."contractId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPUTATION_CONTRACT_NOT_FOUND';
  END IF;

  IF NEW."subjectRole" = 'supplier' THEN
    expected_subject_principal_id := contract_row."supplierPrincipalId";
    expected_subject_agent_id := contract_row."supplierAgentIdentityId";
    expected_counterparty_principal_id := contract_row."buyerPrincipalId";
    expected_counterparty_agent_id := contract_row."buyerAgentIdentityId";
  ELSIF NEW."subjectRole" = 'buyer' THEN
    expected_subject_principal_id := contract_row."buyerPrincipalId";
    expected_subject_agent_id := contract_row."buyerAgentIdentityId";
    expected_counterparty_principal_id := contract_row."supplierPrincipalId";
    expected_counterparty_agent_id := contract_row."supplierAgentIdentityId";
  ELSE
    RAISE EXCEPTION 'REPUTATION_SUBJECT_ROLE_INVALID';
  END IF;

  IF NEW."subjectPrincipalId" <> expected_subject_principal_id
     OR NEW."subjectAgentIdentityId" <> expected_subject_agent_id
     OR NEW."counterpartyPrincipalId" <> expected_counterparty_principal_id
     OR NEW."counterpartyAgentIdentityId" <> expected_counterparty_agent_id THEN
    RAISE EXCEPTION 'REPUTATION_PARTY_BINDING_MISMATCH';
  END IF;

  expected_type := CASE
    WHEN NEW."evidenceClass" = 'transaction' THEN 'terminal_contract_outcome'
    WHEN NEW."evidenceClass" = 'economic' THEN 'terminal_credit_flow'
    ELSE NULL
  END;
  IF expected_type IS NULL OR NEW."evidenceType" <> expected_type THEN
    RAISE EXCEPTION 'REPUTATION_EVIDENCE_TYPE_INVALID';
  END IF;

  expected_evidence := "iwantu_build_terminal_reputation_evidence"(
    NEW."settlementId",
    NEW."subjectRole",
    NEW."evidenceClass"
  );
  IF NEW."evidence" IS DISTINCT FROM expected_evidence THEN
    RAISE EXCEPTION 'REPUTATION_EVIDENCE_PAYLOAD_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reputation_evidence_binding_guard"
BEFORE INSERT ON "reputation_evidence"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_reputation_evidence"();

CREATE OR REPLACE FUNCTION "iwantu_prevent_reputation_evidence_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'REPUTATION_EVIDENCE_IS_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reputation_evidence_update_guard"
BEFORE UPDATE ON "reputation_evidence"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_reputation_evidence_mutation"();

CREATE TRIGGER "reputation_evidence_delete_guard"
BEFORE DELETE ON "reputation_evidence"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_reputation_evidence_mutation"();

CREATE OR REPLACE FUNCTION "iwantu_emit_terminal_reputation_evidence"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  role_name TEXT;
  class_name TEXT;
  subject_principal_id TEXT;
  subject_agent_id TEXT;
  counterparty_principal_id TEXT;
  counterparty_agent_id TEXT;
  evidence_type TEXT;
BEGIN
  SELECT * INTO contract_row
  FROM "contracts"
  WHERE "id" = NEW."contractId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPUTATION_CONTRACT_NOT_FOUND';
  END IF;

  FOREACH role_name IN ARRAY ARRAY['buyer', 'supplier']
  LOOP
    IF role_name = 'buyer' THEN
      subject_principal_id := contract_row."buyerPrincipalId";
      subject_agent_id := contract_row."buyerAgentIdentityId";
      counterparty_principal_id := contract_row."supplierPrincipalId";
      counterparty_agent_id := contract_row."supplierAgentIdentityId";
    ELSE
      subject_principal_id := contract_row."supplierPrincipalId";
      subject_agent_id := contract_row."supplierAgentIdentityId";
      counterparty_principal_id := contract_row."buyerPrincipalId";
      counterparty_agent_id := contract_row."buyerAgentIdentityId";
    END IF;

    FOREACH class_name IN ARRAY ARRAY['transaction', 'economic']
    LOOP
      evidence_type := CASE
        WHEN class_name = 'transaction' THEN 'terminal_contract_outcome'
        ELSE 'terminal_credit_flow'
      END;

      INSERT INTO "reputation_evidence" (
        "id", "settlementId", "contractId", "subjectRole",
        "evidenceClass", "evidenceType", "subjectPrincipalId",
        "subjectAgentIdentityId", "counterpartyPrincipalId",
        "counterpartyAgentIdentityId", "evidence", "occurredAt"
      ) VALUES (
        'rep:' || NEW."id" || ':' || role_name || ':' || class_name,
        NEW."id", NEW."contractId", role_name, class_name, evidence_type,
        subject_principal_id, subject_agent_id,
        counterparty_principal_id, counterparty_agent_id,
        "iwantu_build_terminal_reputation_evidence"(
          NEW."id",
          role_name,
          class_name
        ),
        NEW."createdAt"
      );
    END LOOP;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "settlements_terminal_reputation_evidence"
AFTER INSERT ON "settlements"
FOR EACH ROW EXECUTE FUNCTION "iwantu_emit_terminal_reputation_evidence"();

-- Backfill any terminal settlements that existed before the M9 migration.
DO $$
DECLARE
  settlement_row RECORD;
  contract_row RECORD;
  role_name TEXT;
  class_name TEXT;
  subject_principal_id TEXT;
  subject_agent_id TEXT;
  counterparty_principal_id TEXT;
  counterparty_agent_id TEXT;
  evidence_type TEXT;
BEGIN
  FOR settlement_row IN SELECT * FROM "settlements"
  LOOP
    SELECT * INTO contract_row
    FROM "contracts"
    WHERE "id" = settlement_row."contractId";

    FOREACH role_name IN ARRAY ARRAY['buyer', 'supplier']
    LOOP
      IF role_name = 'buyer' THEN
        subject_principal_id := contract_row."buyerPrincipalId";
        subject_agent_id := contract_row."buyerAgentIdentityId";
        counterparty_principal_id := contract_row."supplierPrincipalId";
        counterparty_agent_id := contract_row."supplierAgentIdentityId";
      ELSE
        subject_principal_id := contract_row."supplierPrincipalId";
        subject_agent_id := contract_row."supplierAgentIdentityId";
        counterparty_principal_id := contract_row."buyerPrincipalId";
        counterparty_agent_id := contract_row."buyerAgentIdentityId";
      END IF;

      FOREACH class_name IN ARRAY ARRAY['transaction', 'economic']
      LOOP
        evidence_type := CASE
          WHEN class_name = 'transaction' THEN 'terminal_contract_outcome'
          ELSE 'terminal_credit_flow'
        END;

        INSERT INTO "reputation_evidence" (
          "id", "settlementId", "contractId", "subjectRole",
          "evidenceClass", "evidenceType", "subjectPrincipalId",
          "subjectAgentIdentityId", "counterpartyPrincipalId",
          "counterpartyAgentIdentityId", "evidence", "occurredAt"
        ) VALUES (
          'rep:' || settlement_row."id" || ':' || role_name || ':' || class_name,
          settlement_row."id", settlement_row."contractId", role_name,
          class_name, evidence_type, subject_principal_id, subject_agent_id,
          counterparty_principal_id, counterparty_agent_id,
          "iwantu_build_terminal_reputation_evidence"(
            settlement_row."id",
            role_name,
            class_name
          ),
          settlement_row."createdAt"
        )
        ON CONFLICT ("settlementId", "subjectRole", "evidenceClass") DO NOTHING;
      END LOOP;
    END LOOP;
  END LOOP;
END;
$$;
