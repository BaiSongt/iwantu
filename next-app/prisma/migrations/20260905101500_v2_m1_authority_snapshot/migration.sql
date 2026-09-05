-- V2-M1-07: immutable AuthoritySnapshot evidence.
-- A snapshot records why authority resolved at a point in time. It is never an
-- authority source for new commitments; current commands must re-run the live
-- credential/identity/mandate/authority pipeline.

CREATE TABLE "authority_snapshots" (
    "id" TEXT NOT NULL,
    "protocolVersion" TEXT NOT NULL DEFAULT 'iwantu-authority-snapshot/0.1',
    "principalId" TEXT NOT NULL,
    "agentIdentityId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "credentialKeyId" TEXT NOT NULL,
    "leafMandateId" TEXT NOT NULL,
    "mandateChain" JSONB NOT NULL,
    "authorityChainHash" TEXT NOT NULL,
    "effectiveAuthority" JSONB NOT NULL,
    "requestEvidence" JSONB NOT NULL,
    "resolvedAction" TEXT NOT NULL,
    "resolvedCapabilityId" TEXT,
    "resolvedAt" TIMESTAMP(3) NOT NULL,
    "evidenceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authority_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "authority_snapshots_evidenceHash_key"
ON "authority_snapshots"("evidenceHash");
CREATE INDEX "authority_snapshots_principalId_resolvedAt_idx"
ON "authority_snapshots"("principalId", "resolvedAt");
CREATE INDEX "authority_snapshots_agentIdentityId_resolvedAt_idx"
ON "authority_snapshots"("agentIdentityId", "resolvedAt");
CREATE INDEX "authority_snapshots_credentialId_idx"
ON "authority_snapshots"("credentialId");
CREATE INDEX "authority_snapshots_leafMandateId_idx"
ON "authority_snapshots"("leafMandateId");

ALTER TABLE "authority_snapshots"
ADD CONSTRAINT "authority_snapshots_principalId_fkey"
FOREIGN KEY ("principalId") REFERENCES "principals"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "authority_snapshots"
ADD CONSTRAINT "authority_snapshots_agentIdentityId_fkey"
FOREIGN KEY ("agentIdentityId") REFERENCES "agent_identities"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "authority_snapshots"
ADD CONSTRAINT "authority_snapshots_credentialId_fkey"
FOREIGN KEY ("credentialId") REFERENCES "agent_credentials"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "authority_snapshots"
ADD CONSTRAINT "authority_snapshots_leafMandateId_fkey"
FOREIGN KEY ("leafMandateId") REFERENCES "mandates"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "authority_snapshots"
ADD CONSTRAINT "authority_snapshots_chain_shape_check" CHECK (
  jsonb_typeof("mandateChain") = 'array'
  AND jsonb_array_length("mandateChain") BETWEEN 1 AND 2
);

ALTER TABLE "authority_snapshots"
ADD CONSTRAINT "authority_snapshots_effective_authority_check" CHECK (
  jsonb_typeof("effectiveAuthority") = 'object'
);

ALTER TABLE "authority_snapshots"
ADD CONSTRAINT "authority_snapshots_request_evidence_check" CHECK (
  jsonb_typeof("requestEvidence") = 'object'
);

ALTER TABLE "authority_snapshots"
ADD CONSTRAINT "authority_snapshots_hashes_check" CHECK (
  "authorityChainHash" ~ '^[0-9a-f]{64}$'
  AND "evidenceHash" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "authority_snapshots"
ADD CONSTRAINT "authority_snapshots_nonempty_identity_check" CHECK (
  length("credentialKeyId") > 0
  AND length("resolvedAction") > 0
);

CREATE OR REPLACE FUNCTION validate_authority_snapshot_identity_chain()
RETURNS trigger AS $$
DECLARE
  credential_agent_id TEXT;
  credential_key_id TEXT;
  agent_principal_id TEXT;
  mandate_principal_id TEXT;
  mandate_agent_id TEXT;
  chain_leaf_id TEXT;
BEGIN
  SELECT "agentIdentityId", "keyId"
    INTO credential_agent_id, credential_key_id
  FROM "agent_credentials"
  WHERE "id" = NEW."credentialId";

  IF credential_agent_id IS DISTINCT FROM NEW."agentIdentityId"
     OR credential_key_id IS DISTINCT FROM NEW."credentialKeyId" THEN
    RAISE EXCEPTION 'AuthoritySnapshot credential evidence does not match AgentIdentity/key id'
      USING ERRCODE = '23514';
  END IF;

  SELECT "principalId" INTO agent_principal_id
  FROM "agent_identities"
  WHERE "id" = NEW."agentIdentityId";

  IF agent_principal_id IS DISTINCT FROM NEW."principalId" THEN
    RAISE EXCEPTION 'AuthoritySnapshot AgentIdentity does not belong to Principal'
      USING ERRCODE = '23514';
  END IF;

  SELECT "issuerPrincipalId", "subjectAgentIdentityId"
    INTO mandate_principal_id, mandate_agent_id
  FROM "mandates"
  WHERE "id" = NEW."leafMandateId";

  IF mandate_principal_id IS DISTINCT FROM NEW."principalId"
     OR mandate_agent_id IS DISTINCT FROM NEW."agentIdentityId" THEN
    RAISE EXCEPTION 'AuthoritySnapshot leaf Mandate does not match Principal/AgentIdentity'
      USING ERRCODE = '23514';
  END IF;

  chain_leaf_id := NEW."mandateChain" -> (jsonb_array_length(NEW."mandateChain") - 1) ->> 'id';
  IF chain_leaf_id IS DISTINCT FROM NEW."leafMandateId" THEN
    RAISE EXCEPTION 'AuthoritySnapshot Mandate chain leaf does not match leafMandateId'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "authority_snapshots_validate_identity_chain"
BEFORE INSERT ON "authority_snapshots"
FOR EACH ROW EXECUTE FUNCTION validate_authority_snapshot_identity_chain();

CREATE OR REPLACE FUNCTION prevent_authority_snapshot_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuthoritySnapshot is immutable historical evidence and cannot be changed or deleted'
    USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "authority_snapshots_immutable_update"
BEFORE UPDATE ON "authority_snapshots"
FOR EACH ROW EXECUTE FUNCTION prevent_authority_snapshot_change();

CREATE TRIGGER "authority_snapshots_immutable_delete"
BEFORE DELETE ON "authority_snapshots"
FOR EACH ROW EXECUTE FUNCTION prevent_authority_snapshot_change();
