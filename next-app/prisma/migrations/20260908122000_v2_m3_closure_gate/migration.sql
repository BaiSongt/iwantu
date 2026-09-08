-- V2-M3-07: close the unsigned Firm Offer withdrawal bypass.
-- A transition into WITHDRAWN is valid only after immutable signed withdrawal
-- evidence has been persisted and bound to the exact current Offer revision.

CREATE OR REPLACE FUNCTION "iwantu_validate_offer_withdrawal_receipt_binding"()
RETURNS trigger AS $$
DECLARE
  offer_row RECORD;
  current_offer_hash TEXT;
  snapshot_row RECORD;
BEGIN
  SELECT
    "status" AS status,
    "currentRevision" AS current_revision,
    "supplierPrincipalId" AS supplier_principal_id,
    "supplierAgentIdentityId" AS supplier_agent_identity_id
  INTO offer_row
  FROM "offers"
  WHERE "id" = NEW."offerId"
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_WITHDRAWAL_RECEIPT_OFFER_NOT_FOUND';
  END IF;

  IF offer_row.status <> 'active' THEN
    RAISE EXCEPTION 'OFFER_WITHDRAWAL_RECEIPT_REQUIRES_ACTIVE_OFFER';
  END IF;

  IF offer_row.current_revision <> NEW."offerRevision"
     OR offer_row.supplier_principal_id <> NEW."supplierPrincipalId"
     OR offer_row.supplier_agent_identity_id <> NEW."supplierAgentIdentityId" THEN
    RAISE EXCEPTION 'OFFER_WITHDRAWAL_RECEIPT_OFFER_BINDING_MISMATCH';
  END IF;

  SELECT "offerHash"
  INTO current_offer_hash
  FROM "offer_revisions"
  WHERE "offerId" = NEW."offerId"
    AND "revision" = NEW."offerRevision";

  IF NOT FOUND OR current_offer_hash <> NEW."offerHash" THEN
    RAISE EXCEPTION 'OFFER_WITHDRAWAL_RECEIPT_REVISION_BINDING_MISMATCH';
  END IF;

  SELECT
    "principalId" AS principal_id,
    "agentIdentityId" AS agent_identity_id,
    "resolvedAction" AS resolved_action,
    "requestEvidence" AS request_evidence
  INTO snapshot_row
  FROM "authority_snapshots"
  WHERE "id" = NEW."authoritySnapshotId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OFFER_WITHDRAWAL_RECEIPT_AUTHORITY_SNAPSHOT_NOT_FOUND';
  END IF;

  IF snapshot_row.principal_id <> NEW."supplierPrincipalId"
     OR snapshot_row.agent_identity_id <> NEW."supplierAgentIdentityId"
     OR snapshot_row.resolved_action <> 'offer.withdraw' THEN
    RAISE EXCEPTION 'OFFER_WITHDRAWAL_RECEIPT_AUTHORITY_BINDING_MISMATCH';
  END IF;

  IF snapshot_row.request_evidence ->> 'action' IS DISTINCT FROM 'offer.withdraw'
     OR snapshot_row.request_evidence ->> 'commandHash' IS DISTINCT FROM NEW."commandHash"
     OR snapshot_row.request_evidence ->> 'payloadHash' IS DISTINCT FROM NEW."withdrawalHash"
     OR snapshot_row.request_evidence ->> 'nonce' IS DISTINCT FROM NEW."nonce"
     OR snapshot_row.request_evidence ->> 'signingKeyId' IS DISTINCT FROM NEW."signingKeyId"
     OR snapshot_row.request_evidence ->> 'signatureAlgorithm' IS DISTINCT FROM NEW."signatureAlgorithm"
     OR snapshot_row.request_evidence ->> 'signingCredentialId' IS NULL THEN
    RAISE EXCEPTION 'OFFER_WITHDRAWAL_RECEIPT_COMMAND_BINDING_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "offer_withdrawal_receipts_binding_guard" ON "offer_withdrawal_receipts";
CREATE TRIGGER "offer_withdrawal_receipts_binding_guard"
BEFORE INSERT ON "offer_withdrawal_receipts"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_offer_withdrawal_receipt_binding"();

CREATE OR REPLACE FUNCTION "iwantu_require_signed_offer_withdrawal_receipt"()
RETURNS trigger AS $$
DECLARE
  current_offer_hash TEXT;
BEGIN
  IF OLD."status" IS DISTINCT FROM 'withdrawn' AND NEW."status" = 'withdrawn' THEN
    SELECT "offerHash"
    INTO current_offer_hash
    FROM "offer_revisions"
    WHERE "offerId" = NEW."id"
      AND "revision" = NEW."currentRevision";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'OFFER_WITHDRAWAL_CURRENT_REVISION_NOT_FOUND';
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM "offer_withdrawal_receipts" receipt
      WHERE receipt."offerId" = NEW."id"
        AND receipt."offerRevision" = NEW."currentRevision"
        AND receipt."offerHash" = current_offer_hash
        AND receipt."supplierPrincipalId" = NEW."supplierPrincipalId"
        AND receipt."supplierAgentIdentityId" = NEW."supplierAgentIdentityId"
    ) THEN
      RAISE EXCEPTION 'SIGNED_OFFER_WITHDRAWAL_RECEIPT_REQUIRED';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "offers_signed_withdrawal_gate" ON "offers";
CREATE TRIGGER "offers_signed_withdrawal_gate"
BEFORE UPDATE ON "offers"
FOR EACH ROW EXECUTE FUNCTION "iwantu_require_signed_offer_withdrawal_receipt"();
