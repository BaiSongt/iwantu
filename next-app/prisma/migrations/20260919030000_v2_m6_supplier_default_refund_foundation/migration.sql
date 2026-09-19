-- V2-M6-01: deterministic Supplier Default + atomic full refund foundation.
-- Missing the immutable contractual delivery deadline without any protocol-valid Delivery
-- creates a deterministic SupplierDefault fact. SupplierDefault, refund Ledger posting,
-- FULL_REFUND terminal Settlement, Escrow REFUNDED and Contract CLOSED are one atomic path.

CREATE TABLE "supplier_defaults" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "effectiveContractHash" TEXT NOT NULL,
  "supplierPrincipalId" TEXT NOT NULL,
  "supplierAgentIdentityId" TEXT NOT NULL,
  "deliveryDeadline" TIMESTAMP(3) NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "supplier_defaults_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "supplier_defaults_reason_valid" CHECK ("reasonCode" = 'delivery_deadline_missed'),
  CONSTRAINT "supplier_defaults_hash_shape" CHECK (length("evidenceHash") = 64)
);

CREATE UNIQUE INDEX "supplier_defaults_idempotency_key" ON "supplier_defaults"("idempotencyKey");
CREATE UNIQUE INDEX "supplier_defaults_contract_key" ON "supplier_defaults"("contractId");
CREATE UNIQUE INDEX "supplier_defaults_evidence_hash_key" ON "supplier_defaults"("evidenceHash");
CREATE INDEX "supplier_defaults_supplier_observed_idx"
  ON "supplier_defaults"("supplierPrincipalId", "observedAt");

ALTER TABLE "supplier_defaults"
  ADD CONSTRAINT "supplier_defaults_contract_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_defaults"
  ADD CONSTRAINT "supplier_defaults_supplier_principal_fkey"
  FOREIGN KEY ("supplierPrincipalId") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "supplier_defaults"
  ADD CONSTRAINT "supplier_defaults_supplier_agent_fkey"
  FOREIGN KEY ("supplierAgentIdentityId") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_validate_supplier_default"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  offer_row RECORD;
  expected_deadline TIMESTAMP(3);
BEGIN
  SELECT * INTO contract_row
  FROM "contracts"
  WHERE "id" = NEW."contractId"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'SUPPLIER_DEFAULT_CONTRACT_NOT_FOUND';
  END IF;
  IF contract_row."lifecycleState" <> 'active'::"ContractLifecycleState" THEN
    RAISE EXCEPTION 'SUPPLIER_DEFAULT_REQUIRES_ACTIVE_CONTRACT';
  END IF;
  IF contract_row."effectiveContractHash" <> NEW."effectiveContractHash" THEN
    RAISE EXCEPTION 'SUPPLIER_DEFAULT_CONTRACT_HASH_MISMATCH';
  END IF;
  IF contract_row."supplierPrincipalId" <> NEW."supplierPrincipalId"
     OR contract_row."supplierAgentIdentityId" <> NEW."supplierAgentIdentityId" THEN
    RAISE EXCEPTION 'SUPPLIER_DEFAULT_SUPPLIER_BINDING_MISMATCH';
  END IF;

  SELECT "deliveryCommitmentSeconds" INTO offer_row
  FROM "offer_revisions"
  WHERE "id" = contract_row."acceptedOfferRevisionId";

  IF NOT FOUND OR offer_row."deliveryCommitmentSeconds" IS NULL THEN
    RAISE EXCEPTION 'SUPPLIER_DEFAULT_REQUIRES_DELIVERY_DEADLINE';
  END IF;

  expected_deadline :=
    contract_row."activatedAt" + make_interval(secs => offer_row."deliveryCommitmentSeconds");

  IF NEW."deliveryDeadline" <> expected_deadline THEN
    RAISE EXCEPTION 'SUPPLIER_DEFAULT_DEADLINE_BINDING_MISMATCH';
  END IF;
  IF NEW."observedAt" < expected_deadline OR CURRENT_TIMESTAMP < expected_deadline THEN
    RAISE EXCEPTION 'SUPPLIER_DEFAULT_NOT_DUE';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "deliveries"
    WHERE "contractId" = NEW."contractId"
  ) THEN
    RAISE EXCEPTION 'SUPPLIER_DEFAULT_REQUIRES_NO_VALID_DELIVERY';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "supplier_defaults_binding_guard"
BEFORE INSERT ON "supplier_defaults"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_supplier_default"();

CREATE OR REPLACE FUNCTION "iwantu_prevent_supplier_default_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SUPPLIER_DEFAULT_IS_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "supplier_defaults_update_guard"
BEFORE UPDATE ON "supplier_defaults"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_supplier_default_mutation"();
CREATE TRIGGER "supplier_defaults_delete_guard"
BEFORE DELETE ON "supplier_defaults"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_supplier_default_mutation"();

ALTER TABLE "settlements"
  ALTER COLUMN "deliveryId" DROP NOT NULL,
  ALTER COLUMN "acceptanceDecisionId" DROP NOT NULL,
  ADD COLUMN "supplierDefaultId" TEXT;

ALTER TABLE "settlements"
  DROP CONSTRAINT "settlements_type_valid";

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_type_valid"
  CHECK ("type" IN ('full_settlement', 'full_refund'));

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_terminal_evidence_shape"
  CHECK (
    (
      "type" = 'full_settlement'
      AND "deliveryId" IS NOT NULL
      AND "acceptanceDecisionId" IS NOT NULL
      AND "supplierDefaultId" IS NULL
    )
    OR
    (
      "type" = 'full_refund'
      AND "deliveryId" IS NULL
      AND "acceptanceDecisionId" IS NULL
      AND "supplierDefaultId" IS NOT NULL
    )
  );

CREATE UNIQUE INDEX "settlements_supplier_default_key"
  ON "settlements"("supplierDefaultId")
  WHERE "supplierDefaultId" IS NOT NULL;

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_supplier_default_fkey"
  FOREIGN KEY ("supplierDefaultId") REFERENCES "supplier_defaults"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_validate_terminal_settlement"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  delivery_row RECORD;
  acceptance_row RECORD;
  default_row RECORD;
  escrow_row RECORD;
  ledger_row RECORD;
  latest_delivery_id TEXT;
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

    SELECT * INTO delivery_row
    FROM "deliveries"
    WHERE "id" = NEW."deliveryId";
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

    IF EXISTS (
      SELECT 1 FROM "deliveries" WHERE "contractId" = NEW."contractId"
    ) THEN
      RAISE EXCEPTION 'REFUND_SETTLEMENT_REQUIRES_NO_VALID_DELIVERY';
    END IF;

    IF ledger_row."type" <> 'refund'::"LedgerTransactionType"
       OR ledger_row."referenceType" <> 'escrow_refund'
       OR ledger_row."referenceId" <> NEW."contractId"
       OR ledger_row."idempotencyKey" <> 'escrow:refund:' || NEW."contractId" THEN
      RAISE EXCEPTION 'REFUND_SETTLEMENT_LEDGER_EVIDENCE_INVALID';
    END IF;
  ELSE
    RAISE EXCEPTION 'SETTLEMENT_TYPE_INVALID';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "iwantu_require_settlement_for_escrow_refund"()
RETURNS trigger AS $$
DECLARE
  protocol_contract_bound BOOLEAN;
  valid_settlement BOOLEAN;
BEGIN
  IF OLD."status" = 'locked'::"EscrowStatus"
     AND NEW."status" = 'refunded'::"EscrowStatus" THEN
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
        AND s."ledgerTransactionId" = NEW."refundLedgerTransactionId"
        AND s."type" = 'full_refund'
    ) INTO valid_settlement;

    IF NOT valid_settlement THEN
      RAISE EXCEPTION 'ESCROW_REFUND_REQUIRES_PROTOCOL_SETTLEMENT';
    END IF;
    IF NEW."refundedAt" IS NULL THEN
      RAISE EXCEPTION 'ESCROW_REFUND_REQUIRES_TIMESTAMP';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "escrows_settlement_refund_guard"
BEFORE UPDATE OF "status", "refundLedgerTransactionId", "refundedAt" ON "escrows"
FOR EACH ROW EXECUTE FUNCTION "iwantu_require_settlement_for_escrow_refund"();

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
         OR NOT FOUND
         OR escrow_row."status" <> 'released'::"EscrowStatus"
         OR escrow_row."releaseLedgerTransactionId" IS DISTINCT FROM settlement_row."ledgerTransactionId" THEN
        RAISE EXCEPTION 'CONTRACT_CLOSE_REQUIRES_RELEASED_SETTLEMENT_ESCROW';
      END IF;
    ELSIF OLD."lifecycleState" = 'active'::"ContractLifecycleState" THEN
      IF settlement_row."type" <> 'full_refund'
         OR NOT FOUND
         OR escrow_row."status" <> 'refunded'::"EscrowStatus"
         OR escrow_row."refundLedgerTransactionId" IS DISTINCT FROM settlement_row."ledgerTransactionId" THEN
        RAISE EXCEPTION 'CONTRACT_CLOSE_REQUIRES_REFUNDED_SETTLEMENT_ESCROW';
      END IF;
    END IF;

    IF NEW."closedAt" IS NULL THEN
      RAISE EXCEPTION 'CONTRACT_CLOSE_REQUIRES_TIMESTAMP';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
