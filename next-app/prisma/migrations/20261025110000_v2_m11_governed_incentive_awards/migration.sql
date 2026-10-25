-- R8 prospective governed awards. Trusted server configuration and Ed25519
-- verification belong to the command service; SQL independently binds the
-- persisted identities, policy, immutable terminal facts and standard Ledger.
-- This migration never upgrades/backfills historical incentive transactions.

CREATE FUNCTION iwantu_r8_canonical_json(value JSONB) RETURNS TEXT AS $$
  SELECT CASE jsonb_typeof(value)
    WHEN 'object' THEN '{' || COALESCE((SELECT string_agg(to_jsonb(k)::text || ':' || iwantu_r8_canonical_json(v), ',' ORDER BY k COLLATE "C") FROM jsonb_each(value) e(k,v)), '') || '}'
    WHEN 'array' THEN '[' || COALESCE((SELECT string_agg(iwantu_r8_canonical_json(v), ',' ORDER BY n) FROM jsonb_array_elements(value) WITH ORDINALITY e(v,n)), '') || ']'
    ELSE value::text
  END;
$$ LANGUAGE sql IMMUTABLE STRICT;

CREATE FUNCTION iwantu_r8_hash(value JSONB) RETURNS TEXT AS $$
  SELECT encode(sha256(convert_to(iwantu_r8_canonical_json(value), 'UTF8')), 'hex');
$$ LANGUAGE sql IMMUTABLE STRICT;

-- Require the existing M2 lock; never acquire another lock after Contract or
-- Escrow work. Requiring ownership also serializes the SQL budget check for
-- callers that do not use the JavaScript service.
CREATE FUNCTION iwantu_r8_require_ledger_lock() RETURNS VOID AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory'
      AND pid = pg_backend_pid() AND granted AND mode = 'ExclusiveLock'
      AND classid = 1::oid AND objid = 626211041::oid AND objsubid = 1) THEN
    RAISE EXCEPTION 'R8_LEDGER_LOCK_REQUIRED';
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE "r8_incentive_programs" (
  "programId" TEXT PRIMARY KEY CHECK ("programId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  "governancePrincipalId" TEXT NOT NULL REFERENCES "principals"("id") ON DELETE RESTRICT,
  "governanceSigningKeyId" TEXT NOT NULL,
  "governanceKeyHash" TEXT NOT NULL CHECK ("governanceKeyHash" ~ '^[0-9a-f]{64}$'),
  "awardIssuerPrincipalId" TEXT NOT NULL REFERENCES "principals"("id") ON DELETE RESTRICT,
  "budgetIwc" DECIMAL(36,8) NOT NULL CHECK ("budgetIwc" > 0),
  "configurationHash" TEXT NOT NULL CHECK ("configurationHash" ~ '^[0-9a-f]{64}$'),
  "registration" JSONB NOT NULL CHECK (jsonb_typeof("registration") = 'object'),
  "authorizationId" TEXT NOT NULL UNIQUE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC')
);

CREATE TABLE "r8_incentive_authorizations" (
  "commandHash" TEXT PRIMARY KEY CHECK ("commandHash" ~ '^[0-9a-f]{64}$'),
  "programId" TEXT NOT NULL REFERENCES "r8_incentive_programs"("programId") ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED,
  "action" TEXT NOT NULL CHECK ("action" IN ('incentive.program.register', 'incentive.policy.publish', 'incentive.award.issue')),
  "principalId" TEXT NOT NULL REFERENCES "principals"("id") ON DELETE RESTRICT,
  "agentIdentityId" TEXT NOT NULL REFERENCES "agent_identities"("id") ON DELETE RESTRICT,
  "accessCredentialId" TEXT NOT NULL REFERENCES "agent_credentials"("id") ON DELETE RESTRICT,
  "signingCredentialId" TEXT NOT NULL REFERENCES "agent_credentials"("id") ON DELETE RESTRICT,
  "authoritySnapshotId" TEXT NOT NULL REFERENCES "authority_snapshots"("id") ON DELETE RESTRICT,
  "nonce" TEXT NOT NULL CHECK (length(trim("nonce")) BETWEEN 1 AND 200),
  "commandEvidence" JSONB NOT NULL CHECK (jsonb_typeof("commandEvidence") = 'object'),
  "payload" JSONB NOT NULL CHECK (jsonb_typeof("payload") = 'object'),
  "signature" TEXT NOT NULL CHECK ("signature" ~ '^[A-Za-z0-9_-]{86}$'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  UNIQUE ("principalId", "nonce")
);

ALTER TABLE "r8_incentive_programs" ADD CONSTRAINT "r8_program_registration_authorization_fkey"
  FOREIGN KEY ("authorizationId") REFERENCES "r8_incentive_authorizations"("commandHash")
  ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE "r8_incentive_policies" (
  "policyHash" TEXT PRIMARY KEY CHECK ("policyHash" ~ '^[0-9a-f]{64}$'),
  "programId" TEXT NOT NULL REFERENCES "r8_incentive_programs"("programId") ON DELETE RESTRICT,
  "policyVersion" TEXT NOT NULL CHECK ("policyVersion" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  "policy" JSONB NOT NULL CHECK (jsonb_typeof("policy") = 'object'),
  "authorizationId" TEXT NOT NULL UNIQUE REFERENCES "r8_incentive_authorizations"("commandHash") ON DELETE RESTRICT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  UNIQUE ("programId", "policyVersion")
);

CREATE TABLE "r8_incentive_award_bindings" (
  "id" TEXT PRIMARY KEY CHECK ("id" ~ '^[0-9a-f]{64}$'),
  "awardId" TEXT NOT NULL CHECK ("awardId" ~ '^[0-9a-f]{64}$'),
  "programId" TEXT NOT NULL REFERENCES "r8_incentive_programs"("programId") ON DELETE RESTRICT,
  "policyHash" TEXT NOT NULL REFERENCES "r8_incentive_policies"("policyHash") ON DELETE RESTRICT,
  "settlementId" TEXT NOT NULL REFERENCES "settlements"("id") ON DELETE RESTRICT,
  "beneficiaryRole" TEXT NOT NULL CHECK ("beneficiaryRole" IN ('buyer', 'supplier')),
  "awardSlot" TEXT NOT NULL CHECK ("awardSlot" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
  "beneficiaryPrincipalId" TEXT NOT NULL REFERENCES "principals"("id") ON DELETE RESTRICT,
  "amountIwc" DECIMAL(36,8) NOT NULL CHECK ("amountIwc" > 0),
  "ledgerTransactionId" TEXT NOT NULL UNIQUE REFERENCES "ledger_transactions"("id") ON DELETE RESTRICT,
  "authorizationId" TEXT NOT NULL UNIQUE REFERENCES "r8_incentive_authorizations"("commandHash") ON DELETE RESTRICT,
  "receipt" JSONB NOT NULL CHECK (jsonb_typeof("receipt") = 'object'),
  "receiptHash" TEXT NOT NULL UNIQUE CHECK ("receiptHash" ~ '^[0-9a-f]{64}$'),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (clock_timestamp() AT TIME ZONE 'UTC'),
  UNIQUE ("programId", "settlementId", "beneficiaryRole", "awardSlot"),
  UNIQUE ("programId", "awardId")
);

CREATE FUNCTION iwantu_r8_prevent_change() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'R8_APPEND_ONLY: % cannot be changed or deleted', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DO $$ DECLARE t TEXT; BEGIN
  FOREACH t IN ARRAY ARRAY['r8_incentive_programs', 'r8_incentive_authorizations', 'r8_incentive_policies', 'r8_incentive_award_bindings'] LOOP
    EXECUTE format('CREATE TRIGGER r8_no_change BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION iwantu_r8_prevent_change()', t);
  END LOOP;
END $$;

CREATE FUNCTION iwantu_r8_root_live(program_id TEXT) RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM "r8_incentive_programs" p
      JOIN "principals" owner ON owner."id" = p."governancePrincipalId"
      JOIN "agent_credentials" key ON key."keyId" = p."governanceSigningKeyId"
      JOIN "agent_identities" agent ON agent."id" = key."agentIdentityId"
    WHERE p."programId" = program_id AND owner."status" = 'active'
      AND agent."principalId" = owner."id" AND agent."status" = 'active'
      AND key."kind" = 'signing' AND key."status" = 'active' AND key."algorithm" = 'EdDSA'
      AND key."validFrom" <= (clock_timestamp() AT TIME ZONE 'UTC')
      AND (key."expiresAt" IS NULL OR key."expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC'))
      AND iwantu_r8_hash(key."publicKeyJwk") = p."governanceKeyHash"
    FOR SHARE OF owner, key, agent
  );
$$ LANGUAGE sql VOLATILE;

-- These are semantic/identity checks, not an Ed25519 verifier. Database owners
-- remain privileged; only the authenticated service may write command receipts.
CREATE FUNCTION iwantu_r8_validate_authorization() RETURNS trigger AS $$
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
      AND requested_amount ~ '^(0|[1-9][0-9]{0,27})\.[0-9]{8}$'
      AND requested_amount::numeric > 0
      AND snap."requestEvidence" -> 'economic' = jsonb_build_object('singleContract', requested_amount, 'currency', 'IWC')
      AND jsonb_typeof(leaf."economicLimits" -> 'singleContract') = 'string'
      AND leaf."economicLimits" ->> 'singleContract' ~ '^(0|[1-9][0-9]{0,27})\.[0-9]{8}$'
      AND leaf."economicLimits" ->> 'currency' = 'IWC'
      AND requested_amount::numeric <= (leaf."economicLimits" ->> 'singleContract')::numeric
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

CREATE CONSTRAINT TRIGGER r8_authorization_validate AFTER INSERT ON "r8_incentive_authorizations"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION iwantu_r8_validate_authorization();

CREATE FUNCTION iwantu_r8_validate_program() RETURNS trigger AS $$
DECLARE a "r8_incentive_authorizations"%ROWTYPE; expected JSONB; config JSONB;
BEGIN
  PERFORM iwantu_r8_require_ledger_lock();
  SELECT * INTO a FROM "r8_incentive_authorizations" WHERE "commandHash" = NEW."authorizationId";
  config := jsonb_build_object('governancePrincipalId', NEW."governancePrincipalId", 'governanceSigningKeyId', NEW."governanceSigningKeyId",
    'governanceKeyHash', NEW."governanceKeyHash", 'awardIssuerPrincipalId', NEW."awardIssuerPrincipalId", 'maximumBudgetIwc', NEW."registration" ->> 'maximumBudgetIwc');
  expected := config || jsonb_build_object('protocol', 'iwantu.incentive-program-registration/0.1', 'programId', NEW."programId",
    'budgetIwc', NEW."budgetIwc"::text, 'configurationHash', NEW."configurationHash");
  IF (NEW."registration" = expected AND NEW."configurationHash" = iwantu_r8_hash(config)
      AND NEW."registration" ->> 'maximumBudgetIwc' ~ '^(0|[1-9][0-9]{0,27})\.[0-9]{8}$'
      AND NEW."budgetIwc" <= (NEW."registration" ->> 'maximumBudgetIwc')::numeric
      AND a."action" = 'incentive.program.register' AND a."programId" = NEW."programId"
      AND a."payload" = jsonb_build_object('action', a."action", 'registration', NEW."registration")) IS NOT TRUE THEN
    RAISE EXCEPTION 'R8_PROGRAM_REGISTRATION_INVALID';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER r8_program_validate AFTER INSERT ON "r8_incentive_programs"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION iwantu_r8_validate_program();

CREATE FUNCTION iwantu_r8_validate_policy() RETURNS trigger AS $$
DECLARE p "r8_incentive_programs"%ROWTYPE; a "r8_incentive_authorizations"%ROWTYPE; v JSONB := NEW."policy";
BEGIN
  PERFORM iwantu_r8_require_ledger_lock();
  SELECT * INTO p FROM "r8_incentive_programs" WHERE "programId" = NEW."programId";
  SELECT * INTO a FROM "r8_incentive_authorizations" WHERE "commandHash" = NEW."authorizationId";
  IF (NEW."policyHash" = iwantu_r8_hash(v)
      AND v - ARRAY['protocol','programId','policyVersion','issuerPrincipalId','triggerType','eligibleSettlementTypes','beneficiaryRole','awardSlot','rewardFormula','effectiveFrom','effectiveUntil','deduplicationScope'] = '{}'::jsonb
      AND v ->> 'protocol' = 'iwantu.incentive-program-policy/0.2'
      AND v ->> 'deduplicationScope' = 'program_settlement_role_slot'
      AND v ->> 'programId' = NEW."programId" AND v ->> 'policyVersion' = NEW."policyVersion"
      AND v ->> 'issuerPrincipalId' = p."governancePrincipalId"
      AND v ->> 'triggerType' = 'terminal_settlement'
      AND v ->> 'beneficiaryRole' IN ('buyer', 'supplier')
      AND v ->> 'awardSlot' ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
      AND v -> 'rewardFormula' = jsonb_build_object('kind', 'fixed_amount', 'amountIwc', v -> 'rewardFormula' ->> 'amountIwc')
      AND v -> 'rewardFormula' ->> 'amountIwc' ~ '^(0|[1-9][0-9]{0,27})\.[0-9]{8}$'
      AND (v -> 'rewardFormula' ->> 'amountIwc')::numeric > 0
      AND (v -> 'rewardFormula' ->> 'amountIwc')::numeric <= p."budgetIwc"
      AND jsonb_typeof(v -> 'eligibleSettlementTypes') = 'array'
      AND jsonb_array_length(v -> 'eligibleSettlementTypes') BETWEEN 1 AND 3
      AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(v -> 'eligibleSettlementTypes') e(t) WHERE t NOT IN ('full_settlement', 'full_refund', 'mutual_split'))
      AND (SELECT count(DISTINCT t) FROM jsonb_array_elements_text(v -> 'eligibleSettlementTypes') e(t)) = jsonb_array_length(v -> 'eligibleSettlementTypes')
      AND ((v ->> 'effectiveFrom')::timestamptz AT TIME ZONE 'UTC') >= p."createdAt"
      AND (v ->> 'effectiveUntil')::timestamptz > (v ->> 'effectiveFrom')::timestamptz
      AND a."action" = 'incentive.policy.publish' AND a."programId" = NEW."programId"
      AND a."payload" = jsonb_build_object('action', a."action", 'programId', NEW."programId", 'policyHash', NEW."policyHash")) IS NOT TRUE THEN
    RAISE EXCEPTION 'R8_POLICY_INVALID';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER r8_policy_validate BEFORE INSERT ON "r8_incentive_policies"
  FOR EACH ROW EXECUTE FUNCTION iwantu_r8_validate_policy();

CREATE FUNCTION iwantu_r8_validate_binding() RETURNS trigger AS $$
DECLARE
  p "r8_incentive_programs"%ROWTYPE; policy_row "r8_incentive_policies"%ROWTYPE;
  a "r8_incentive_authorizations"%ROWTYPE; s "settlements"%ROWTYPE; c "contracts"%ROWTYPE;
  t "ledger_transactions"%ROWTYPE; expected JSONB; payload JSONB; expected_provenance JSONB;
  expected_award TEXT; amount_text TEXT := NEW."amountIwc"::text; leg_count INTEGER; valid_count INTEGER; spent NUMERIC;
  now_utc TIMESTAMP := clock_timestamp() AT TIME ZONE 'UTC';
BEGIN
  PERFORM iwantu_r8_require_ledger_lock();
  SELECT * INTO p FROM "r8_incentive_programs" WHERE "programId" = NEW."programId";
  SELECT * INTO policy_row FROM "r8_incentive_policies" WHERE "policyHash" = NEW."policyHash";
  SELECT * INTO a FROM "r8_incentive_authorizations" WHERE "commandHash" = NEW."authorizationId";
  SELECT * INTO s FROM "settlements" WHERE "id" = NEW."settlementId";
  SELECT * INTO c FROM "contracts" WHERE "id" = s."contractId";
  SELECT * INTO t FROM "ledger_transactions" WHERE "id" = NEW."ledgerTransactionId";
  expected_award := iwantu_r8_hash(jsonb_build_object('protocol', 'iwantu.incentive-program-entitlement/0.1',
    'programId', NEW."programId", 'settlementId', NEW."settlementId", 'beneficiaryRole', NEW."beneficiaryRole", 'awardSlot', NEW."awardSlot"));
  payload := jsonb_build_object('action', 'incentive.award.issue', 'programId', NEW."programId", 'policyHash', NEW."policyHash",
    'settlementId', NEW."settlementId", 'settlementHash', s."settlementHash", 'beneficiaryPrincipalId', NEW."beneficiaryPrincipalId",
    'beneficiaryRole', NEW."beneficiaryRole", 'awardSlot', NEW."awardSlot", 'amountIwc', amount_text, 'currency', 'IWC', 'awardId', NEW."awardId");
  expected := (payload - 'action' - 'currency') || jsonb_build_object('protocol', 'iwantu.incentive-award-receipt/0.1',
    'ledgerTransactionId', NEW."ledgerTransactionId", 'ledgerTransactionHash', t."transactionHash", 'authorizationId', NEW."authorizationId");
  expected_provenance := jsonb_build_object('schemaVersion', 'iwantu-credit-provenance/0.1', 'kind', 'incentive',
    'beneficiaryPrincipalId', NEW."beneficiaryPrincipalId", 'sourceReferenceType', 'protocol_incentive_award',
    'sourceReferenceId', NEW."programId" || ':' || NEW."awardId", 'programId', NEW."programId", 'awardId', NEW."awardId");

  IF (NEW."id" = expected_award AND NEW."awardId" = expected_award
      AND NEW."receipt" = expected AND NEW."receiptHash" = iwantu_r8_hash(expected)
      AND policy_row."programId" = NEW."programId"
      AND policy_row."policy" ->> 'beneficiaryRole' = NEW."beneficiaryRole"
      AND policy_row."policy" ->> 'awardSlot' = NEW."awardSlot"
      AND policy_row."policy" -> 'rewardFormula' ->> 'amountIwc' = amount_text
      AND policy_row."policy" -> 'eligibleSettlementTypes' @> to_jsonb(ARRAY[s."type"])
      AND s."createdAt" >= policy_row."createdAt"
      AND s."createdAt" >= ((policy_row."policy" ->> 'effectiveFrom')::timestamptz AT TIME ZONE 'UTC')
      AND s."createdAt" < ((policy_row."policy" ->> 'effectiveUntil')::timestamptz AT TIME ZONE 'UTC')
      AND now_utc >= ((policy_row."policy" ->> 'effectiveFrom')::timestamptz AT TIME ZONE 'UTC')
      AND now_utc < ((policy_row."policy" ->> 'effectiveUntil')::timestamptz AT TIME ZONE 'UTC')
      AND c."lifecycleState" = 'closed'
      AND NEW."beneficiaryPrincipalId" = CASE NEW."beneficiaryRole" WHEN 'buyer' THEN c."buyerPrincipalId" ELSE c."supplierPrincipalId" END
      AND EXISTS (SELECT 1 FROM "principals" WHERE "id" = NEW."beneficiaryPrincipalId" AND "status" = 'active')
      AND a."action" = 'incentive.award.issue' AND a."programId" = NEW."programId" AND a."payload" = payload
      AND t."status" = 'posted' AND t."type" = 'incentive' AND t."referenceType" = 'protocol_incentive_award'
      AND t."referenceId" = NEW."programId" || ':' || NEW."awardId"
      AND t."idempotencyKey" = 'credit:incentive-award:' || t."referenceId"
      AND t."metadata" ->> 'programId' = NEW."programId" AND t."metadata" ->> 'awardId' = NEW."awardId"
      AND t."metadata" ->> 'beneficiaryPrincipalId' = NEW."beneficiaryPrincipalId"
      AND t."transactionHash" ~ '^[0-9a-f]{64}$' AND t."postedAt" >= s."createdAt") IS NOT TRUE THEN
    RAISE EXCEPTION 'R8_AWARD_BINDING_INVALID';
  END IF;

  SELECT count(*), count(*) FILTER (WHERE e."amount" = NEW."amountIwc" AND account."currency" = 'IWC' AND (
      (e."entryIndex" = 0 AND e."side" = 'debit' AND account."type" = 'system_incentive' AND account."principalId" IS NULL)
      OR (e."entryIndex" = 1 AND e."side" = 'credit' AND account."type" = 'principal_available'
          AND account."principalId" = NEW."beneficiaryPrincipalId" AND e."provenance" = expected_provenance)))
  INTO leg_count, valid_count FROM "ledger_entries" e JOIN "ledger_accounts" account ON account."id" = e."accountId"
  WHERE e."transactionId" = NEW."ledgerTransactionId";
  IF leg_count <> 2 OR valid_count <> 2 THEN RAISE EXCEPTION 'R8_AWARD_LEDGER_INVALID'; END IF;

  -- Shared budget includes legacy canonical POSTED awards for this Program,
  -- not merely receipts and not a policy-version-scoped counter.
  SELECT COALESCE(sum(e."amount"), 0) INTO spent
  FROM "ledger_transactions" lt JOIN "ledger_entries" e ON e."transactionId" = lt."id"
    JOIN "ledger_accounts" account ON account."id" = e."accountId"
  WHERE lt."status" = 'posted' AND lt."metadata" ->> 'programId' = NEW."programId"
    AND e."side" = 'debit' AND account."type" = 'system_incentive';
  IF spent > p."budgetIwc" THEN RAISE EXCEPTION 'R8_PROGRAM_BUDGET_EXCEEDED'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER r8_binding_validate BEFORE INSERT ON "r8_incentive_award_bindings"
  FOR EACH ROW EXECUTE FUNCTION iwantu_r8_validate_binding();

-- A registered Program cannot escape governance through the older M2 helper.
-- Deferred validation permits the canonical writer to post Ledger then insert
-- its binding in one transaction, while rejecting any committed orphan payout.
CREATE FUNCTION iwantu_r8_require_governed_binding() RETURNS trigger AS $$
DECLARE managed BOOLEAN;
BEGIN
  IF NEW."status" <> 'posted' THEN RETURN NEW; END IF;
  SELECT EXISTS (
    SELECT 1 FROM "r8_incentive_programs" p
    WHERE p."programId" = NEW."metadata" ->> 'programId'
      OR (NEW."referenceType" = 'protocol_incentive_award' AND split_part(NEW."referenceId", ':', 1) = p."programId")
      OR EXISTS (SELECT 1 FROM "ledger_entries" e WHERE e."transactionId" = NEW."id" AND e."provenance" ->> 'programId' = p."programId")
  ) INTO managed;
  IF managed AND (NEW."type" = 'incentive' OR NEW."referenceType" = 'protocol_incentive_award'
      OR NEW."metadata" ->> 'creditSource' = 'incentive'
      OR EXISTS (SELECT 1 FROM "ledger_entries" e JOIN "ledger_accounts" a ON a."id" = e."accountId"
          WHERE e."transactionId" = NEW."id" AND ((e."side" = 'debit' AND a."type" = 'system_incentive')
            OR e."provenance" ->> 'kind' = 'incentive' OR e."provenance" ->> 'sourceReferenceType' = 'protocol_incentive_award')))
      AND NOT EXISTS (SELECT 1 FROM "r8_incentive_award_bindings" b WHERE b."ledgerTransactionId" = NEW."id") THEN
    RAISE EXCEPTION 'R8_GOVERNED_AWARD_BINDING_REQUIRED';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER r8_governed_ledger_gate AFTER INSERT OR UPDATE ON "ledger_transactions"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION iwantu_r8_require_governed_binding();
