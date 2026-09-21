-- V2-M10-02: Local Trust / Global Trust evidence projections.
-- These are derived read models only. They do not replace immutable ReputationEvidence
-- and deliberately introduce no trust score.
--
-- Semantics:
--   Local Trust: relationship evidence for one directional counterparty Agent -> subject Agent pair.
--   Global Trust basis: only evidence from independent Principals contributes.
--   Repeated transactions with one Principal remain visible, but are separated from
--   counterparty diversity so repetition cannot masquerade as broad market trust.

CREATE TABLE "reputation_local_trust_snapshots" (
  "id" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  "subjectPrincipalId" TEXT NOT NULL,
  "subjectAgentIdentityId" TEXT NOT NULL,
  "counterpartyPrincipalId" TEXT NOT NULL,
  "counterpartyAgentIdentityId" TEXT NOT NULL,
  "projection" JSONB NOT NULL,
  "rebuiltAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reputation_local_trust_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reputation_local_trust_projection_shape"
    CHECK (jsonb_typeof("projection") = 'object'),
  CONSTRAINT "reputation_local_trust_projection_version_valid"
    CHECK ("projectionVersion" = 'iwantu.local-trust.v0.1')
);

CREATE UNIQUE INDEX "reputation_local_trust_subject_counterparty_version_key"
  ON "reputation_local_trust_snapshots"(
    "subjectAgentIdentityId",
    "counterpartyAgentIdentityId",
    "projectionVersion"
  );

CREATE INDEX "reputation_local_trust_subject_idx"
  ON "reputation_local_trust_snapshots"(
    "subjectPrincipalId",
    "subjectAgentIdentityId",
    "rebuiltAt"
  );

CREATE INDEX "reputation_local_trust_counterparty_idx"
  ON "reputation_local_trust_snapshots"(
    "counterpartyPrincipalId",
    "counterpartyAgentIdentityId",
    "rebuiltAt"
  );

ALTER TABLE "reputation_local_trust_snapshots"
  ADD CONSTRAINT "reputation_local_trust_subject_principal_fkey"
  FOREIGN KEY ("subjectPrincipalId") REFERENCES "principals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reputation_local_trust_snapshots"
  ADD CONSTRAINT "reputation_local_trust_subject_agent_fkey"
  FOREIGN KEY ("subjectAgentIdentityId") REFERENCES "agent_identities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reputation_local_trust_snapshots"
  ADD CONSTRAINT "reputation_local_trust_counterparty_principal_fkey"
  FOREIGN KEY ("counterpartyPrincipalId") REFERENCES "principals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reputation_local_trust_snapshots"
  ADD CONSTRAINT "reputation_local_trust_counterparty_agent_fkey"
  FOREIGN KEY ("counterpartyAgentIdentityId") REFERENCES "agent_identities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reputation_global_trust_snapshots" (
  "id" TEXT NOT NULL,
  "projectionVersion" TEXT NOT NULL,
  "subjectPrincipalId" TEXT NOT NULL,
  "subjectAgentIdentityId" TEXT NOT NULL,
  "projection" JSONB NOT NULL,
  "rebuiltAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "reputation_global_trust_snapshots_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "reputation_global_trust_projection_shape"
    CHECK (jsonb_typeof("projection") = 'object'),
  CONSTRAINT "reputation_global_trust_projection_version_valid"
    CHECK ("projectionVersion" = 'iwantu.global-trust.v0.1')
);

CREATE UNIQUE INDEX "reputation_global_trust_subject_version_key"
  ON "reputation_global_trust_snapshots"(
    "subjectPrincipalId",
    "subjectAgentIdentityId",
    "projectionVersion"
  );

CREATE INDEX "reputation_global_trust_subject_idx"
  ON "reputation_global_trust_snapshots"(
    "subjectPrincipalId",
    "subjectAgentIdentityId",
    "rebuiltAt"
  );

ALTER TABLE "reputation_global_trust_snapshots"
  ADD CONSTRAINT "reputation_global_trust_subject_principal_fkey"
  FOREIGN KEY ("subjectPrincipalId") REFERENCES "principals"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "reputation_global_trust_snapshots"
  ADD CONSTRAINT "reputation_global_trust_subject_agent_fkey"
  FOREIGN KEY ("subjectAgentIdentityId") REFERENCES "agent_identities"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_assert_agent_principal_binding"(
  p_principal_id TEXT,
  p_agent_identity_id TEXT
)
RETURNS VOID AS $$
DECLARE
  actual_principal_id TEXT;
BEGIN
  SELECT "principalId"
  INTO actual_principal_id
  FROM "agent_identities"
  WHERE "id" = p_agent_identity_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'REPUTATION_TRUST_AGENT_NOT_FOUND';
  END IF;

  IF actual_principal_id <> p_principal_id THEN
    RAISE EXCEPTION 'REPUTATION_TRUST_AGENT_PRINCIPAL_MISMATCH';
  END IF;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION "iwantu_build_local_trust_projection"(
  p_subject_principal_id TEXT,
  p_subject_agent_identity_id TEXT,
  p_counterparty_principal_id TEXT,
  p_counterparty_agent_identity_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  projection JSONB;
BEGIN
  PERFORM "iwantu_assert_agent_principal_binding"(
    p_subject_principal_id,
    p_subject_agent_identity_id
  );
  PERFORM "iwantu_assert_agent_principal_binding"(
    p_counterparty_principal_id,
    p_counterparty_agent_identity_id
  );

  WITH relation_evidence AS (
    SELECT *
    FROM "reputation_evidence"
    WHERE "subjectPrincipalId" = p_subject_principal_id
      AND "subjectAgentIdentityId" = p_subject_agent_identity_id
      AND "counterpartyPrincipalId" = p_counterparty_principal_id
      AND "counterpartyAgentIdentityId" = p_counterparty_agent_identity_id
  ),
  transaction_stats AS (
    SELECT
      count(*)::INTEGER AS settlement_count,
      count(*) FILTER (
        WHERE "evidence" ->> 'terminalOutcome' = 'success'
      )::INTEGER AS success_count,
      count(*) FILTER (
        WHERE "evidence" ->> 'terminalOutcome' = 'auto_accepted'
      )::INTEGER AS auto_accepted_count,
      count(*) FILTER (
        WHERE "evidence" ->> 'terminalOutcome' = 'supplier_default'
      )::INTEGER AS supplier_default_count,
      count(*) FILTER (
        WHERE "evidence" ->> 'terminalOutcome' = 'mutual_split'
      )::INTEGER AS mutual_split_count,
      count(*) FILTER (
        WHERE COALESCE(("evidence" ->> 'disputed')::boolean, false)
      )::INTEGER AS disputed_settlement_count,
      min("occurredAt") AS first_settlement_at,
      max("occurredAt") AS last_settlement_at
    FROM relation_evidence
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
      ) AS subject_received_credit,
      COALESCE(
        sum(NULLIF("evidence" ->> 'counterpartyReceivedAmount', '')::numeric),
        0
      ) AS counterparty_received_credit
    FROM relation_evidence
    WHERE "evidenceClass" = 'economic'
  )
  SELECT jsonb_build_object(
    'protocolVersion', 'iwantu.local-trust.v0.1',
    'direction', jsonb_build_object(
      'fromCounterpartyAgentIdentityId', p_counterparty_agent_identity_id,
      'toSubjectAgentIdentityId', p_subject_agent_identity_id
    ),
    'subjectPrincipalId', p_subject_principal_id,
    'subjectAgentIdentityId', p_subject_agent_identity_id,
    'counterpartyPrincipalId', p_counterparty_principal_id,
    'counterpartyAgentIdentityId', p_counterparty_agent_identity_id,
    'samePrincipal', p_subject_principal_id = p_counterparty_principal_id,
    'globalEligible', p_subject_principal_id <> p_counterparty_principal_id,
    'evidenceState', CASE
      WHEN transaction_stats.settlement_count = 0 THEN 'insufficient_evidence'
      ELSE 'observed'
    END,
    'settlementCount', transaction_stats.settlement_count,
    'successCount', transaction_stats.success_count,
    'autoAcceptedCount', transaction_stats.auto_accepted_count,
    'supplierDefaultCount', transaction_stats.supplier_default_count,
    'mutualSplitCount', transaction_stats.mutual_split_count,
    'disputedSettlementCount', transaction_stats.disputed_settlement_count,
    'firstSettlementAt', transaction_stats.first_settlement_at,
    'lastSettlementAt', transaction_stats.last_settlement_at,
    'terminalOutcomes', COALESCE(
      (
        SELECT jsonb_object_agg(outcome_name, outcome_count ORDER BY outcome_name)
        FROM (
          SELECT
            "evidence" ->> 'terminalOutcome' AS outcome_name,
            count(*)::INTEGER AS outcome_count
          FROM relation_evidence
          WHERE "evidenceClass" = 'transaction'
          GROUP BY "evidence" ->> 'terminalOutcome'
        ) local_outcomes
        WHERE outcome_name IS NOT NULL
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
  FROM transaction_stats
  CROSS JOIN economic_totals;

  RETURN projection;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION "iwantu_build_global_trust_projection"(
  p_subject_principal_id TEXT,
  p_subject_agent_identity_id TEXT
)
RETURNS JSONB AS $$
DECLARE
  projection JSONB;
BEGIN
  PERFORM "iwantu_assert_agent_principal_binding"(
    p_subject_principal_id,
    p_subject_agent_identity_id
  );

  WITH transaction_evidence AS (
    SELECT *
    FROM "reputation_evidence"
    WHERE "subjectPrincipalId" = p_subject_principal_id
      AND "subjectAgentIdentityId" = p_subject_agent_identity_id
      AND "evidenceClass" = 'transaction'
  ),
  independent_transactions AS (
    SELECT *
    FROM transaction_evidence
    WHERE "counterpartyPrincipalId" <> p_subject_principal_id
  ),
  counterparty_counts AS (
    SELECT
      "counterpartyPrincipalId",
      count(*)::INTEGER AS settlement_count
    FROM independent_transactions
    GROUP BY "counterpartyPrincipalId"
  ),
  global_stats AS (
    SELECT
      (SELECT count(*)::INTEGER FROM transaction_evidence
        WHERE "counterpartyPrincipalId" = p_subject_principal_id)
        AS same_principal_settlement_count,
      (SELECT count(*)::INTEGER FROM independent_transactions)
        AS independent_settlement_count,
      (SELECT count(*)::INTEGER FROM counterparty_counts)
        AS independent_counterparty_principal_count,
      COALESCE((SELECT max(settlement_count) FROM counterparty_counts), 0)::INTEGER
        AS top_counterparty_settlement_count
  ),
  independent_economic AS (
    SELECT
      COALESCE(
        sum(NULLIF("evidence" ->> 'grossAmount', '')::numeric),
        0
      ) AS gross_settled_credit,
      COALESCE(
        sum(NULLIF("evidence" ->> 'subjectReceivedAmount', '')::numeric),
        0
      ) AS subject_received_credit
    FROM "reputation_evidence"
    WHERE "subjectPrincipalId" = p_subject_principal_id
      AND "subjectAgentIdentityId" = p_subject_agent_identity_id
      AND "evidenceClass" = 'economic'
      AND "counterpartyPrincipalId" <> p_subject_principal_id
  )
  SELECT jsonb_build_object(
    'protocolVersion', 'iwantu.global-trust.v0.1',
    'subjectPrincipalId', p_subject_principal_id,
    'subjectAgentIdentityId', p_subject_agent_identity_id,
    'evidenceState', CASE
      WHEN global_stats.independent_settlement_count = 0
        THEN 'insufficient_evidence'
      ELSE 'observed'
    END,
    'samePrincipalSettlementCount',
      global_stats.same_principal_settlement_count,
    'independentSettlementCount',
      global_stats.independent_settlement_count,
    'independentCounterpartyPrincipalCount',
      global_stats.independent_counterparty_principal_count,
    'repeatIndependentSettlementCount',
      GREATEST(
        global_stats.independent_settlement_count -
          global_stats.independent_counterparty_principal_count,
        0
      ),
    'topCounterpartySettlementShare',
      CASE
        WHEN global_stats.independent_settlement_count = 0 THEN '0'
        ELSE round(
          global_stats.top_counterparty_settlement_count::numeric /
          global_stats.independent_settlement_count::numeric,
          8
        )::text
      END,
    'independentTerminalOutcomes', COALESCE(
      (
        SELECT jsonb_object_agg(outcome_name, outcome_count ORDER BY outcome_name)
        FROM (
          SELECT
            "evidence" ->> 'terminalOutcome' AS outcome_name,
            count(*)::INTEGER AS outcome_count
          FROM independent_transactions
          GROUP BY "evidence" ->> 'terminalOutcome'
        ) global_outcomes
        WHERE outcome_name IS NOT NULL
      ),
      '{}'::jsonb
    ),
    'economic', jsonb_build_object(
      'currency', 'IWC',
      'independentGrossSettledCredit',
        independent_economic.gross_settled_credit::text,
      'independentSubjectReceivedCredit',
        independent_economic.subject_received_credit::text
    )
  )
  INTO projection
  FROM global_stats
  CROSS JOIN independent_economic;

  RETURN projection;
END;
$$ LANGUAGE plpgsql STABLE;

CREATE OR REPLACE FUNCTION "iwantu_validate_local_trust_snapshot"()
RETURNS trigger AS $$
DECLARE
  expected_id TEXT;
  expected_projection JSONB;
BEGIN
  expected_id :=
    'localtrust:' ||
    NEW."counterpartyAgentIdentityId" || ':' ||
    NEW."subjectAgentIdentityId" || ':' ||
    NEW."projectionVersion";

  IF NEW."projectionVersion" <> 'iwantu.local-trust.v0.1'
     OR NEW."id" <> expected_id THEN
    RAISE EXCEPTION 'REPUTATION_LOCAL_TRUST_IDENTITY_INVALID';
  END IF;

  expected_projection := "iwantu_build_local_trust_projection"(
    NEW."subjectPrincipalId",
    NEW."subjectAgentIdentityId",
    NEW."counterpartyPrincipalId",
    NEW."counterpartyAgentIdentityId"
  );

  IF NEW."projection" IS DISTINCT FROM expected_projection THEN
    RAISE EXCEPTION 'REPUTATION_LOCAL_TRUST_PROJECTION_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reputation_local_trust_canonical_projection_guard"
BEFORE INSERT OR UPDATE ON "reputation_local_trust_snapshots"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_local_trust_snapshot"();

CREATE OR REPLACE FUNCTION "iwantu_validate_global_trust_snapshot"()
RETURNS trigger AS $$
DECLARE
  expected_id TEXT;
  expected_projection JSONB;
BEGIN
  expected_id :=
    'globaltrust:' ||
    NEW."subjectPrincipalId" || ':' ||
    NEW."subjectAgentIdentityId" || ':' ||
    NEW."projectionVersion";

  IF NEW."projectionVersion" <> 'iwantu.global-trust.v0.1'
     OR NEW."id" <> expected_id THEN
    RAISE EXCEPTION 'REPUTATION_GLOBAL_TRUST_IDENTITY_INVALID';
  END IF;

  expected_projection := "iwantu_build_global_trust_projection"(
    NEW."subjectPrincipalId",
    NEW."subjectAgentIdentityId"
  );

  IF NEW."projection" IS DISTINCT FROM expected_projection THEN
    RAISE EXCEPTION 'REPUTATION_GLOBAL_TRUST_PROJECTION_MISMATCH';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "reputation_global_trust_canonical_projection_guard"
BEFORE INSERT OR UPDATE ON "reputation_global_trust_snapshots"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_global_trust_snapshot"();

CREATE OR REPLACE FUNCTION "iwantu_rebuild_local_trust_snapshot"(
  p_subject_principal_id TEXT,
  p_subject_agent_identity_id TEXT,
  p_counterparty_principal_id TEXT,
  p_counterparty_agent_identity_id TEXT
)
RETURNS SETOF "reputation_local_trust_snapshots" AS $$
DECLARE
  projection_version CONSTANT TEXT := 'iwantu.local-trust.v0.1';
  snapshot_id TEXT;
  canonical_projection JSONB;
BEGIN
  snapshot_id :=
    'localtrust:' ||
    p_counterparty_agent_identity_id || ':' ||
    p_subject_agent_identity_id || ':' ||
    projection_version;

  canonical_projection := "iwantu_build_local_trust_projection"(
    p_subject_principal_id,
    p_subject_agent_identity_id,
    p_counterparty_principal_id,
    p_counterparty_agent_identity_id
  );

  INSERT INTO "reputation_local_trust_snapshots" (
    "id",
    "projectionVersion",
    "subjectPrincipalId",
    "subjectAgentIdentityId",
    "counterpartyPrincipalId",
    "counterpartyAgentIdentityId",
    "projection",
    "rebuiltAt"
  ) VALUES (
    snapshot_id,
    projection_version,
    p_subject_principal_id,
    p_subject_agent_identity_id,
    p_counterparty_principal_id,
    p_counterparty_agent_identity_id,
    canonical_projection,
    CURRENT_TIMESTAMP
  )
  ON CONFLICT (
    "subjectAgentIdentityId",
    "counterpartyAgentIdentityId",
    "projectionVersion"
  )
  DO UPDATE SET
    "id" = EXCLUDED."id",
    "subjectPrincipalId" = EXCLUDED."subjectPrincipalId",
    "counterpartyPrincipalId" = EXCLUDED."counterpartyPrincipalId",
    "projection" = EXCLUDED."projection",
    "rebuiltAt" = CURRENT_TIMESTAMP;

  RETURN QUERY
  SELECT *
  FROM "reputation_local_trust_snapshots"
  WHERE "subjectAgentIdentityId" = p_subject_agent_identity_id
    AND "counterpartyAgentIdentityId" = p_counterparty_agent_identity_id
    AND "projectionVersion" = projection_version;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION "iwantu_rebuild_global_trust_snapshot"(
  p_subject_principal_id TEXT,
  p_subject_agent_identity_id TEXT
)
RETURNS SETOF "reputation_global_trust_snapshots" AS $$
DECLARE
  projection_version CONSTANT TEXT := 'iwantu.global-trust.v0.1';
  snapshot_id TEXT;
  canonical_projection JSONB;
BEGIN
  snapshot_id :=
    'globaltrust:' ||
    p_subject_principal_id || ':' ||
    p_subject_agent_identity_id || ':' ||
    projection_version;

  canonical_projection := "iwantu_build_global_trust_projection"(
    p_subject_principal_id,
    p_subject_agent_identity_id
  );

  INSERT INTO "reputation_global_trust_snapshots" (
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
  FROM "reputation_global_trust_snapshots"
  WHERE "subjectPrincipalId" = p_subject_principal_id
    AND "subjectAgentIdentityId" = p_subject_agent_identity_id
    AND "projectionVersion" = projection_version;
END;
$$ LANGUAGE plpgsql;

-- Populate projections for already-existing M9 evidence.
DO $$
DECLARE
  relation_row RECORD;
  subject_row RECORD;
BEGIN
  FOR relation_row IN
    SELECT DISTINCT
      "subjectPrincipalId",
      "subjectAgentIdentityId",
      "counterpartyPrincipalId",
      "counterpartyAgentIdentityId"
    FROM "reputation_evidence"
  LOOP
    PERFORM "iwantu_rebuild_local_trust_snapshot"(
      relation_row."subjectPrincipalId",
      relation_row."subjectAgentIdentityId",
      relation_row."counterpartyPrincipalId",
      relation_row."counterpartyAgentIdentityId"
    );
  END LOOP;

  FOR subject_row IN
    SELECT DISTINCT
      "subjectPrincipalId",
      "subjectAgentIdentityId"
    FROM "reputation_evidence"
  LOOP
    PERFORM "iwantu_rebuild_global_trust_snapshot"(
      subject_row."subjectPrincipalId",
      subject_row."subjectAgentIdentityId"
    );
  END LOOP;
END;
$$;

-- Snapshots remain disposable read models: no DELETE guard is installed.
-- ReputationEvidence remains immutable and untouched by these projectors.
