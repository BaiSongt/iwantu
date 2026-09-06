-- V2-M3-03: Task / Firm Offer lifecycle and eligibility foundation.
-- Staleness remains derived from exact Task/Offer revision evidence; no mutable
-- isStale flag is introduced. ACCEPTED / NOT_SELECTED / AWARDED remain reserved
-- for future atomic Contract Formation and cannot be entered by ordinary writes.

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
  ELSIF OLD."status" = 'open' AND NEW."status" NOT IN ('open', 'cancelled', 'closed') THEN
    RAISE EXCEPTION 'Task AWARDED is reserved for atomic Contract Formation';
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

CREATE OR REPLACE FUNCTION "protect_offer_envelope"()
RETURNS TRIGGER AS $$
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

  IF OLD."status" = 'active' AND NEW."status" NOT IN ('active', 'withdrawn', 'closed') THEN
    RAISE EXCEPTION 'Offer ACCEPTED / NOT_SELECTED are reserved for atomic Contract Formation';
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

CREATE OR REPLACE FUNCTION "assert_task_offer_lifecycle_consistency"()
RETURNS TRIGGER AS $$
DECLARE
  target_task_id TEXT;
  task_status "TaskStatus";
  active_offer_count INTEGER;
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    target_task_id := NEW."id";
  ELSE
    target_task_id := NEW."taskId";
  END IF;

  SELECT "status" INTO task_status
  FROM "tasks"
  WHERE "id" = target_task_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT count(*)::INTEGER INTO active_offer_count
  FROM "offers"
  WHERE "taskId" = target_task_id AND "status" = 'active';

  IF task_status <> 'open' AND active_offer_count > 0 THEN
    RAISE EXCEPTION 'Only an OPEN Task may retain ACTIVE Firm Offers';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "tasks_offer_lifecycle_consistency_trigger" ON "tasks";
CREATE CONSTRAINT TRIGGER "tasks_offer_lifecycle_consistency_trigger"
AFTER INSERT OR UPDATE ON "tasks"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_task_offer_lifecycle_consistency"();

DROP TRIGGER IF EXISTS "offers_task_lifecycle_consistency_trigger" ON "offers";
CREATE CONSTRAINT TRIGGER "offers_task_lifecycle_consistency_trigger"
AFTER INSERT OR UPDATE ON "offers"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_task_offer_lifecycle_consistency"();
