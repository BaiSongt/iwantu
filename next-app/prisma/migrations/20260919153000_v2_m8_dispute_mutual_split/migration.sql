-- V2-M8-01: immutable Dispute + bilateral Mutual Settlement + atomic MUTUAL_SPLIT.
-- REJECT is still only a claim. A Dispute freezes terminal settlement until a
-- valid resolution fact exists. MUTUAL_SPLIT requires Buyer and Supplier to
-- sign the same allocation evidence and resolves Escrow atomically.

CREATE TABLE "disputes" (
  "id" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "effectiveContractHash" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "deliveryHash" TEXT NOT NULL,
  "rejectionDecisionId" TEXT NOT NULL,
  "rejectionDecisionHash" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "openedAt" TIMESTAMP(3) NOT NULL,
  "disputeHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "disputes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "disputes_reason_valid"
    CHECK ("reasonCode" IN ('rework_not_granted', 'attempts_exhausted')),
  CONSTRAINT "disputes_hash_shape" CHECK (length("disputeHash") = 64)
);

CREATE UNIQUE INDEX "disputes_contract_key" ON "disputes"("contractId");
CREATE UNIQUE INDEX "disputes_rejection_key" ON "disputes"("rejectionDecisionId");
CREATE UNIQUE INDEX "disputes_hash_key" ON "disputes"("disputeHash");
CREATE INDEX "disputes_opened_idx" ON "disputes"("openedAt");

ALTER TABLE "disputes"
  ADD CONSTRAINT "disputes_contract_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes"
  ADD CONSTRAINT "disputes_delivery_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "disputes"
  ADD CONSTRAINT "disputes_rejection_fkey"
  FOREIGN KEY ("rejectionDecisionId") REFERENCES "delivery_acceptance_decisions"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_validate_dispute"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  delivery_row RECORD;
  rejection_row RECORD;
  offer_terms JSONB;
  policy_max_attempts INTEGER;
  escrow_status "EscrowStatus";
  latest_delivery_id TEXT;
BEGIN
  SELECT * INTO contract_row
  FROM "contracts"
  WHERE "id" = NEW."contractId"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'DISPUTE_CONTRACT_NOT_FOUND';
  END IF;
  IF contract_row."lifecycleState" <> 'acceptance_pending'::"ContractLifecycleState" THEN
    RAISE EXCEPTION 'DISPUTE_REQUIRES_ACCEPTANCE_PENDING';
  END IF;
  IF contract_row."effectiveContractHash" <> NEW."effectiveContractHash" THEN
    RAISE EXCEPTION 'DISPUTE_CONTRACT_HASH_MISMATCH';
  END IF;

  SELECT "id" INTO latest_delivery_id
  FROM "deliveries"
  WHERE "contractId" = NEW."contractId"
  ORDER BY "sequence" DESC
  LIMIT 1;
  IF latest_delivery_id IS DISTINCT FROM NEW."deliveryId" THEN
    RAISE EXCEPTION 'DISPUTE_REQUIRES_LATEST_DELIVERY';
  END IF;

  SELECT * INTO delivery_row
  FROM "deliveries"
  WHERE "id" = NEW."deliveryId";
  IF NOT FOUND
     OR delivery_row."contractId" <> NEW."contractId"
     OR delivery_row."effectiveContractHash" <> NEW."effectiveContractHash"
     OR delivery_row."deliveryHash" <> NEW."deliveryHash" THEN
    RAISE EXCEPTION 'DISPUTE_DELIVERY_EVIDENCE_INVALID';
  END IF;

  SELECT * INTO rejection_row
  FROM "delivery_acceptance_decisions"
  WHERE "id" = NEW."rejectionDecisionId";
  IF NOT FOUND
     OR rejection_row."contractId" <> NEW."contractId"
     OR rejection_row."deliveryId" <> NEW."deliveryId"
     OR rejection_row."decision" <> 'reject'
     OR rejection_row."effectiveContractHash" <> NEW."effectiveContractHash"
     OR rejection_row."deliveryHash" <> NEW."deliveryHash"
     OR rejection_row."decisionHash" <> NEW."rejectionDecisionHash" THEN
    RAISE EXCEPTION 'DISPUTE_REJECTION_EVIDENCE_INVALID';
  END IF;

  SELECT "termsPayload" INTO offer_terms
  FROM "offer_revisions"
  WHERE "id" = contract_row."acceptedOfferRevisionId";

  policy_max_attempts := 1;
  IF jsonb_typeof(offer_terms -> 'deliveryPolicy') = 'object'
     AND jsonb_typeof(offer_terms #> '{deliveryPolicy,maxAttempts}') = 'number' THEN
    policy_max_attempts := (offer_terms #>> '{deliveryPolicy,maxAttempts}')::INTEGER;
  END IF;

  IF NEW."reasonCode" = 'rework_not_granted' THEN
    IF policy_max_attempts > 1 THEN
      RAISE EXCEPTION 'DISPUTE_REASON_POLICY_MISMATCH';
    END IF;
  ELSIF NEW."reasonCode" = 'attempts_exhausted' THEN
    IF policy_max_attempts <= 1 OR delivery_row."sequence" < policy_max_attempts THEN
      RAISE EXCEPTION 'DISPUTE_REASON_POLICY_MISMATCH';
    END IF;
  END IF;

  IF NEW."openedAt" IS DISTINCT FROM rejection_row."decidedAt" THEN
    RAISE EXCEPTION 'DISPUTE_OPENED_AT_MISMATCH';
  END IF;

  SELECT "status" INTO escrow_status
  FROM "escrows"
  WHERE "id" = contract_row."escrowId";
  IF escrow_status IS DISTINCT FROM 'locked'::"EscrowStatus" THEN
    RAISE EXCEPTION 'DISPUTE_REQUIRES_LOCKED_ESCROW';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "disputes_binding_guard"
BEFORE INSERT ON "disputes"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_dispute"();

CREATE OR REPLACE FUNCTION "iwantu_prevent_dispute_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'DISPUTE_IS_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "disputes_update_guard"
BEFORE UPDATE ON "disputes"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_dispute_mutation"();

CREATE TRIGGER "disputes_delete_guard"
BEFORE DELETE ON "disputes"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_dispute_mutation"();

-- M7 allowed the state transition directly from a final rejection. M8 makes
-- the immutable Dispute fact the protocol authority for DISPUTED.
CREATE OR REPLACE FUNCTION "iwantu_require_exhausted_rejection_for_dispute"()
RETURNS trigger AS $$
DECLARE
  dispute_exists BOOLEAN;
  escrow_status "EscrowStatus";
BEGIN
  IF NEW."lifecycleState" = 'disputed'::"ContractLifecycleState"
     AND OLD."lifecycleState" = 'acceptance_pending'::"ContractLifecycleState" THEN
    SELECT EXISTS(
      SELECT 1
      FROM "disputes" d
      WHERE d."contractId" = NEW."id"
        AND d."effectiveContractHash" = NEW."effectiveContractHash"
    ) INTO dispute_exists;

    IF NOT dispute_exists THEN
      RAISE EXCEPTION 'DISPUTED_REQUIRES_PROTOCOL_DISPUTE';
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

CREATE TABLE "mutual_settlement_agreements" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "effectiveContractHash" TEXT NOT NULL,
  "disputeId" TEXT NOT NULL,
  "disputeHash" TEXT NOT NULL,
  "buyerPrincipalId" TEXT NOT NULL,
  "buyerAgentIdentityId" TEXT NOT NULL,
  "supplierPrincipalId" TEXT NOT NULL,
  "supplierAgentIdentityId" TEXT NOT NULL,
  "grossAmount" DECIMAL(36,8) NOT NULL,
  "supplierAmount" DECIMAL(36,8) NOT NULL,
  "buyerRefundAmount" DECIMAL(36,8) NOT NULL,
  "currency" TEXT NOT NULL,
  "agreementHash" TEXT NOT NULL,
  "buyerAuthoritySnapshotId" TEXT NOT NULL,
  "supplierAuthoritySnapshotId" TEXT NOT NULL,
  "buyerCommandHash" TEXT NOT NULL,
  "supplierCommandHash" TEXT NOT NULL,
  "buyerNonce" TEXT NOT NULL,
  "supplierNonce" TEXT NOT NULL,
  "buyerSigningKeyId" TEXT NOT NULL,
  "supplierSigningKeyId" TEXT NOT NULL,
  "buyerSignature" TEXT NOT NULL,
  "supplierSignature" TEXT NOT NULL,
  "agreedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "mutual_settlement_agreements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "mutual_settlement_amounts_valid" CHECK (
    "grossAmount" > 0
    AND "supplierAmount" > 0
    AND "buyerRefundAmount" > 0
    AND "supplierAmount" + "buyerRefundAmount" = "grossAmount"
  ),
  CONSTRAINT "mutual_settlement_currency_valid" CHECK ("currency" = 'IWC'),
  CONSTRAINT "mutual_settlement_hash_shape" CHECK (length("agreementHash") = 64),
  CONSTRAINT "mutual_settlement_signatures_present" CHECK (
    length("buyerSignature") > 0 AND length("supplierSignature") > 0
  )
);

CREATE UNIQUE INDEX "mutual_settlement_agreements_idempotency_key"
  ON "mutual_settlement_agreements"("idempotencyKey");
CREATE UNIQUE INDEX "mutual_settlement_agreements_contract_key"
  ON "mutual_settlement_agreements"("contractId");
CREATE UNIQUE INDEX "mutual_settlement_agreements_dispute_key"
  ON "mutual_settlement_agreements"("disputeId");
CREATE UNIQUE INDEX "mutual_settlement_agreements_hash_key"
  ON "mutual_settlement_agreements"("agreementHash");
CREATE UNIQUE INDEX "mutual_settlement_agreements_buyer_snapshot_key"
  ON "mutual_settlement_agreements"("buyerAuthoritySnapshotId");
CREATE UNIQUE INDEX "mutual_settlement_agreements_supplier_snapshot_key"
  ON "mutual_settlement_agreements"("supplierAuthoritySnapshotId");
CREATE UNIQUE INDEX "mutual_settlement_agreements_buyer_command_key"
  ON "mutual_settlement_agreements"("buyerCommandHash");
CREATE UNIQUE INDEX "mutual_settlement_agreements_supplier_command_key"
  ON "mutual_settlement_agreements"("supplierCommandHash");
CREATE UNIQUE INDEX "mutual_settlement_agreements_buyer_nonce_key"
  ON "mutual_settlement_agreements"("buyerNonce");
CREATE UNIQUE INDEX "mutual_settlement_agreements_supplier_nonce_key"
  ON "mutual_settlement_agreements"("supplierNonce");

ALTER TABLE "mutual_settlement_agreements"
  ADD CONSTRAINT "mutual_settlement_agreements_contract_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mutual_settlement_agreements"
  ADD CONSTRAINT "mutual_settlement_agreements_dispute_fkey"
  FOREIGN KEY ("disputeId") REFERENCES "disputes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mutual_settlement_agreements"
  ADD CONSTRAINT "mutual_settlement_agreements_buyer_principal_fkey"
  FOREIGN KEY ("buyerPrincipalId") REFERENCES "principals"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mutual_settlement_agreements"
  ADD CONSTRAINT "mutual_settlement_agreements_buyer_agent_fkey"
  FOREIGN KEY ("buyerAgentIdentityId") REFERENCES "agent_identities"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mutual_settlement_agreements"
  ADD CONSTRAINT "mutual_settlement_agreements_supplier_principal_fkey"
  FOREIGN KEY ("supplierPrincipalId") REFERENCES "principals"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mutual_settlement_agreements"
  ADD CONSTRAINT "mutual_settlement_agreements_supplier_agent_fkey"
  FOREIGN KEY ("supplierAgentIdentityId") REFERENCES "agent_identities"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mutual_settlement_agreements"
  ADD CONSTRAINT "mutual_settlement_agreements_buyer_snapshot_fkey"
  FOREIGN KEY ("buyerAuthoritySnapshotId") REFERENCES "authority_snapshots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "mutual_settlement_agreements"
  ADD CONSTRAINT "mutual_settlement_agreements_supplier_snapshot_fkey"
  FOREIGN KEY ("supplierAuthoritySnapshotId") REFERENCES "authority_snapshots"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_validate_mutual_settlement_agreement"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  dispute_row RECORD;
  escrow_row RECORD;
  buyer_snapshot RECORD;
  supplier_snapshot RECORD;
BEGIN
  SELECT * INTO contract_row
  FROM "contracts"
  WHERE "id" = NEW."contractId"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'MUTUAL_SETTLEMENT_CONTRACT_NOT_FOUND';
  END IF;
  IF contract_row."lifecycleState" <> 'disputed'::"ContractLifecycleState" THEN
    RAISE EXCEPTION 'MUTUAL_SETTLEMENT_REQUIRES_DISPUTED_CONTRACT';
  END IF;
  IF contract_row."effectiveContractHash" <> NEW."effectiveContractHash"
     OR contract_row."buyerPrincipalId" <> NEW."buyerPrincipalId"
     OR contract_row."buyerAgentIdentityId" <> NEW."buyerAgentIdentityId"
     OR contract_row."supplierPrincipalId" <> NEW."supplierPrincipalId"
     OR contract_row."supplierAgentIdentityId" <> NEW."supplierAgentIdentityId" THEN
    RAISE EXCEPTION 'MUTUAL_SETTLEMENT_CONTRACT_BINDING_MISMATCH';
  END IF;

  SELECT * INTO dispute_row
  FROM "disputes"
  WHERE "id" = NEW."disputeId";
  IF NOT FOUND
     OR dispute_row."contractId" <> NEW."contractId"
     OR dispute_row."effectiveContractHash" <> NEW."effectiveContractHash"
     OR dispute_row."disputeHash" <> NEW."disputeHash" THEN
    RAISE EXCEPTION 'MUTUAL_SETTLEMENT_DISPUTE_BINDING_MISMATCH';
  END IF;

  SELECT * INTO escrow_row
  FROM "escrows"
  WHERE "id" = contract_row."escrowId"
  FOR SHARE;
  IF NOT FOUND
     OR escrow_row."status" <> 'locked'::"EscrowStatus"
     OR escrow_row."currency" <> NEW."currency"
     OR escrow_row."amount" <> NEW."grossAmount" THEN
    RAISE EXCEPTION 'MUTUAL_SETTLEMENT_ESCROW_BINDING_MISMATCH';
  END IF;

  SELECT "principalId", "agentIdentityId", "resolvedAction", "requestEvidence"
  INTO buyer_snapshot
  FROM "authority_snapshots"
  WHERE "id" = NEW."buyerAuthoritySnapshotId";
  IF NOT FOUND
     OR buyer_snapshot."principalId" <> NEW."buyerPrincipalId"
     OR buyer_snapshot."agentIdentityId" <> NEW."buyerAgentIdentityId"
     OR buyer_snapshot."resolvedAction" <> 'settlement.mutual'
     OR buyer_snapshot."requestEvidence" ->> 'action' IS DISTINCT FROM 'settlement.mutual'
     OR buyer_snapshot."requestEvidence" ->> 'payloadHash' IS DISTINCT FROM NEW."agreementHash"
     OR buyer_snapshot."requestEvidence" ->> 'commandHash' IS DISTINCT FROM NEW."buyerCommandHash"
     OR buyer_snapshot."requestEvidence" ->> 'nonce' IS DISTINCT FROM NEW."buyerNonce"
     OR buyer_snapshot."requestEvidence" ->> 'signingKeyId' IS DISTINCT FROM NEW."buyerSigningKeyId" THEN
    RAISE EXCEPTION 'MUTUAL_SETTLEMENT_BUYER_AUTHORITY_INVALID';
  END IF;

  SELECT "principalId", "agentIdentityId", "resolvedAction", "requestEvidence"
  INTO supplier_snapshot
  FROM "authority_snapshots"
  WHERE "id" = NEW."supplierAuthoritySnapshotId";
  IF NOT FOUND
     OR supplier_snapshot."principalId" <> NEW."supplierPrincipalId"
     OR supplier_snapshot."agentIdentityId" <> NEW."supplierAgentIdentityId"
     OR supplier_snapshot."resolvedAction" <> 'settlement.mutual'
     OR supplier_snapshot."requestEvidence" ->> 'action' IS DISTINCT FROM 'settlement.mutual'
     OR supplier_snapshot."requestEvidence" ->> 'payloadHash' IS DISTINCT FROM NEW."agreementHash"
     OR supplier_snapshot."requestEvidence" ->> 'commandHash' IS DISTINCT FROM NEW."supplierCommandHash"
     OR supplier_snapshot."requestEvidence" ->> 'nonce' IS DISTINCT FROM NEW."supplierNonce"
     OR supplier_snapshot."requestEvidence" ->> 'signingKeyId' IS DISTINCT FROM NEW."supplierSigningKeyId" THEN
    RAISE EXCEPTION 'MUTUAL_SETTLEMENT_SUPPLIER_AUTHORITY_INVALID';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mutual_settlement_agreements_binding_guard"
BEFORE INSERT ON "mutual_settlement_agreements"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_mutual_settlement_agreement"();

CREATE OR REPLACE FUNCTION "iwantu_prevent_mutual_settlement_agreement_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'MUTUAL_SETTLEMENT_AGREEMENT_IS_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mutual_settlement_agreements_update_guard"
BEFORE UPDATE ON "mutual_settlement_agreements"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_mutual_settlement_agreement_mutation"();

CREATE TRIGGER "mutual_settlement_agreements_delete_guard"
BEFORE DELETE ON "mutual_settlement_agreements"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_mutual_settlement_agreement_mutation"();

ALTER TABLE "settlements"
  ADD COLUMN "disputeId" TEXT,
  ADD COLUMN "mutualSettlementAgreementId" TEXT;

ALTER TABLE "settlements"
  DROP CONSTRAINT "settlements_type_valid";
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_type_valid"
  CHECK ("type" IN ('full_settlement', 'full_refund', 'mutual_split'));

ALTER TABLE "settlements"
  DROP CONSTRAINT "settlements_terminal_evidence_shape";
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_terminal_evidence_shape"
  CHECK (
    (
      "type" = 'full_settlement'
      AND "deliveryId" IS NOT NULL
      AND "acceptanceDecisionId" IS NOT NULL
      AND "supplierDefaultId" IS NULL
      AND "disputeId" IS NULL
      AND "mutualSettlementAgreementId" IS NULL
    )
    OR
    (
      "type" = 'full_refund'
      AND "deliveryId" IS NULL
      AND "acceptanceDecisionId" IS NULL
      AND "supplierDefaultId" IS NOT NULL
      AND "disputeId" IS NULL
      AND "mutualSettlementAgreementId" IS NULL
    )
    OR
    (
      "type" = 'mutual_split'
      AND "deliveryId" IS NULL
      AND "acceptanceDecisionId" IS NULL
      AND "supplierDefaultId" IS NULL
      AND "disputeId" IS NOT NULL
      AND "mutualSettlementAgreementId" IS NOT NULL
    )
  );

CREATE UNIQUE INDEX "settlements_dispute_key"
  ON "settlements"("disputeId")
  WHERE "disputeId" IS NOT NULL;
CREATE UNIQUE INDEX "settlements_mutual_agreement_key"
  ON "settlements"("mutualSettlementAgreementId")
  WHERE "mutualSettlementAgreementId" IS NOT NULL;

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_dispute_fkey"
  FOREIGN KEY ("disputeId") REFERENCES "disputes"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_mutual_agreement_fkey"
  FOREIGN KEY ("mutualSettlementAgreementId") REFERENCES "mutual_settlement_agreements"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_validate_terminal_settlement"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  delivery_row RECORD;
  acceptance_row RECORD;
  default_row RECORD;
  dispute_row RECORD;
  agreement_row RECORD;
  escrow_row RECORD;
  ledger_row RECORD;
  latest_delivery_id TEXT;
  locked_debit NUMERIC(36,8);
  supplier_credit NUMERIC(36,8);
  buyer_credit NUMERIC(36,8);
BEGIN
  SELECT * INTO contract_row
  FROM "contracts"
  WHERE "id" = NEW."contractId"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SETTLEMENT_CONTRACT_NOT_FOUND';
  END IF;
  IF contract_row."effectiveContractHash" <> NEW."effectiveContractHash" THEN
    RAISE EXCEPTION 'SETTLEMENT_CONTRACT_HASH_MISMATCH';
  END IF;
  IF contract_row."supplierPrincipalId" <> NEW."supplierPrincipalId"
     OR contract_row."supplierAgentIdentityId" <> NEW."supplierAgentIdentityId" THEN
    RAISE EXCEPTION 'SETTLEMENT_SUPPLIER_BINDING_MISMATCH';
  END IF;
  IF contract_row."escrowId" IS DISTINCT FROM NEW."escrowId" THEN
    RAISE EXCEPTION 'SETTLEMENT_ESCROW_BINDING_MISMATCH';
  END IF;

  SELECT * INTO escrow_row
  FROM "escrows"
  WHERE "id" = NEW."escrowId" AND "contractId" = NEW."contractId"
  FOR SHARE;
  IF NOT FOUND OR escrow_row."status" <> 'locked'::"EscrowStatus" THEN
    RAISE EXCEPTION 'SETTLEMENT_REQUIRES_LOCKED_ESCROW';
  END IF;

  SELECT * INTO ledger_row
  FROM "ledger_transactions"
  WHERE "id" = NEW."ledgerTransactionId";
  IF NOT FOUND
     OR ledger_row."status" <> 'posted'::"LedgerTransactionStatus"
     OR ledger_row."transactionHash" IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_LEDGER_EVIDENCE_INVALID';
  END IF;

  IF NEW."type" = 'full_settlement' THEN
    IF contract_row."lifecycleState" <> 'acceptance_pending'::"ContractLifecycleState" THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRES_ACCEPTANCE_PENDING';
    END IF;

    SELECT "id" INTO latest_delivery_id
    FROM "deliveries"
    WHERE "contractId" = NEW."contractId"
    ORDER BY "sequence" DESC
    LIMIT 1;
    IF latest_delivery_id IS DISTINCT FROM NEW."deliveryId" THEN
      RAISE EXCEPTION 'SETTLEMENT_REQUIRES_LATEST_DELIVERY';
    END IF;

    SELECT * INTO delivery_row FROM "deliveries" WHERE "id" = NEW."deliveryId";
    IF NOT FOUND
       OR delivery_row."contractId" <> NEW."contractId"
       OR delivery_row."effectiveContractHash" <> NEW."effectiveContractHash" THEN
      RAISE EXCEPTION 'SETTLEMENT_DELIVERY_BINDING_MISMATCH';
    END IF;

    SELECT * INTO acceptance_row
    FROM "delivery_acceptance_decisions"
    WHERE "id" = NEW."acceptanceDecisionId";
    IF NOT FOUND
       OR acceptance_row."contractId" <> NEW."contractId"
       OR acceptance_row."deliveryId" <> NEW."deliveryId"
       OR acceptance_row."decision" <> 'accept'
       OR acceptance_row."effectiveContractHash" <> NEW."effectiveContractHash"
       OR acceptance_row."deliveryHash" <> delivery_row."deliveryHash"
       OR acceptance_row."source" NOT IN ('buyer_signed', 'auto_accept') THEN
      RAISE EXCEPTION 'SETTLEMENT_ACCEPTANCE_EVIDENCE_INVALID';
    END IF;

    IF ledger_row."type" <> 'settlement'::"LedgerTransactionType"
       OR ledger_row."referenceType" <> 'escrow_release'
       OR ledger_row."referenceId" <> NEW."contractId"
       OR ledger_row."idempotencyKey" <> 'escrow:release:' || NEW."contractId" THEN
      RAISE EXCEPTION 'SETTLEMENT_LEDGER_EVIDENCE_INVALID';
    END IF;

  ELSIF NEW."type" = 'full_refund' THEN
    IF contract_row."lifecycleState" <> 'active'::"ContractLifecycleState" THEN
      RAISE EXCEPTION 'REFUND_SETTLEMENT_REQUIRES_ACTIVE_CONTRACT';
    END IF;

    SELECT * INTO default_row
    FROM "supplier_defaults"
    WHERE "id" = NEW."supplierDefaultId";
    IF NOT FOUND
       OR default_row."contractId" <> NEW."contractId"
       OR default_row."effectiveContractHash" <> NEW."effectiveContractHash"
       OR default_row."supplierPrincipalId" <> NEW."supplierPrincipalId"
       OR default_row."supplierAgentIdentityId" <> NEW."supplierAgentIdentityId" THEN
      RAISE EXCEPTION 'REFUND_SETTLEMENT_DEFAULT_EVIDENCE_INVALID';
    END IF;

    IF EXISTS (SELECT 1 FROM "deliveries" WHERE "contractId" = NEW."contractId") THEN
      RAISE EXCEPTION 'REFUND_SETTLEMENT_REQUIRES_NO_VALID_DELIVERY';
    END IF;

    IF ledger_row."type" <> 'refund'::"LedgerTransactionType"
       OR ledger_row."referenceType" <> 'escrow_refund'
       OR ledger_row."referenceId" <> NEW."contractId"
       OR ledger_row."idempotencyKey" <> 'escrow:refund:' || NEW."contractId" THEN
      RAISE EXCEPTION 'REFUND_SETTLEMENT_LEDGER_EVIDENCE_INVALID';
    END IF;

  ELSIF NEW."type" = 'mutual_split' THEN
    IF contract_row."lifecycleState" <> 'disputed'::"ContractLifecycleState" THEN
      RAISE EXCEPTION 'MUTUAL_SPLIT_REQUIRES_DISPUTED_CONTRACT';
    END IF;

    SELECT * INTO dispute_row FROM "disputes" WHERE "id" = NEW."disputeId";
    SELECT * INTO agreement_row
    FROM "mutual_settlement_agreements"
    WHERE "id" = NEW."mutualSettlementAgreementId";

    IF dispute_row."id" IS NULL
       OR agreement_row."id" IS NULL
       OR dispute_row."contractId" <> NEW."contractId"
       OR dispute_row."effectiveContractHash" <> NEW."effectiveContractHash"
       OR agreement_row."contractId" <> NEW."contractId"
       OR agreement_row."effectiveContractHash" <> NEW."effectiveContractHash"
       OR agreement_row."disputeId" <> dispute_row."id"
       OR agreement_row."disputeHash" <> dispute_row."disputeHash" THEN
      RAISE EXCEPTION 'MUTUAL_SPLIT_RESOLUTION_EVIDENCE_INVALID';
    END IF;

    IF (NEW."allocation" ->> 'currency') IS DISTINCT FROM agreement_row."currency"
       OR (NEW."allocation" ->> 'grossAmount')::NUMERIC(36,8) <> agreement_row."grossAmount"
       OR (NEW."allocation" ->> 'supplierAmount')::NUMERIC(36,8) <> agreement_row."supplierAmount"
       OR (NEW."allocation" ->> 'buyerRefundAmount')::NUMERIC(36,8) <> agreement_row."buyerRefundAmount" THEN
      RAISE EXCEPTION 'MUTUAL_SPLIT_ALLOCATION_MISMATCH';
    END IF;

    IF ledger_row."type" <> 'settlement'::"LedgerTransactionType"
       OR ledger_row."referenceType" <> 'escrow_mutual_split'
       OR ledger_row."referenceId" <> NEW."contractId"
       OR ledger_row."idempotencyKey" <> 'escrow:mutual_split:' || NEW."contractId" THEN
      RAISE EXCEPTION 'MUTUAL_SPLIT_LEDGER_EVIDENCE_INVALID';
    END IF;

    SELECT COALESCE(sum(e."amount"), 0) INTO locked_debit
    FROM "ledger_entries" e
    JOIN "ledger_accounts" a ON a."id" = e."accountId"
    WHERE e."transactionId" = NEW."ledgerTransactionId"
      AND e."side" = 'debit'::"LedgerEntrySide"
      AND a."principalId" = contract_row."buyerPrincipalId"
      AND a."type" = 'principal_locked'::"LedgerAccountType";

    SELECT COALESCE(sum(e."amount"), 0) INTO supplier_credit
    FROM "ledger_entries" e
    JOIN "ledger_accounts" a ON a."id" = e."accountId"
    WHERE e."transactionId" = NEW."ledgerTransactionId"
      AND e."side" = 'credit'::"LedgerEntrySide"
      AND a."principalId" = contract_row."supplierPrincipalId"
      AND a."type" = 'principal_available'::"LedgerAccountType";

    SELECT COALESCE(sum(e."amount"), 0) INTO buyer_credit
    FROM "ledger_entries" e
    JOIN "ledger_accounts" a ON a."id" = e."accountId"
    WHERE e."transactionId" = NEW."ledgerTransactionId"
      AND e."side" = 'credit'::"LedgerEntrySide"
      AND a."principalId" = contract_row."buyerPrincipalId"
      AND a."type" = 'principal_available'::"LedgerAccountType";

    IF locked_debit <> agreement_row."grossAmount"
       OR supplier_credit <> agreement_row."supplierAmount"
       OR buyer_credit <> agreement_row."buyerRefundAmount" THEN
      RAISE EXCEPTION 'MUTUAL_SPLIT_LEDGER_ALLOCATION_INVALID';
    END IF;
  ELSE
    RAISE EXCEPTION 'SETTLEMENT_TYPE_INVALID';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "iwantu_require_settlement_for_escrow_release"()
RETURNS trigger AS $$
DECLARE
  protocol_contract_bound BOOLEAN;
  valid_settlement BOOLEAN;
BEGIN
  IF OLD."status" = 'locked'::"EscrowStatus"
     AND NEW."status" = 'released'::"EscrowStatus" THEN
    SELECT EXISTS(
      SELECT 1 FROM "contracts" c
      WHERE c."id" = NEW."contractId" AND c."escrowId" = NEW."id"
    ) INTO protocol_contract_bound;

    IF NOT protocol_contract_bound THEN
      RETURN NEW;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM "settlements" s
      WHERE s."contractId" = NEW."contractId"
        AND s."escrowId" = NEW."id"
        AND s."ledgerTransactionId" = NEW."releaseLedgerTransactionId"
        AND s."type" IN ('full_settlement', 'mutual_split')
    ) INTO valid_settlement;

    IF NOT valid_settlement THEN
      RAISE EXCEPTION 'ESCROW_RELEASE_REQUIRES_PROTOCOL_SETTLEMENT';
    END IF;
    IF NEW."releasedAt" IS NULL THEN
      RAISE EXCEPTION 'ESCROW_RELEASE_REQUIRES_TIMESTAMP';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "iwantu_require_settlement_for_contract_close"()
RETURNS trigger AS $$
DECLARE
  settlement_row RECORD;
  escrow_row RECORD;
BEGIN
  IF NEW."lifecycleState" = 'closed'::"ContractLifecycleState"
     AND OLD."lifecycleState" <> 'closed'::"ContractLifecycleState" THEN
    SELECT * INTO settlement_row
    FROM "settlements"
    WHERE "contractId" = NEW."id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONTRACT_CLOSE_REQUIRES_TERMINAL_SETTLEMENT';
    END IF;

    SELECT * INTO escrow_row
    FROM "escrows"
    WHERE "id" = NEW."escrowId";

    IF OLD."lifecycleState" = 'acceptance_pending'::"ContractLifecycleState" THEN
      IF settlement_row."type" <> 'full_settlement'
         OR escrow_row."status" <> 'released'::"EscrowStatus"
         OR escrow_row."releaseLedgerTransactionId" IS DISTINCT FROM settlement_row."ledgerTransactionId" THEN
        RAISE EXCEPTION 'CONTRACT_CLOSE_REQUIRES_RELEASED_SETTLEMENT_ESCROW';
      END IF;
    ELSIF OLD."lifecycleState" = 'active'::"ContractLifecycleState" THEN
      IF settlement_row."type" <> 'full_refund'
         OR escrow_row."status" <> 'refunded'::"EscrowStatus"
         OR escrow_row."refundLedgerTransactionId" IS DISTINCT FROM settlement_row."ledgerTransactionId" THEN
        RAISE EXCEPTION 'CONTRACT_CLOSE_REQUIRES_REFUNDED_SETTLEMENT_ESCROW';
      END IF;
    ELSIF OLD."lifecycleState" = 'disputed'::"ContractLifecycleState" THEN
      IF settlement_row."type" <> 'mutual_split'
         OR escrow_row."status" <> 'released'::"EscrowStatus"
         OR escrow_row."releaseLedgerTransactionId" IS DISTINCT FROM settlement_row."ledgerTransactionId" THEN
        RAISE EXCEPTION 'CONTRACT_CLOSE_REQUIRES_MUTUAL_SPLIT_ESCROW';
      END IF;
    END IF;

    IF NEW."closedAt" IS NULL THEN
      RAISE EXCEPTION 'CONTRACT_CLOSE_REQUIRES_TIMESTAMP';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
