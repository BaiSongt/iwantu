-- V2-M11-01: immutable IntegritySignal foundation.
--
-- Integrity is deliberately separate from Reputation:
-- - ReputationEvidence records what happened.
-- - IntegritySignal records deterministic risk observations about evidence/flows.
--
-- This slice introduces NO automatic economic punishment and NO opaque score.
-- Action-ladder decisions remain a later M11 projection/boundary.

CREATE TABLE "integrity_signals" (
  "id" TEXT NOT NULL,
  "protocolVersion" TEXT NOT NULL,
  "subjectPrincipalId" TEXT NOT NULL,
  "subjectAgentIdentityId" TEXT,
  "scope" TEXT NOT NULL,
  "ruleCode" TEXT NOT NULL,
  "ruleVersion" TEXT NOT NULL,
  "signalClass" TEXT NOT NULL,
  "evidence" JSONB NOT NULL,
  "metrics" JSONB NOT NULL,
  "evidenceFingerprint" TEXT NOT NULL,
  "basisStart" TIMESTAMP(3) NOT NULL,
  "basisEnd" TIMESTAMP(3) NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "integrity_signals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integrity_signals_protocol_version"
    CHECK ("protocolVersion" = 'iwantu.integrity-signal.v0.1'),
  CONSTRAINT "integrity_signals_scope_valid"
    CHECK ("scope" IN ('principal', 'agent')),
  CONSTRAINT "integrity_signals_rule_code_nonempty"
    CHECK (length(trim("ruleCode")) > 0),
  CONSTRAINT "integrity_signals_rule_version_nonempty"
    CHECK (length(trim("ruleVersion")) > 0),
  CONSTRAINT "integrity_signals_class_nonempty"
    CHECK (length(trim("signalClass")) > 0),
  CONSTRAINT "integrity_signals_evidence_object"
    CHECK (jsonb_typeof("evidence") = 'object'),
  CONSTRAINT "integrity_signals_metrics_object"
    CHECK (jsonb_typeof("metrics") = 'object'),
  CONSTRAINT "integrity_signals_basis_window"
    CHECK ("basisStart" <= "basisEnd"),
  CONSTRAINT "integrity_signals_observed_after_basis"
    CHECK ("observedAt" >= "basisEnd")
);

CREATE INDEX "integrity_signals_subject_principal_observed_idx"
  ON "integrity_signals"("subjectPrincipalId", "observedAt");

CREATE INDEX "integrity_signals_subject_agent_observed_idx"
  ON "integrity_signals"("subjectAgentIdentityId", "observedAt");

CREATE INDEX "integrity_signals_rule_observed_idx"
  ON "integrity_signals"("ruleCode", "ruleVersion", "observedAt");

CREATE UNIQUE INDEX "integrity_signals_subject_rule_evidence_key"
  ON "integrity_signals"(
    "subjectPrincipalId",
    COALESCE("subjectAgentIdentityId", ''),
    "ruleCode",
    "ruleVersion",
    "evidenceFingerprint",
    "basisStart",
    "basisEnd"
  );

ALTER TABLE "integrity_signals"
  ADD CONSTRAINT "integrity_signals_subject_principal_fkey"
  FOREIGN KEY ("subjectPrincipalId") REFERENCES "principals"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integrity_signals"
  ADD CONSTRAINT "integrity_signals_subject_agent_fkey"
  FOREIGN KEY ("subjectAgentIdentityId") REFERENCES "agent_identities"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION "iwantu_integrity_signal_evidence_fingerprint"(
  p_evidence JSONB,
  p_metrics JSONB
)
RETURNS TEXT AS $$
  SELECT md5(
    jsonb_build_object(
      'evidence', p_evidence,
      'metrics', p_metrics
    )::text
  );
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION "iwantu_integrity_signal_id"(
  p_subject_principal_id TEXT,
  p_subject_agent_identity_id TEXT,
  p_scope TEXT,
  p_rule_code TEXT,
  p_rule_version TEXT,
  p_signal_class TEXT,
  p_evidence_fingerprint TEXT,
  p_basis_start TIMESTAMP(3),
  p_basis_end TIMESTAMP(3)
)
RETURNS TEXT AS $$
  SELECT
    'intsig:' ||
    md5(
      concat_ws(
        '|',
        'iwantu.integrity-signal.v0.1',
        p_subject_principal_id,
        COALESCE(p_subject_agent_identity_id, '-'),
        p_scope,
        p_rule_code,
        p_rule_version,
        p_signal_class,
        p_evidence_fingerprint,
        p_basis_start::text,
        p_basis_end::text
      )
    );
$$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION "iwantu_validate_integrity_signal"()
RETURNS trigger AS $$
DECLARE
  agent_principal_id TEXT;
  expected_fingerprint TEXT;
  expected_id TEXT;
BEGIN
  IF NEW."protocolVersion" <> 'iwantu.integrity-signal.v0.1' THEN
    RAISE EXCEPTION 'INTEGRITY_SIGNAL_PROTOCOL_VERSION_INVALID';
  END IF;

  IF NEW."scope" = 'agent' AND NEW."subjectAgentIdentityId" IS NULL THEN
    RAISE EXCEPTION 'INTEGRITY_SIGNAL_AGENT_SCOPE_REQUIRES_AGENT';
  END IF;

  IF NEW."scope" = 'principal' AND NEW."subjectAgentIdentityId" IS NOT NULL THEN
    RAISE EXCEPTION 'INTEGRITY_SIGNAL_PRINCIPAL_SCOPE_FORBIDS_AGENT';
  END IF;

  IF NEW."subjectAgentIdentityId" IS NOT NULL THEN
    SELECT "principalId"
    INTO agent_principal_id
    FROM "agent_identities"
    WHERE "id" = NEW."subjectAgentIdentityId";

    IF NOT FOUND THEN
      RAISE EXCEPTION 'INTEGRITY_SIGNAL_AGENT_NOT_FOUND';
    END IF;

    IF agent_principal_id <> NEW."subjectPrincipalId" THEN
      RAISE EXCEPTION 'INTEGRITY_SIGNAL_AGENT_PRINCIPAL_MISMATCH';
    END IF;
  END IF;

  expected_fingerprint := "iwantu_integrity_signal_evidence_fingerprint"(
    NEW."evidence",
    NEW."metrics"
  );

  IF NEW."evidenceFingerprint" <> expected_fingerprint THEN
    RAISE EXCEPTION 'INTEGRITY_SIGNAL_EVIDENCE_FINGERPRINT_MISMATCH';
  END IF;

  expected_id := "iwantu_integrity_signal_id"(
    NEW."subjectPrincipalId",
    NEW."subjectAgentIdentityId",
    NEW."scope",
    NEW."ruleCode",
    NEW."ruleVersion",
    NEW."signalClass",
    NEW."evidenceFingerprint",
    NEW."basisStart",
    NEW."basisEnd"
  );

  IF NEW."id" <> expected_id THEN
    RAISE EXCEPTION 'INTEGRITY_SIGNAL_ID_INVALID';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "integrity_signals_insert_guard"
BEFORE INSERT ON "integrity_signals"
FOR EACH ROW EXECUTE FUNCTION "iwantu_validate_integrity_signal"();

CREATE OR REPLACE FUNCTION "iwantu_prevent_integrity_signal_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'INTEGRITY_SIGNAL_IS_IMMUTABLE';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "integrity_signals_update_guard"
BEFORE UPDATE ON "integrity_signals"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_integrity_signal_mutation"();

CREATE TRIGGER "integrity_signals_delete_guard"
BEFORE DELETE ON "integrity_signals"
FOR EACH ROW EXECUTE FUNCTION "iwantu_prevent_integrity_signal_mutation"();

CREATE OR REPLACE FUNCTION "iwantu_emit_integrity_signal"(
  p_subject_principal_id TEXT,
  p_subject_agent_identity_id TEXT,
  p_scope TEXT,
  p_rule_code TEXT,
  p_rule_version TEXT,
  p_signal_class TEXT,
  p_evidence JSONB,
  p_metrics JSONB,
  p_basis_start TIMESTAMP(3),
  p_basis_end TIMESTAMP(3),
  p_observed_at TIMESTAMP(3)
)
RETURNS SETOF "integrity_signals" AS $$
DECLARE
  protocol_version CONSTANT TEXT := 'iwantu.integrity-signal.v0.1';
  evidence_fingerprint TEXT;
  signal_id TEXT;
BEGIN
  IF p_rule_code IS NULL OR length(trim(p_rule_code)) = 0 THEN
    RAISE EXCEPTION 'INTEGRITY_SIGNAL_RULE_CODE_INVALID';
  END IF;

  IF p_rule_version IS NULL OR length(trim(p_rule_version)) = 0 THEN
    RAISE EXCEPTION 'INTEGRITY_SIGNAL_RULE_VERSION_INVALID';
  END IF;

  IF p_signal_class IS NULL OR length(trim(p_signal_class)) = 0 THEN
    RAISE EXCEPTION 'INTEGRITY_SIGNAL_CLASS_INVALID';
  END IF;

  IF p_evidence IS NULL OR jsonb_typeof(p_evidence) <> 'object' THEN
    RAISE EXCEPTION 'INTEGRITY_SIGNAL_EVIDENCE_INVALID';
  END IF;

  IF p_metrics IS NULL OR jsonb_typeof(p_metrics) <> 'object' THEN
    RAISE EXCEPTION 'INTEGRITY_SIGNAL_METRICS_INVALID';
  END IF;

  IF p_basis_start > p_basis_end OR p_observed_at < p_basis_end THEN
    RAISE EXCEPTION 'INTEGRITY_SIGNAL_TIME_WINDOW_INVALID';
  END IF;

  evidence_fingerprint := "iwantu_integrity_signal_evidence_fingerprint"(
    p_evidence,
    p_metrics
  );

  signal_id := "iwantu_integrity_signal_id"(
    p_subject_principal_id,
    p_subject_agent_identity_id,
    p_scope,
    p_rule_code,
    p_rule_version,
    p_signal_class,
    evidence_fingerprint,
    p_basis_start,
    p_basis_end
  );

  INSERT INTO "integrity_signals" (
    "id",
    "protocolVersion",
    "subjectPrincipalId",
    "subjectAgentIdentityId",
    "scope",
    "ruleCode",
    "ruleVersion",
    "signalClass",
    "evidence",
    "metrics",
    "evidenceFingerprint",
    "basisStart",
    "basisEnd",
    "observedAt"
  ) VALUES (
    signal_id,
    protocol_version,
    p_subject_principal_id,
    p_subject_agent_identity_id,
    p_scope,
    p_rule_code,
    p_rule_version,
    p_signal_class,
    p_evidence,
    p_metrics,
    evidence_fingerprint,
    p_basis_start,
    p_basis_end,
    p_observed_at
  )
  ON CONFLICT ("id") DO NOTHING;

  RETURN QUERY
  SELECT *
  FROM "integrity_signals"
  WHERE "id" = signal_id;
END;
$$ LANGUAGE plpgsql;
