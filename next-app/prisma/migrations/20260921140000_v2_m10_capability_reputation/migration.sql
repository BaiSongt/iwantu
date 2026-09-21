-- V2-M10-03: AgentIdentity-level capability reputation evidence projection.
--
-- Historical capability attribution is derived only through immutable protocol facts:
-- ReputationEvidence -> Contract -> accepted OfferRevision -> sealed TaskRevision
-- -> TaskCapabilityRequirement.
--
-- IMPORTANT: current Contract / Delivery / Settlement evidence does not bind an
-- AgentVersion. This projection MUST NOT infer a historical version from current
-- AgentCapabilityClaim rows. Version-scoped reputation remains unavailable until
-- the protocol binds execution AgentVersion explicitly (see issue #44).
--
-- CapabilityDefinition remains an index, not an allowlist. Therefore capabilityId
-- deliberately has no FK to capability_definitions.

CREATE TABLE "reputation_capability_snapshots" (
  "id" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  "subjectPrincipalId" TEXT NOT NULL,
  "subjectAgentIdentityId" TEXT NOT NULL,
  "capabilityId" TEXT NOT NULL,
  "projection" JSONB NOT NULL,
  "rebuiltAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reputation_capability_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reputation_capability_projection_shape"
    CHECK (jsonb_typeof("projection") = 'object'),
  CONSTRAINT "reputation_capability_projection_version_valid"
    CHECK ("projectionVersion" = 'iwantu.capability-reputation.v0.1'),
  CONSTRAINT "reputation_capability_id_nonempty"
    CHECK (length("capabilityId") > 0)
);

CREATE UNIQUE INDEX "reputation_capability_subject_capability_version_key"
  ON "reputation_capability_snapshots"(
    "subjectPrincipalId",
    "subjectAgentIdentityId",
    "capabilityId",
    "projectionVersion"
  );

CREATE INDEX "reputation_capability_subject_idx"
  ON "reputation_capability_snapshots"(
    "subjectPrincipalId",
    "subjectAgentIdentityId",
    "rebuiltAt"
  );

CREATE INDEX "reputation_capability_capability_idx"
  ON "reputation_capability_snapshots"(
    "capabilityId",
    "rebuiltAt"
  );

ALTER TABLE "reputation_capability_snapshots"
  ADD CONSTRAINT "reputation_capability_subject_principal_fkey"
  FOREIGN KEY ("subjectPrincipalId") REFERENCES "principals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reputation_capability_snapshots"
  ADD CONSTRAINT "reputation_capability_subject_agent_fkey"
  FOREIGN KEY ("subjectAgentIdentityId") REFERENCES "agent_identities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_build_capability_reputation_projection"(
  p_subject_principal_id TEXT,
  p_subject_agent_identity_id TEXT,
  p_capability_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  projection JSONB;
BEGIN
  PERFORM "iwantu_assert_agent_principal_binding"(
    p_subject_principal_id,
    p_subject_agent_identity_id
  );

  IF p_capability_id IS NULL OR length(trim(p_capability_id)) = 0 THEN
    RAISE EXCEPTION 'REPUTATION_CAPABILITY_ID_INVALID';
  END IF;

  WITH capability_evidence AS (
    SELECT e.*
    FROM "reputation_evidence" e
    JOIN "contracts" c
      ON c."id" = e."contractId"
    JOIN "offer_revisions" o
      ON o."id" = c."acceptedOfferRevisionId"
    JOIN "task_capability_requirements" r
      ON r."taskRevisionId" = o."taskRevisionId"
     AND r."capabilityId" = p_capability_id
    WHERE e."subjectPrincipalId" = p_subject_principal_id
      AND e."subjectAgentIdentityId" = p_subject_agent_identity_id
  ),
  transaction_stats AS (
    SELECT
      count(*)::INTEGER AS settlement_count,
      count(*) FILTER (
        WHERE "counterpartyPrincipalId" <> p_subject_principal_id
      )::INTEGER AS independent_settlement_count,
      count(DISTINCT "counterpartyPrincipalId") FILTER (
        WHERE "counterpartyPrincipalId" <> p_subject_principal_id
      )::INTEGER AS independent_counterparty_principal_count,
      min("occurredAt") AS first_evidence_occurred_at,
      max("occurredAt") AS last_evidence_occurred_at
    FROM capability_evidence
    WHERE "evidenceClass" = 'transaction'
  ),
  economic_totals AS (
    SELECT
      COALESCE(
        sum(NULLIF("evidence" ->> 'grossAmount', '')::numeric),
        0
      ) AS gross_settled_credit,
      COALESCE(
        sum(NULLIF("evidence" ->> 'subjectReceivedAmount', '')::numeric),
        0
      ) AS subject_received_credit
    FROM capability_evidence
    WHERE "evidenceClass" = 'economic'
  )
  SELECT jsonb_build_object(
    'protocolVersion', 'iwantu.capability-reputation.v0.1',
    'subjectPrincipalId', p_subject_principal_id,
    'subjectAgentIdentityId', p_subject_agent_identity_id,
    'capabilityId', p_capability_id,
    'attributionBasis', 'task_required_capability',
    'versionScope', 'agent_identity',
    'agentVersionBinding', 'unbound',
    'agentVersionId', NULL,
    'evidenceState', CASE
      WHEN transaction_stats.settlement_count = 0
        THEN 'insufficient_evidence'
      ELSE 'observed'
    END,
    'settlementCount', transaction_stats.settlement_count,
    'independentSettlementCount',
      transaction_stats.independent_settlement_count,
    'independentCounterpartyPrincipalCount',
      transaction_stats.independent_counterparty_principal_count,
    'firstEvidenceOccurredAt',
      transaction_stats.first_evidence_occurred_at,
    'lastEvidenceOccurredAt',
      transaction_stats.last_evidence_occurred_at,
    'terminalOutcomes', COALESCE(
      (
        SELECT jsonb_object_agg(outcome_name, outcome_count ORDER BY outcome_name)
        FROM (
          SELECT
            "evidence" ->> 'terminalOutcome' AS outcome_name,
            count(*)::INTEGER AS outcome_count
          FROM capability_evidence
          WHERE "evidenceClass" = 'transaction'
          GROUP BY "evidence" ->> 'terminalOutcome'
        ) capability_outcomes
        WHERE outcome_name IS NOT NULL
      ),
      '{}'::jsonb
    ),
    'independentTerminalOutcomes', COALESCE(
      (
        SELECT jsonb_object_agg(outcome_name, outcome_count ORDER BY outcome_name)
        FROM (
          SELECT
            "evidence" ->> 'terminalOutcome' AS outcome_name,
            count(*)::INTEGER AS outcome_count
          FROM capability_evidence
          WHERE "evidenceClass" = 'transaction'
            AND "counterpartyPrincipalId" <> p_subject_principal_id
          GROUP BY "evidence" ->> 'terminalOutcome'
        ) independent_capability_outcomes
        WHERE outcome_name IS NOT NULL
      ),
      '{}'::jsonb
    ),
    'economic', jsonb_build_object(
      'currency', 'IWC',
      'grossSettledCredit', economic_totals.gross_settled_credit::text,
      'subjectReceivedCredit', economic_totals.subject_received_credit::text
    )
  )
  INTO projection
  FROM transaction_stats
  CROSS JOIN economic_totals;

  RETURN projection;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION "iwantu_validate_capability_reputation_snapshot"()
RETURNS trigger AS $$
DECLARE
  expected_id TEXT;
  expected_projection JSONB;
BEGIN
  expected_id :=
    'caprep:' ||
    NEW."subjectPrincipalId" || ':' ||
    NEW."subjectAgentIdentityId" || ':' ||
    NEW."capabilityId" || ':' ||
    NEW."projectionVersion";

  IF NEW."projectionVersion" <> 'iwantu.capability-reputation.v0.1'
     OR NEW."id" <> expected_id THEN
    RAISE EXCEPTION 'REPUTATION_CAPABILITY_SNAPSHOT_IDENTITY_INVALID';
  END IF;

  expected_projection := "iwantu_build_capability_reputation_projection"(
    NEW."subjectPrincipalId",
    NEW."subjectAgentIdentityId",
    NEW."capabilityId"
  );

  IF NEW."projection" IS DISTINCT FROM expected_projection THEN
    RAISE EXCEPTION 'REPUTATION_CAPABILITY_PROJECTION_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reputation_capability_canonical_projection_guard"
BEFORE INSERT OR UPDATE ON "reputation_capability_snapshots"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_capability_reputation_snapshot"();

CREATE OR REPLACE FUNCTION "iwantu_rebuild_capability_reputation_snapshot"(
  p_subject_principal_id TEXT,
  p_subject_agent_identity_id TEXT,
  p_capability_id TEXT
)
RETURNS SETOF "reputation_capability_snapshots" AS $$
DECLARE
  projection_version CONSTANT TEXT := 'iwantu.capability-reputation.v0.1';
  snapshot_id TEXT;
  canonical_projection JSONB;
BEGIN
  IF p_capability_id IS NULL OR length(trim(p_capability_id)) = 0 THEN
    RAISE EXCEPTION 'REPUTATION_CAPABILITY_ID_INVALID';
  END IF;

  snapshot_id :=
    'caprep:' ||
    p_subject_principal_id || ':' ||
    p_subject_agent_identity_id || ':' ||
    p_capability_id || ':' ||
    projection_version;

  canonical_projection := "iwantu_build_capability_reputation_projection"(
    p_subject_principal_id,
    p_subject_agent_identity_id,
    p_capability_id
  );

  INSERT INTO "reputation_capability_snapshots" (
    "id",
    "projectionVersion",
    "subjectPrincipalId",
    "subjectAgentIdentityId",
    "capabilityId",
    "projection",
    "rebuiltAt"
  ) VALUES (
    snapshot_id,
    projection_version,
    p_subject_principal_id,
    p_subject_agent_identity_id,
    p_capability_id,
    canonical_projection,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (
    "subjectPrincipalId",
    "subjectAgentIdentityId",
    "capabilityId",
    "projectionVersion"
  )
  DO UPDATE SET
    "id" = EXCLUDED."id",
    "projection" = EXCLUDED."projection",
    "rebuiltAt" = CURRENT_TIMESTAMP;

  RETURN QUERY
  SELECT *
  FROM "reputation_capability_snapshots"
  WHERE "subjectPrincipalId" = p_subject_principal_id
    AND "subjectAgentIdentityId" = p_subject_agent_identity_id
    AND "capabilityId" = p_capability_id
    AND "projectionVersion" = projection_version;
END;
$$ LANGUAGE plpgsql;

-- Backfill capability projections from immutable historical task requirements.
DO $$
DECLARE
  capability_row RECORD;
BEGIN
  FOR capability_row IN
    SELECT DISTINCT
      e."subjectPrincipalId",
      e."subjectAgentIdentityId",
      r."capabilityId"
    FROM "reputation_evidence" e
    JOIN "contracts" c
      ON c."id" = e."contractId"
    JOIN "offer_revisions" o
      ON o."id" = c."acceptedOfferRevisionId"
    JOIN "task_capability_requirements" r
      ON r."taskRevisionId" = o."taskRevisionId"
  LOOP
    PERFORM "iwantu_rebuild_capability_reputation_snapshot"(
      capability_row."subjectPrincipalId",
      capability_row."subjectAgentIdentityId",
      capability_row."capabilityId"
    );
  END LOOP;
END;
$$;

-- Deliberately no DELETE guard: this is a rebuildable read model.
-- Deliberately no capability_definitions FK: external/unknown namespace IDs remain valid.
