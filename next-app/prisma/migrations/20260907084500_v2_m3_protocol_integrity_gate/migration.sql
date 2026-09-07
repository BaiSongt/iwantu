-- V2-M3-05: close the stored Firm Offer evidence-integrity gap before Contract Formation.
--
-- M3-04 verifies signatures and live authority in the canonical application path.
-- This migration makes the database independently reject OfferRevision rows that
-- attach an unrelated AuthoritySnapshot from the same supplier Principal/Agent.
-- The snapshot must describe the exact Offer hash, nonce, signing key/algorithm,
-- and the action implied by the immutable revision number.

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
  snapshot_action TEXT;
  snapshot_request JSONB;
  expected_action TEXT;
BEGIN
  SELECT "taskId", "supplierPrincipalId", "supplierAgentIdentityId"
    INTO offer_task_id, offer_supplier_principal_id, offer_supplier_agent_id
  FROM "offers"
  WHERE "id" = NEW."offerId";

  IF offer_task_id IS NULL THEN
    RAISE EXCEPTION 'OfferRevision parent Offer does not exist';
  END IF;

  SELECT "taskId", "contentHash"
    INTO revision_task_id, revision_task_hash
  FROM "task_revisions"
  WHERE "id" = NEW."taskRevisionId" AND "sealedAt" IS NOT NULL;

  IF revision_task_id IS NULL
     OR revision_task_id <> offer_task_id
     OR revision_task_hash <> NEW."taskHash" THEN
    RAISE EXCEPTION 'OfferRevision must bind an exact sealed TaskRevision/hash for its Offer Task';
  END IF;

  SELECT "principalId", "agentIdentityId", "resolvedAction", "requestEvidence"
    INTO snapshot_principal_id, snapshot_agent_id, snapshot_action, snapshot_request
  FROM "authority_snapshots"
  WHERE "id" = NEW."supplierAuthoritySnapshotId";

  IF snapshot_principal_id IS NULL THEN
    RAISE EXCEPTION 'OfferRevision AuthoritySnapshot does not exist';
  END IF;

  IF snapshot_principal_id IS DISTINCT FROM offer_supplier_principal_id
     OR snapshot_agent_id IS DISTINCT FROM offer_supplier_agent_id THEN
    RAISE EXCEPTION 'OfferRevision AuthoritySnapshot must belong to the supplier Principal/Agent';
  END IF;

  expected_action := CASE WHEN NEW."revision" = 1 THEN 'offer.issue' ELSE 'offer.revise' END;

  IF snapshot_action IS DISTINCT FROM expected_action
     OR jsonb_typeof(snapshot_request) IS DISTINCT FROM 'object'
     OR snapshot_request->>'action' IS DISTINCT FROM expected_action
     OR snapshot_request->>'payloadHash' IS DISTINCT FROM NEW."offerHash"
     OR snapshot_request->>'nonce' IS DISTINCT FROM NEW."nonce"
     OR snapshot_request->>'signingKeyId' IS DISTINCT FROM NEW."signatureKeyId"
     OR snapshot_request->>'signatureAlgorithm' IS DISTINCT FROM NEW."signatureAlgorithm" THEN
    RAISE EXCEPTION 'OfferRevision AuthoritySnapshot must bind the exact signed Firm Offer command evidence';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
