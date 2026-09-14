-- V2-M5-03B: atomic terminal Settlement foundation.
-- A Contract may have exactly one terminal Settlement. For full settlement,
-- immutable acceptance evidence, Escrow release, double-entry Ledger posting,
-- Settlement evidence and Contract closure form one atomic protocol transition.

CREATE TABLE "settlements" (
  "id" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "contractId" TEXT NOT NULL,
  "deliveryId" TEXT NOT NULL,
  "acceptanceDecisionId" TEXT NOT NULL,
  "effectiveContractHash" TEXT NOT NULL,
  "supplierPrincipalId" TEXT NOT NULL,
  "supplierAgentIdentityId" TEXT NOT NULL,
  "escrowId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "ledgerTransactionId" TEXT NOT NULL,
  "allocation" JSONB NOT NULL,
  "settlementHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "settlements_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "settlements_type_valid" CHECK ("type" = 'full_settlement'),
  CONSTRAINT "settlements_hash_shape" CHECK (length("settlementHash") = 64),
  CONSTRAINT "settlements_allocation_shape" CHECK (
    "allocation" ? 'currency'
    AND "allocation" ? 'grossAmount'
    AND "allocation" ? 'supplierAmount'
    AND "allocation" ? 'buyerRefundAmount'
  )
);

CREATE UNIQUE INDEX "settlements_contract_key" ON "settlements"("contractId");
CREATE UNIQUE INDEX "settlements_delivery_key" ON "settlements"("deliveryId");
CREATE UNIQUE INDEX "settlements_acceptance_decision_key" ON "settlements"("acceptanceDecisionId");
CREATE UNIQUE INDEX "settlements_escrow_key" ON "settlements"("escrowId");
CREATE UNIQUE INDEX "settlements_ledger_transaction_key" ON "settlements"("ledgerTransactionId");
CREATE UNIQUE INDEX "settlements_hash_key" ON "settlements"("settlementHash");
CREATE UNIQUE INDEX "settlements_idempotency_key" ON "settlements"("idempotencyKey");
CREATE INDEX "settlements_supplier_created_idx"
  ON "settlements"("supplierPrincipalId", "createdAt");

ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_contract_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_delivery_fkey"
  FOREIGN KEY ("deliveryId") REFERENCES "deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_acceptance_decision_fkey"
  FOREIGN KEY ("acceptanceDecisionId") REFERENCES "delivery_acceptance_decisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_supplier_principal_fkey"
  FOREIGN KEY ("supplierPrincipalId") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_supplier_agent_fkey"
  FOREIGN KEY ("supplierAgentIdentityId") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_escrow_fkey"
  FOREIGN KEY ("escrowId") REFERENCES "escrows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "settlements"
  ADD CONSTRAINT "settlements_ledger_transaction_fkey"
  FOREIGN KEY ("ledgerTransactionId") REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_validate_terminal_settlement"()
RETURNS trigger AS $$
DECLARE
  contract_row RECORD;
  delivery_row RECORD;
  acceptance_row RECORD;
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
  IF contract_row."lifecycleState" <> 'acceptance_pending' THEN
    RAISE EXCEPTION 'SETTLEMENT_REQUIRES_ACCEPTANCE_PENDING';
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
     OR ledger_row."type" <> 'settlement'::"LedgerTransactionType"
     OR ledger_row."referenceType" <> 'escrow_release'
     OR ledger_row."referenceId" <> NEW."contractId"
     OR ledger_row."idempotencyKey" <> 'escrow:release:' || NEW."contractId"
     OR ledger_row."transactionHash" IS NULL THEN
    RAISE EXCEPTION 'SETTLEMENT_LEDGER_EVIDENCE_INVALID';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "settlements_binding_guard"
BEFORE INSERT ON "settlements"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_terminal_settlement"();

CREATE OR REPLACE FUNCTION "iwantu_prevent_settlement_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'SETTLEMENT_IS_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "settlements_update_guard"
BEFORE UPDATE ON "settlements"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_settlement_mutation"();
CREATE TRIGGER "settlements_delete_guard"
BEFORE DELETE ON "settlements"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_settlement_mutation"();

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

    -- M2 Escrow primitives intentionally remain usable for non-Contract ledger tests
    -- and compatibility callers. The M5 gate applies only after a v2 Contract binds
    -- the Escrow as protocol authority.
    IF NOT protocol_contract_bound THEN
      RETURN NEW;
    END IF;

    SELECT EXISTS(
      SELECT 1 FROM "settlements" s
      WHERE s."contractId" = NEW."contractId"
        AND s."escrowId" = NEW."id"
        AND s."ledgerTransactionId" = NEW."releaseLedgerTransactionId"
        AND s."type" = 'full_settlement'
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

CREATE TRIGGER "escrows_settlement_release_guard"
BEFORE UPDATE OF "status", "releaseLedgerTransactionId", "releasedAt" ON "escrows"
FOR EACH ROW EXECUTE FUNCTION "iwantu_require_settlement_for_escrow_release"();

CREATE OR REPLACE FUNCTION "iwantu_require_settlement_for_contract_close"()
RETURNS trigger AS $$
DECLARE
  settlement_row RECORD;
  escrow_row RECORD;
BEGIN
  IF OLD."lifecycleState" = 'acceptance_pending'
     AND NEW."lifecycleState" = 'closed' THEN
    SELECT * INTO settlement_row
    FROM "settlements"
    WHERE "contractId" = NEW."id";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'CONTRACT_CLOSE_REQUIRES_TERMINAL_SETTLEMENT';
    END IF;

    SELECT * INTO escrow_row
    FROM "escrows"
    WHERE "id" = NEW."escrowId";
    IF NOT FOUND
       OR escrow_row."status" <> 'released'::"EscrowStatus"
       OR escrow_row."releaseLedgerTransactionId" IS DISTINCT FROM settlement_row."ledgerTransactionId" THEN
      RAISE EXCEPTION 'CONTRACT_CLOSE_REQUIRES_RELEASED_SETTLEMENT_ESCROW';
    END IF;
    IF NEW."closedAt" IS NULL THEN
      RAISE EXCEPTION 'CONTRACT_CLOSE_REQUIRES_TIMESTAMP';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "contracts_terminal_settlement_guard"
BEFORE UPDATE OF "lifecycleState", "closedAt" ON "contracts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_require_settlement_for_contract_close"();
