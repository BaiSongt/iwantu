-- V2-M4-02 closure: M3 intentionally reserved ACCEPTED / NOT_SELECTED / AWARDED
-- until atomic Contract Formation existed. M4 now permits those transitions only
-- when the already-inserted ACTIVE Contract proves the exact formation outcome.

CREATE OR REPLACE FUNCTION "protect_offer_envelope"()
RETURNS TRIGGER AS $$
DECLARE
  accepted_revision_id TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Offer rows are protocol history and cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."taskId" IS DISTINCT FROM OLD."taskId"
     OR NEW."supplierPrincipalId" IS DISTINCT FROM OLD."supplierPrincipalId"
     OR NEW."supplierAgentIdentityId" IS DISTINCT FROM OLD."supplierAgentIdentityId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Offer protocol identity and supplier ownership are immutable';
  END IF;

  IF NEW."currentRevision" < OLD."currentRevision"
     OR NEW."currentRevision" > OLD."currentRevision" + 1 THEN
    RAISE EXCEPTION 'Offer currentRevision may only advance by one';
  END IF;

  IF NEW."currentRevision" <> OLD."currentRevision" AND OLD."status" <> 'active' THEN
    RAISE EXCEPTION 'Only an active Offer may create a new revision';
  END IF;

  IF OLD."status" = 'active' AND NEW."status" = 'accepted' THEN
    SELECT c."acceptedOfferRevisionId"
    INTO accepted_revision_id
    FROM "contracts" c
    JOIN "offer_revisions" r ON r."id" = c."acceptedOfferRevisionId"
    WHERE c."taskId" = NEW."taskId"
      AND c."lifecycleState" <> 'closed'
      AND r."offerId" = NEW."id"
      AND r."revision" = NEW."currentRevision";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'OFFER_ACCEPTED_REQUIRES_MATCHING_ACTIVE_CONTRACT';
    END IF;
  ELSIF OLD."status" = 'active' AND NEW."status" = 'not_selected' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "contracts" c
      JOIN "offer_revisions" selected_revision ON selected_revision."id" = c."acceptedOfferRevisionId"
      WHERE c."taskId" = NEW."taskId"
        AND c."lifecycleState" <> 'closed'
        AND selected_revision."offerId" <> NEW."id"
    ) THEN
      RAISE EXCEPTION 'OFFER_NOT_SELECTED_REQUIRES_OTHER_ACCEPTED_CONTRACT';
    END IF;
  ELSIF OLD."status" = 'active' AND NEW."status" NOT IN ('active', 'withdrawn', 'closed') THEN
    RAISE EXCEPTION 'Offer ACCEPTED / NOT_SELECTED require atomic Contract Formation';
  ELSIF OLD."status" = 'accepted' AND NEW."status" <> 'accepted' THEN
    RAISE EXCEPTION 'Accepted Offer is terminal protocol history';
  ELSIF OLD."status" = 'withdrawn' AND NEW."status" <> 'withdrawn' THEN
    RAISE EXCEPTION 'Withdrawn Offer is terminal';
  ELSIF OLD."status" = 'not_selected' AND NEW."status" <> 'not_selected' THEN
    RAISE EXCEPTION 'Not-selected Offer is terminal protocol history';
  ELSIF OLD."status" = 'closed' AND NEW."status" <> 'closed' THEN
    RAISE EXCEPTION 'Closed Offer is terminal';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "protect_task_envelope"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Task rows are protocol history and cannot be deleted';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."issuerPrincipalId" IS DISTINCT FROM OLD."issuerPrincipalId"
     OR NEW."issuerAgentIdentityId" IS DISTINCT FROM OLD."issuerAgentIdentityId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'Task protocol identity and issuer ownership are immutable';
  END IF;

  IF NEW."currentRevision" < OLD."currentRevision"
     OR NEW."currentRevision" > OLD."currentRevision" + 1 THEN
    RAISE EXCEPTION 'Task currentRevision may only advance by one';
  END IF;

  IF OLD."status" NOT IN ('draft', 'open')
     AND NEW."currentRevision" <> OLD."currentRevision" THEN
    RAISE EXCEPTION 'Terminal or awarded Task cannot be revised';
  END IF;

  IF OLD."openedAt" IS NOT NULL AND NEW."openedAt" IS DISTINCT FROM OLD."openedAt" THEN
    RAISE EXCEPTION 'Task openedAt is immutable once set';
  END IF;
  IF OLD."closedAt" IS NOT NULL AND NEW."closedAt" IS DISTINCT FROM OLD."closedAt" THEN
    RAISE EXCEPTION 'Task closedAt is immutable once set';
  END IF;

  IF OLD."status" = 'draft' AND NEW."status" NOT IN ('draft', 'open', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid Task status transition from draft';
  ELSIF OLD."status" = 'open' AND NEW."status" = 'awarded' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM "contracts" c
      WHERE c."taskId" = NEW."id"
        AND c."buyerPrincipalId" = NEW."issuerPrincipalId"
        AND c."buyerAgentIdentityId" = NEW."issuerAgentIdentityId"
        AND c."lifecycleState" <> 'closed'
    ) THEN
      RAISE EXCEPTION 'TASK_AWARDED_REQUIRES_ACTIVE_CONTRACT';
    END IF;
  ELSIF OLD."status" = 'open' AND NEW."status" NOT IN ('open', 'cancelled', 'closed') THEN
    RAISE EXCEPTION 'Task AWARDED requires atomic Contract Formation';
  ELSIF OLD."status" = 'awarded' AND NEW."status" NOT IN ('awarded', 'closed') THEN
    RAISE EXCEPTION 'Invalid Task status transition from awarded';
  ELSIF OLD."status" = 'closed' AND NEW."status" <> 'closed' THEN
    RAISE EXCEPTION 'Closed Task is terminal';
  ELSIF OLD."status" = 'cancelled' AND NEW."status" <> 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled Task is terminal';
  END IF;

  IF NEW."status" = 'draft' AND NEW."openedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Draft Task cannot have openedAt';
  END IF;
  IF NEW."status" = 'open' AND NEW."openedAt" IS NULL THEN
    RAISE EXCEPTION 'Open Task requires openedAt';
  END IF;
  IF NEW."status" IN ('closed', 'cancelled') AND NEW."closedAt" IS NULL THEN
    RAISE EXCEPTION 'Closed or cancelled Task requires closedAt';
  END IF;
  IF NEW."status" IN ('draft', 'open', 'awarded') AND NEW."closedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Non-terminal Task cannot have closedAt';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
