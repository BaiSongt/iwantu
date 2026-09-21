-- V2-M10-01: deterministic ReputationSnapshot read-model foundation.
-- ReputationEvidence remains the protocol source of truth. Snapshots are derived,
-- replaceable projections that may be deleted and rebuilt at any time.

CREATE TABLE "reputation_snapshots" (
  "id" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  "subjectPrincipalId" TEXT NOT NULL,
  "subjectAgentIdentityId" TEXT NOT NULL,
  "projection" JSONB NOT NULL,
  "rebuiltAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reputation_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reputation_snapshots_projection_shape"
    CHECK (jsonb_typeof("projection") = 'object'),
  CONSTRAINT "reputation_snapshots_projection_version_valid"
    CHECK ("projectionVersion" = 'iwantu.reputation-snapshot.v0.1')
);

CREATE UNIQUE INDEX "reputation_snapshots_subject_version_key"
  ON "reputation_snapshots"(
    "subjectPrincipalId",
    "subjectAgentIdentityId",
    "projectionVersion"
  );

CREATE INDEX "reputation_snapshots_subject_principal_idx"
  ON "reputation_snapshots"("subjectPrincipalId", "rebuiltAt");
CREATE INDEX "reputation_snapshots_subject_agent_idx"
  ON "reputation_snapshots"("subjectAgentIdentityId", "rebuiltAt");

ALTER TABLE "reputation_snapshots"
  ADD CONSTRAINT "reputation_snapshots_subject_principal_fkey"
  FOREIGN KEY ("subjectPrincipalId") REFERENCES "principals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reputation_snapshots"
  ADD CONSTRAINT "reputation_snapshots_subject_agent_fkey"
  FOREIGN KEY ("subjectAgentIdentityId") REFERENCES "agent_identities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_build_reputation_snapshot_projection"(
  p_subject_principal_id TEXT,
  p_subject_agent_identity_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  agent_principal_id TEXT;
  projection JSONB;
BEGIN
  SELECT "principalId"
  INTO agent_principal_id
  FROM "agent_identities"
  WHERE "id" = p_subject_agent_identity_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPUTATION_SNAPSHOT_AGENT_NOT_FOUND';
  END IF;

  IF agent_principal_id <> p_subject_principal_id THEN
    RAISE EXCEPTION 'REPUTATION_SNAPSHOT_SUBJECT_BINDING_MISMATCH';
  END IF;

  WITH subject_evidence AS (
    SELECT *
    FROM "reputation_evidence"
    WHERE "subjectPrincipalId" = p_subject_principal_id
      AND "subjectAgentIdentityId" = p_subject_agent_identity_id
  ),
  stats AS (
    SELECT
      count(*)::INTEGER AS evidence_count,
      count(DISTINCT "settlementId")::INTEGER AS settlement_count,
      count(*) FILTER (WHERE "evidenceClass" = 'transaction')::INTEGER
        AS transaction_evidence_count,
      count(*) FILTER (WHERE "evidenceClass" = 'economic')::INTEGER
        AS economic_evidence_count,
      count(DISTINCT "counterpartyPrincipalId")::INTEGER
        AS counterparty_principal_count,
      min("occurredAt") AS first_evidence_occurred_at,
      max("occurredAt") AS last_evidence_occurred_at
    FROM subject_evidence
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
      ) AS subject_received_credit,
      COALESCE(
        sum(NULLIF("evidence" ->> 'counterpartyReceivedAmount', '')::numeric),
        0
      ) AS counterparty_received_credit
    FROM subject_evidence
    WHERE "evidenceClass" = 'economic'
  )
  SELECT jsonb_build_object(
    'protocolVersion', 'iwantu.reputation-snapshot.v0.1',
    'subjectPrincipalId', p_subject_principal_id,
    'subjectAgentIdentityId', p_subject_agent_identity_id,
    'evidenceState', CASE
      WHEN stats.evidence_count = 0 THEN 'insufficient_evidence'
      ELSE 'observed'
    END,
    'evidenceCount', stats.evidence_count,
    'settlementCount', stats.settlement_count,
    'transactionEvidenceCount', stats.transaction_evidence_count,
    'economicEvidenceCount', stats.economic_evidence_count,
    'counterpartyPrincipalCount', stats.counterparty_principal_count,
    'firstEvidenceOccurredAt', stats.first_evidence_occurred_at,
    'lastEvidenceOccurredAt', stats.last_evidence_occurred_at,
    'terminalOutcomes', COALESCE(
      (
        SELECT jsonb_object_agg(outcome_name, outcome_count ORDER BY outcome_name)
        FROM (
          SELECT
            "evidence" ->> 'terminalOutcome' AS outcome_name,
            count(*)::INTEGER AS outcome_count
          FROM subject_evidence
          WHERE "evidenceClass" = 'transaction'
          GROUP BY "evidence" ->> 'terminalOutcome'
        ) outcome_counts
        WHERE outcome_name IS NOT NULL
      ),
      '{}'::jsonb
    ),
    'settlementTypes', COALESCE(
      (
        SELECT jsonb_object_agg(settlement_type, settlement_count ORDER BY settlement_type)
        FROM (
          SELECT
            "evidence" ->> 'settlementType' AS settlement_type,
            count(*)::INTEGER AS settlement_count
          FROM subject_evidence
          WHERE "evidenceClass" = 'transaction'
          GROUP BY "evidence" ->> 'settlementType'
        ) settlement_counts
        WHERE settlement_type IS NOT NULL
      ),
      '{}'::jsonb
    ),
    'economic', jsonb_build_object(
      'currency', 'IWC',
      'grossSettledCredit', economic_totals.gross_settled_credit::text,
      'subjectReceivedCredit', economic_totals.subject_received_credit::text,
      'counterpartyReceivedCredit', economic_totals.counterparty_received_credit::text
    )
  )
  INTO projection
  FROM stats
  CROSS JOIN economic_totals;

  RETURN projection;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION "iwantu_validate_reputation_snapshot"()
RETURNS trigger AS $$
DECLARE
  expected_projection JSONB;
  expected_id TEXT;
BEGIN
  IF NEW."projectionVersion" <> 'iwantu.reputation-snapshot.v0.1' THEN
    RAISE EXCEPTION 'REPUTATION_SNAPSHOT_VERSION_INVALID';
  END IF;

  expected_id :=
    'repsnap:' ||
    NEW."subjectPrincipalId" || ':' ||
    NEW."subjectAgentIdentityId" || ':' ||
    NEW."projectionVersion";

  IF NEW."id" <> expected_id THEN
    RAISE EXCEPTION 'REPUTATION_SNAPSHOT_ID_INVALID';
  END IF;

  expected_projection := "iwantu_build_reputation_snapshot_projection"(
    NEW."subjectPrincipalId",
    NEW."subjectAgentIdentityId"
  );

  IF NEW."projection" IS DISTINCT FROM expected_projection THEN
    RAISE EXCEPTION 'REPUTATION_SNAPSHOT_PROJECTION_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reputation_snapshots_canonical_projection_guard"
BEFORE INSERT OR UPDATE ON "reputation_snapshots"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_reputation_snapshot"();

CREATE OR REPLACE FUNCTION "iwantu_rebuild_reputation_snapshot"(
  p_subject_principal_id TEXT,
  p_subject_agent_identity_id TEXT
)
RETURNS SETOF "reputation_snapshots" AS $$
DECLARE
  projection_version CONSTANT TEXT := 'iwantu.reputation-snapshot.v0.1';
  snapshot_id TEXT;
  canonical_projection JSONB;
BEGIN
  snapshot_id :=
    'repsnap:' ||
    p_subject_principal_id || ':' ||
    p_subject_agent_identity_id || ':' ||
    projection_version;

  canonical_projection := "iwantu_build_reputation_snapshot_projection"(
    p_subject_principal_id,
    p_subject_agent_identity_id
  );

  INSERT INTO "reputation_snapshots" (
    "id",
    "projectionVersion",
    "subjectPrincipalId",
    "subjectAgentIdentityId",
    "projection",
    "rebuiltAt"
  ) VALUES (
    snapshot_id,
    projection_version,
    p_subject_principal_id,
    p_subject_agent_identity_id,
    canonical_projection,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (
    "subjectPrincipalId",
    "subjectAgentIdentityId",
    "projectionVersion"
  )
  DO UPDATE SET
    "id" = EXCLUDED."id",
    "projection" = EXCLUDED."projection",
    "rebuiltAt" = CURRENT_TIMESTAMP;

  RETURN QUERY
  SELECT *
  FROM "reputation_snapshots"
  WHERE "subjectPrincipalId" = p_subject_principal_id
    AND "subjectAgentIdentityId" = p_subject_agent_identity_id
    AND "projectionVersion" = projection_version;
END;
$$ LANGUAGE plpgsql;

-- Deliberately no DELETE guard on reputation_snapshots.
-- A snapshot is disposable cache/read-model state; deleting it must never delete,
-- mutate, or otherwise alter immutable reputation_evidence.
