-- V2-M3-01: protocol-native Task / immutable TaskRevision foundation.
-- Legacy Demand remains untouched. TaskRevision is assembled transactionally,
-- sealed before commit, and immutable afterwards. Capability requirements are
-- revision-scoped discovery/protocol facts and deliberately do NOT foreign-key
-- CapabilityDefinition because the registry remains an index, not an allowlist.

CREATE TYPE "TaskStatus" AS ENUM ('draft', 'open', 'awarded', 'closed', 'cancelled');
CREATE TYPE "TaskVisibility" AS ENUM ('public', 'unlisted', 'private');

CREATE TABLE "tasks" (
    "id" TEXT NOT NULL,
    "issuerPrincipalId" TEXT NOT NULL,
    "issuerAgentIdentityId" TEXT NOT NULL,
    "status" "TaskStatus" NOT NULL DEFAULT 'draft',
    "visibility" "TaskVisibility" NOT NULL DEFAULT 'public',
    "currentRevision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_revisions" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "protocolPayload" JSONB NOT NULL,
    "workPayload" JSONB NOT NULL,
    "marketPayload" JSONB NOT NULL,
    "trustPayload" JSONB NOT NULL,
    "policyPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sealedAt" TIMESTAMP(3),

    CONSTRAINT "task_revisions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "task_capability_requirements" (
    "id" TEXT NOT NULL,
    "taskRevisionId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "requirementPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_capability_requirements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tasks_issuerPrincipalId_status_createdAt_idx"
ON "tasks"("issuerPrincipalId", "status", "createdAt");
CREATE INDEX "tasks_issuerAgentIdentityId_status_idx"
ON "tasks"("issuerAgentIdentityId", "status");
CREATE INDEX "tasks_visibility_status_createdAt_idx"
ON "tasks"("visibility", "status", "createdAt");

CREATE UNIQUE INDEX "task_revisions_taskId_revision_key"
ON "task_revisions"("taskId", "revision");
CREATE UNIQUE INDEX "task_revisions_taskId_contentHash_key"
ON "task_revisions"("taskId", "contentHash");
CREATE INDEX "task_revisions_taskId_createdAt_idx"
ON "task_revisions"("taskId", "createdAt");

CREATE UNIQUE INDEX "task_capability_requirements_taskRevisionId_capabilityId_key"
ON "task_capability_requirements"("taskRevisionId", "capabilityId");
CREATE INDEX "task_capability_requirements_capabilityId_taskRevisionId_idx"
ON "task_capability_requirements"("capabilityId", "taskRevisionId");

ALTER TABLE "tasks"
ADD CONSTRAINT "tasks_issuerPrincipalId_fkey"
FOREIGN KEY ("issuerPrincipalId") REFERENCES "principals"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks"
ADD CONSTRAINT "tasks_issuerAgentIdentityId_fkey"
FOREIGN KEY ("issuerAgentIdentityId") REFERENCES "agent_identities"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_revisions"
ADD CONSTRAINT "task_revisions_taskId_fkey"
FOREIGN KEY ("taskId") REFERENCES "tasks"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "task_capability_requirements"
ADD CONSTRAINT "task_capability_requirements_taskRevisionId_fkey"
FOREIGN KEY ("taskRevisionId") REFERENCES "task_revisions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "tasks"
ADD CONSTRAINT "tasks_current_revision_positive_check"
CHECK ("currentRevision" >= 1);

ALTER TABLE "tasks"
ADD CONSTRAINT "tasks_lifecycle_timestamps_check" CHECK (
  ("status" = 'draft' AND "openedAt" IS NULL AND "closedAt" IS NULL)
  OR ("status" = 'open' AND "openedAt" IS NOT NULL AND "closedAt" IS NULL)
  OR ("status" = 'awarded' AND "openedAt" IS NOT NULL AND "closedAt" IS NULL)
  OR ("status" = 'closed' AND "openedAt" IS NOT NULL AND "closedAt" IS NOT NULL)
  OR ("status" = 'cancelled' AND "closedAt" IS NOT NULL)
);

ALTER TABLE "task_revisions"
ADD CONSTRAINT "task_revisions_revision_positive_check"
CHECK ("revision" >= 1);

ALTER TABLE "task_revisions"
ADD CONSTRAINT "task_revisions_content_hash_check"
CHECK ("contentHash" ~ '^[0-9a-f]{64}$');

ALTER TABLE "task_revisions"
ADD CONSTRAINT "task_revisions_payload_objects_check" CHECK (
  jsonb_typeof("protocolPayload") = 'object'
  AND jsonb_typeof("workPayload") = 'object'
  AND jsonb_typeof("marketPayload") = 'object'
  AND jsonb_typeof("trustPayload") = 'object'
  AND jsonb_typeof("policyPayload") = 'object'
);

ALTER TABLE "task_capability_requirements"
ADD CONSTRAINT "task_capability_requirements_capability_nonempty_check"
CHECK (length(btrim("capabilityId")) > 0);

ALTER TABLE "task_capability_requirements"
ADD CONSTRAINT "task_capability_requirements_payload_object_check"
CHECK ("requirementPayload" IS NULL OR jsonb_typeof("requirementPayload") = 'object');

CREATE OR REPLACE FUNCTION "enforce_task_issuer_ownership"()
RETURNS TRIGGER AS $$
DECLARE
  agent_principal_id TEXT;
BEGIN
  SELECT "principalId" INTO agent_principal_id
  FROM "agent_identities"
  WHERE "id" = NEW."issuerAgentIdentityId";

  IF agent_principal_id IS NULL THEN
    RAISE EXCEPTION 'Task issuer AgentIdentity does not exist';
  END IF;

  IF agent_principal_id <> NEW."issuerPrincipalId" THEN
    RAISE EXCEPTION 'Task issuer AgentIdentity must belong to issuer Principal';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tasks_issuer_ownership_trigger"
BEFORE INSERT OR UPDATE OF "issuerPrincipalId", "issuerAgentIdentityId"
ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "enforce_task_issuer_ownership"();

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
  ELSIF OLD."status" = 'open' AND NEW."status" NOT IN ('open', 'awarded', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid Task status transition from open';
  ELSIF OLD."status" = 'awarded' AND NEW."status" NOT IN ('awarded', 'closed') THEN
    RAISE EXCEPTION 'Invalid Task status transition from awarded';
  ELSIF OLD."status" = 'closed' AND NEW."status" <> 'closed' THEN
    RAISE EXCEPTION 'Closed Task is terminal';
  ELSIF OLD."status" = 'cancelled' AND NEW."status" <> 'cancelled' THEN
    RAISE EXCEPTION 'Cancelled Task is terminal';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tasks_protocol_history_trigger"
BEFORE UPDATE OR DELETE ON "tasks"
FOR EACH ROW EXECUTE FUNCTION "protect_task_envelope"();

CREATE OR REPLACE FUNCTION "protect_task_revision"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TaskRevision is append-only and cannot be deleted';
  END IF;

  IF OLD."sealedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'Sealed TaskRevision is immutable';
  END IF;

  IF NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."taskId" IS DISTINCT FROM OLD."taskId"
     OR NEW."revision" IS DISTINCT FROM OLD."revision"
     OR NEW."contentHash" IS DISTINCT FROM OLD."contentHash"
     OR NEW."protocolPayload" IS DISTINCT FROM OLD."protocolPayload"
     OR NEW."workPayload" IS DISTINCT FROM OLD."workPayload"
     OR NEW."marketPayload" IS DISTINCT FROM OLD."marketPayload"
     OR NEW."trustPayload" IS DISTINCT FROM OLD."trustPayload"
     OR NEW."policyPayload" IS DISTINCT FROM OLD."policyPayload"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     OR NEW."sealedAt" IS NULL THEN
    RAISE EXCEPTION 'TaskRevision may only transition once from unsealed to sealed';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_revisions_immutable_trigger"
BEFORE UPDATE OR DELETE ON "task_revisions"
FOR EACH ROW EXECUTE FUNCTION "protect_task_revision"();

CREATE OR REPLACE FUNCTION "protect_task_capability_requirement"()
RETURNS TRIGGER AS $$
DECLARE
  revision_sealed_at TIMESTAMP(3);
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'TaskCapabilityRequirement is append-only and immutable';
  END IF;

  SELECT "sealedAt" INTO revision_sealed_at
  FROM "task_revisions"
  WHERE "id" = NEW."taskRevisionId";

  IF NOT FOUND THEN
    RAISE EXCEPTION 'TaskRevision does not exist';
  END IF;

  IF revision_sealed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot add capability requirements to a sealed TaskRevision';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "task_capability_requirements_immutable_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "task_capability_requirements"
FOR EACH ROW EXECUTE FUNCTION "protect_task_capability_requirement"();

CREATE OR REPLACE FUNCTION "assert_task_revision_consistency"()
RETURNS TRIGGER AS $$
DECLARE
  target_task_id TEXT;
  task_current_revision INTEGER;
  revision_count INTEGER;
  min_revision INTEGER;
  max_revision INTEGER;
  all_sealed BOOLEAN;
BEGIN
  IF TG_TABLE_NAME = 'tasks' THEN
    target_task_id := NEW."id";
  ELSE
    target_task_id := NEW."taskId";
  END IF;

  SELECT "currentRevision" INTO task_current_revision
  FROM "tasks"
  WHERE "id" = target_task_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  SELECT
    count(*)::INTEGER,
    min("revision"),
    max("revision"),
    bool_and("sealedAt" IS NOT NULL)
  INTO revision_count, min_revision, max_revision, all_sealed
  FROM "task_revisions"
  WHERE "taskId" = target_task_id;

  IF revision_count <> task_current_revision
     OR min_revision <> 1
     OR max_revision <> task_current_revision
     OR all_sealed IS DISTINCT FROM TRUE THEN
    RAISE EXCEPTION 'Task currentRevision must reference a contiguous, fully sealed revision chain';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "tasks_revision_consistency_trigger"
AFTER INSERT OR UPDATE ON "tasks"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_task_revision_consistency"();

CREATE CONSTRAINT TRIGGER "task_revisions_consistency_trigger"
AFTER INSERT OR UPDATE ON "task_revisions"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "assert_task_revision_consistency"();
