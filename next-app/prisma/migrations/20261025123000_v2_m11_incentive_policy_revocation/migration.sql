-- R8 individually signed, immediate policy revocation. Historical policies,
-- awards, hashes and receipts remain immutable; a revocation only prevents new
-- bindings. This migration never rewrites or reinterprets prior records.

CREATE TABLE "r8_incentive_policy_revocations" (
  "id" TEXT PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{64}$'),
  "programId" TEXT NOT NULL REFERENCES "r8_incentive_programs"("programId") ON DELETE RESTRICT,
  "policyHash" TEXT NOT NULL UNIQUE REFERENCES "r8_incentive_policies"("policyHash") ON DELETE RESTRICT,
  "authorizationId" TEXT NOT NULL UNIQUE REFERENCES "r8_incentive_authorizations"("commandHash") ON DELETE RESTRICT,
  "reasonCode" TEXT NOT NULL CHECK ("reasonCode" IN ('security', 'policy_error', 'superseded', 'operational')),
  "evidence" JSONB NOT NULL CHECK (jsonb_typeof("evidence") = 'object'),
  "revocationHash" TEXT NOT NULL UNIQUE CHECK ("revocationHash" ~ '^[0-9a-f]{64}$'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);

CREATE INDEX "r8_policy_revocations_program_created_idx"
  ON "r8_incentive_policy_revocations"("programId", "createdAt");

-- Internal transaction origin is never signed or exposed in protocol evidence.
-- Leave historical bindings NULL; the BEFORE INSERT guard stamps every new
-- binding with the top-level full transaction ID, including across savepoints.
ALTER TABLE "r8_incentive_award_bindings"
  ADD COLUMN "policyGuardTransactionId" TEXT;

CREATE TRIGGER r8_no_change BEFORE UPDATE OR DELETE ON "r8_incentive_policy_revocations"
  FOR EACH ROW EXECUTE FUNCTION iwantu_r8_prevent_change();

ALTER TABLE "r8_incentive_authorizations"
  DROP CONSTRAINT "r8_incentive_authorizations_action_check";
ALTER TABLE "r8_incentive_authorizations"
  ADD CONSTRAINT "r8_incentive_authorizations_action_check" CHECK (
    "action" IN ('incentive.program.register', 'incentive.policy.publish',
      'incentive.award.issue', 'incentive.policy.revoke')
  );

-- Preserve the established three monetary actions unchanged. Revocation is a
-- distinct nonmonetary authorization: it needs the same identity, signature
-- digest, live exact Mandate and pinned governance root, but not a reward cap.
-- Actual Ed25519 verification remains the trusted command service's duty.
CREATE OR REPLACE FUNCTION iwantu_r8_validate_authorization() RETURNS trigger AS $$
DECLARE
  p "r8_incentive_programs"%ROWTYPE;
  snap "authority_snapshots"%ROWTYPE;
  access_key "agent_credentials"%ROWTYPE;
  signing "agent_credentials"%ROWTYPE;
  leaf "mandates"%ROWTYPE;
  now_utc TIMESTAMP := clock_timestamp() AT TIME ZONE 'UTC';
  issued TIMESTAMP;
  expires TIMESTAMP;
  requested_amount TEXT;
BEGIN
  PERFORM iwantu_r8_require_ledger_lock();
  SELECT * INTO p FROM "r8_incentive_programs" WHERE "programId" = NEW."programId";
  SELECT * INTO snap FROM "authority_snapshots" WHERE "id" = NEW."authoritySnapshotId";
  SELECT * INTO access_key FROM "agent_credentials" WHERE "id" = NEW."accessCredentialId";
  SELECT * INTO signing FROM "agent_credentials" WHERE "id" = NEW."signingCredentialId";
  SELECT * INTO leaf FROM "mandates" WHERE "id" = NEW."commandEvidence" ->> 'mandateId';
  issued := (NEW."commandEvidence" ->> 'issuedAt')::timestamptz AT TIME ZONE 'UTC';
  expires := (NEW."commandEvidence" ->> 'expiresAt')::timestamptz AT TIME ZONE 'UTC';
  IF NEW."action" = 'incentive.program.register' THEN
    requested_amount := p."budgetIwc"::text;
  ELSIF NEW."action" = 'incentive.policy.publish' THEN
    SELECT "policy" -> 'rewardFormula' ->> 'amountIwc' INTO requested_amount
    FROM "r8_incentive_policies" WHERE "authorizationId" = NEW."commandHash";
  ELSIF NEW."action" = 'incentive.policy.revoke' THEN
    requested_amount := NULL;
  ELSE
    requested_amount := NEW."payload" ->> 'amountIwc';
  END IF;

  IF (NEW."commandHash" = iwantu_r8_hash(NEW."commandEvidence")
      AND NEW."commandEvidence" ->> 'protocolVersion' = 'iwantu-economic-command/0.1'
      AND NEW."commandEvidence" ->> 'signatureAlgorithm' = 'EdDSA'
      AND NEW."commandEvidence" ->> 'action' = NEW."action"
      AND NEW."commandEvidence" ->> 'principalId' = NEW."principalId"
      AND NEW."commandEvidence" ->> 'agentIdentityId' = NEW."agentIdentityId"
      AND NEW."commandEvidence" ->> 'nonce' = NEW."nonce"
      AND NEW."commandEvidence" ->> 'payloadHash' = iwantu_r8_hash(NEW."payload")
      AND NEW."commandEvidence" - ARRAY['protocolVersion','action','principalId','agentIdentityId','mandateId','payloadHash','nonce','issuedAt','expiresAt','signingKeyId','signatureAlgorithm'] = '{}'::jsonb
      AND NEW."payload" ->> 'action' = NEW."action"
      AND expires > issued AND expires - issued <= interval '10 minutes'
      AND issued <= now_utc + interval '1 minute' AND expires > now_utc
      AND p."programId" IS NOT NULL
      AND iwantu_r8_root_live(NEW."programId")
      AND EXISTS (SELECT 1 FROM "principals" WHERE "id" = NEW."principalId" AND "status" = 'active')
      AND EXISTS (SELECT 1 FROM "agent_identities" WHERE "id" = NEW."agentIdentityId" AND "principalId" = NEW."principalId" AND "status" = 'active')
      AND access_key."kind" = 'api' AND access_key."status" = 'active'
      AND access_key."agentIdentityId" = NEW."agentIdentityId"
      AND access_key."validFrom" <= now_utc AND (access_key."expiresAt" IS NULL OR access_key."expiresAt" > now_utc)
      AND signing."kind" = 'signing' AND signing."status" = 'active' AND signing."algorithm" = 'EdDSA'
      AND signing."agentIdentityId" = NEW."agentIdentityId"
      AND signing."keyId" = NEW."commandEvidence" ->> 'signingKeyId'
      AND signing."validFrom" <= now_utc AND (signing."expiresAt" IS NULL OR signing."expiresAt" > now_utc)
      AND snap."principalId" = NEW."principalId" AND snap."agentIdentityId" = NEW."agentIdentityId"
      AND snap."credentialId" = NEW."accessCredentialId" AND snap."credentialKeyId" = access_key."keyId"
      AND snap."leafMandateId" = leaf."id" AND snap."resolvedAction" = NEW."action"
      AND snap."requestEvidence" ->> 'action' = NEW."action"
      AND snap."requestEvidence" ->> 'commandHash' = NEW."commandHash"
      AND snap."requestEvidence" ->> 'payloadHash' = NEW."commandEvidence" ->> 'payloadHash'
      AND snap."requestEvidence" ->> 'nonce' = NEW."nonce"
      AND snap."requestEvidence" ->> 'signingCredentialId' = NEW."signingCredentialId"
      AND snap."requestEvidence" ->> 'signingKeyId' = signing."keyId"
      AND snap."requestEvidence" ->> 'signatureAlgorithm' = 'EdDSA'
      AND (
        (NEW."action" = 'incentive.policy.revoke'
          AND snap."requestEvidence" -> 'economic' = 'null'::jsonb
          AND EXISTS (SELECT 1 FROM "r8_incentive_policy_revocations" r
            WHERE r."authorizationId" = NEW."commandHash" AND r."programId" = NEW."programId"
              AND r."policyHash" = NEW."payload" ->> 'policyHash'))
        OR
        (NEW."action" <> 'incentive.policy.revoke'
          AND requested_amount ~ '^(0|[1-9][0-9]{0,27})\.[0-9]{8}$'
          AND requested_amount::numeric > 0
          AND snap."requestEvidence" -> 'economic' = jsonb_build_object('singleContract', requested_amount, 'currency', 'IWC')
          AND jsonb_typeof(leaf."economicLimits" -> 'singleContract') = 'string'
          AND leaf."economicLimits" ->> 'singleContract' ~ '^(0|[1-9][0-9]{0,27})\.[0-9]{8}$'
          AND leaf."economicLimits" ->> 'currency' = 'IWC'
          AND requested_amount::numeric <= (leaf."economicLimits" ->> 'singleContract')::numeric)
      )
      AND leaf."issuerPrincipalId" = NEW."principalId" AND leaf."subjectAgentIdentityId" = NEW."agentIdentityId"
      AND NEW."action" = ANY(leaf."actionScopes")
      AND snap."effectiveAuthority" -> 'actionScopes' @> to_jsonb(ARRAY[NEW."action"])
      AND leaf."validFrom" <= now_utc AND (leaf."validUntil" IS NULL OR leaf."validUntil" > now_utc)
      AND jsonb_typeof(snap."mandateChain") = 'array' AND jsonb_array_length(snap."mandateChain") BETWEEN 1 AND 2
      AND snap."authorityChainHash" = iwantu_r8_hash(snap."mandateChain")
      AND snap."mandateChain" -> -1 ->> 'id' = leaf."id"
      AND NOT EXISTS (
        SELECT 1 FROM jsonb_array_elements(snap."mandateChain") WITH ORDINALITY e(v,n)
          LEFT JOIN "mandates" m ON m."id" = v ->> 'id'
        WHERE m."id" IS NULL OR m."issuerPrincipalId" <> NEW."principalId"
          OR m."version" <> (v ->> 'version')::integer OR m."payloadHash" <> v ->> 'payloadHash'
          OR m."validFrom" > now_utc OR (m."validUntil" IS NOT NULL AND m."validUntil" <= now_utc)
          OR (n = 1 AND m."parentMandateId" IS NOT NULL)
          OR (n > 1 AND m."parentMandateId" IS DISTINCT FROM snap."mandateChain" -> (n::integer - 2) ->> 'id')
      )
      AND NOT EXISTS (SELECT 1 FROM "mandate_revocations" r JOIN jsonb_array_elements(snap."mandateChain") c ON c ->> 'id' = r."mandateId" WHERE r."revokedAt" <= now_utc)
      AND NOT EXISTS (SELECT 1 FROM "mandates" m JOIN jsonb_array_elements(snap."mandateChain") c ON c ->> 'id' = m."supersedesMandateId" WHERE m."validFrom" <= now_utc)
    ) IS NOT TRUE THEN RAISE EXCEPTION 'R8_AUTHORIZATION_BINDING_INVALID'; END IF;

  IF NEW."action" = 'incentive.award.issue' THEN
    IF NEW."principalId" <> p."awardIssuerPrincipalId" THEN RAISE EXCEPTION 'R8_AWARD_ISSUER_DENIED'; END IF;
  ELSIF (NEW."principalId" = p."governancePrincipalId"
         AND signing."keyId" = p."governanceSigningKeyId"
         AND iwantu_r8_hash(signing."publicKeyJwk") = p."governanceKeyHash") IS NOT TRUE THEN
    RAISE EXCEPTION 'R8_GOVERNANCE_KEY_DENIED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION iwantu_r8_validate_policy_revocation() RETURNS trigger AS $$
DECLARE
  policy_row "r8_incentive_policies"%ROWTYPE;
  authorization_row "r8_incentive_authorizations"%ROWTYPE;
  expected_payload JSONB;
  expected_evidence JSONB;
BEGIN
  PERFORM iwantu_r8_require_ledger_lock();
  -- A deferred award check can already have run via SET CONSTRAINTS IMMEDIATE.
  -- This symmetric guard still rejects an award and revocation in the same
  -- transaction, even if the award was inserted in a released subtransaction.
  IF EXISTS (SELECT 1 FROM "r8_incentive_award_bindings" b
      WHERE b."policyHash" = NEW."policyHash"
        AND b."policyGuardTransactionId" = pg_current_xact_id()::text) THEN
    RAISE EXCEPTION 'R8_POLICY_REVOKED';
  END IF;
  SELECT * INTO policy_row FROM "r8_incentive_policies" WHERE "policyHash" = NEW."policyHash";
  SELECT * INTO authorization_row FROM "r8_incentive_authorizations" WHERE "commandHash" = NEW."authorizationId";
  expected_payload := jsonb_build_object(
    'protocol', 'iwantu.incentive-policy-revocation/0.1',
    'action', 'incentive.policy.revoke', 'programId', NEW."programId",
    'policyHash', NEW."policyHash", 'reasonCode', NEW."reasonCode"
  );
  expected_evidence := (expected_payload - 'action') || jsonb_build_object('authorizationId', NEW."authorizationId");
  IF (policy_row."programId" = NEW."programId"
      AND authorization_row."action" = 'incentive.policy.revoke'
      AND authorization_row."programId" = NEW."programId"
      AND authorization_row."payload" = expected_payload
      AND NEW."id" = authorization_row."commandHash"
      AND NEW."evidence" = expected_evidence
      AND NEW."revocationHash" = iwantu_r8_hash(expected_evidence)
      AND NEW."createdAt" >= authorization_row."createdAt"
      AND NEW."createdAt" <= (clock_timestamp() AT TIME ZONE 'UTC') + interval '1 millisecond'
      AND iwantu_r8_root_live(NEW."programId")) IS NOT TRUE THEN
    RAISE EXCEPTION 'R8_REVOCATION_INVALID';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER r8_policy_revocation_validate BEFORE INSERT ON "r8_incentive_policy_revocations"
  FOR EACH ROW EXECUTE FUNCTION iwantu_r8_validate_policy_revocation();

-- An already committed binding is deliberately not revalidated when a policy
-- is revoked. Only new INSERTs are guarded, preserving historical proofs and
-- exact replay. The deferred check also rejects an award and its policy's
-- revocation being staged in the same uncommitted transaction.
CREATE FUNCTION iwantu_r8_reject_revoked_policy_binding() RETURNS trigger AS $$
BEGIN
  PERFORM iwantu_r8_require_ledger_lock();
  IF EXISTS (SELECT 1 FROM "r8_incentive_policy_revocations" r WHERE r."policyHash" = NEW."policyHash") THEN
    RAISE EXCEPTION 'R8_POLICY_REVOKED';
  END IF;
  IF TG_WHEN = 'BEFORE' THEN
    -- Always overwrite caller input; append-only binding protection preserves
    -- the server-owned origin after insertion. TEXT avoids xid8 DTO coercion.
    NEW."policyGuardTransactionId" := pg_current_xact_id()::text;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER r8_binding_policy_active BEFORE INSERT ON "r8_incentive_award_bindings"
  FOR EACH ROW EXECUTE FUNCTION iwantu_r8_reject_revoked_policy_binding();

CREATE CONSTRAINT TRIGGER r8_binding_policy_active_at_commit AFTER INSERT ON "r8_incentive_award_bindings"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION iwantu_r8_reject_revoked_policy_binding();
