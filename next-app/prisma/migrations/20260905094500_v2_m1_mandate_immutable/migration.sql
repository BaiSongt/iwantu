-- V2-M1 Identity & Authority Foundation (M1-04 Mandate immutable model)
-- Additive-only. No Delegation, Authority Resolver, transaction-domain cutover,
-- or legacy MCP auth changes are introduced here.

-- CreateTable
CREATE TABLE "mandates" (
    "id" TEXT NOT NULL,
    "mandateFamilyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "protocolVersion" TEXT NOT NULL DEFAULT 'iwantu-mandate/0.1',
    "issuerPrincipalId" TEXT NOT NULL,
    "subjectAgentIdentityId" TEXT NOT NULL,
    "actionScopes" TEXT[],
    "capabilityScopes" TEXT[],
    "economicLimits" JSONB NOT NULL,
    "resourcePolicy" JSONB NOT NULL,
    "dataPolicy" JSONB NOT NULL,
    "counterpartyPolicy" JSONB NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validUntil" TIMESTAMP(3),
    "delegationAllowed" BOOLEAN NOT NULL DEFAULT false,
    "maxDelegationDepth" INTEGER NOT NULL DEFAULT 0,
    "payloadHash" TEXT NOT NULL,
    "signatureAlgorithm" TEXT NOT NULL,
    "signatureKeyId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "supersedesMandateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mandates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mandate_revocations" (
    "id" TEXT NOT NULL,
    "mandateId" TEXT NOT NULL,
    "revokedByPrincipalId" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reason" TEXT,
    "payloadHash" TEXT NOT NULL,
    "signatureAlgorithm" TEXT NOT NULL,
    "signatureKeyId" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mandate_revocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mandates_supersedesMandateId_key"
ON "mandates"("supersedesMandateId");

-- CreateIndex
CREATE UNIQUE INDEX "mandates_mandateFamilyId_version_key"
ON "mandates"("mandateFamilyId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "mandates_mandateFamilyId_payloadHash_key"
ON "mandates"("mandateFamilyId", "payloadHash");

-- CreateIndex
CREATE INDEX "mandates_issuerPrincipalId_createdAt_idx"
ON "mandates"("issuerPrincipalId", "createdAt");

-- CreateIndex
CREATE INDEX "mandates_subjectAgentIdentityId_validFrom_idx"
ON "mandates"("subjectAgentIdentityId", "validFrom");

-- CreateIndex
CREATE INDEX "mandates_validUntil_idx" ON "mandates"("validUntil");

-- CreateIndex
CREATE UNIQUE INDEX "mandate_revocations_mandateId_key"
ON "mandate_revocations"("mandateId");

-- CreateIndex
CREATE INDEX "mandate_revocations_revokedByPrincipalId_revokedAt_idx"
ON "mandate_revocations"("revokedByPrincipalId", "revokedAt");

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_issuerPrincipalId_fkey"
FOREIGN KEY ("issuerPrincipalId") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_subjectAgentIdentityId_fkey"
FOREIGN KEY ("subjectAgentIdentityId") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_supersedesMandateId_fkey"
FOREIGN KEY ("supersedesMandateId") REFERENCES "mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_revocations" ADD CONSTRAINT "mandate_revocations_mandateId_fkey"
FOREIGN KEY ("mandateId") REFERENCES "mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mandate_revocations" ADD CONSTRAINT "mandate_revocations_revokedByPrincipalId_fkey"
FOREIGN KEY ("revokedByPrincipalId") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A Mandate must grant at least one explicit action. Empty capability scope is
-- allowed and is interpreted later by the Authority Resolver; M1-04 does not
-- invent resolver semantics.
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_scope_check" CHECK (
    cardinality("actionScopes") > 0
);

ALTER TABLE "mandates" ADD CONSTRAINT "mandates_version_check" CHECK (
    "version" >= 1
);

ALTER TABLE "mandates" ADD CONSTRAINT "mandates_validity_window_check" CHECK (
    "validUntil" IS NULL OR "validUntil" > "validFrom"
);

-- MVP delegation depth is capped at one hop by the design baseline. M1-04 only
-- records the constraint; actual delegation creation/resolution is M1-05.
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_delegation_limit_check" CHECK (
    ("delegationAllowed" = false AND "maxDelegationDepth" = 0)
    OR
    ("delegationAllowed" = true AND "maxDelegationDepth" = 1)
);

-- SHA-256 canonical payload hashes are lowercase hex.
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_payload_hash_check" CHECK (
    "payloadHash" ~ '^[0-9a-f]{64}$'
);

ALTER TABLE "mandate_revocations" ADD CONSTRAINT "mandate_revocations_payload_hash_check" CHECK (
    "payloadHash" ~ '^[0-9a-f]{64}$'
);

-- Version chains are append-only. Version 1 starts a family; every later version
-- must explicitly supersede exactly the preceding version in the same family,
-- with the same issuer Principal and subject AgentIdentity.
CREATE FUNCTION "validate_mandate_version_chain"()
RETURNS TRIGGER AS $$
DECLARE
    previous_mandate RECORD;
BEGIN
    IF NEW."version" = 1 THEN
        IF NEW."supersedesMandateId" IS NOT NULL THEN
            RAISE EXCEPTION 'Mandate version 1 cannot supersede another Mandate'
                USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW."supersedesMandateId" IS NULL THEN
        RAISE EXCEPTION 'Mandate version > 1 must explicitly supersede the previous version'
            USING ERRCODE = '23514';
    END IF;

    SELECT "mandateFamilyId", "version", "issuerPrincipalId", "subjectAgentIdentityId"
    INTO previous_mandate
    FROM "mandates"
    WHERE "id" = NEW."supersedesMandateId";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Superseded Mandate does not exist'
            USING ERRCODE = '23503';
    END IF;

    IF previous_mandate."mandateFamilyId" <> NEW."mandateFamilyId"
       OR previous_mandate."version" + 1 <> NEW."version"
       OR previous_mandate."issuerPrincipalId" <> NEW."issuerPrincipalId"
       OR previous_mandate."subjectAgentIdentityId" <> NEW."subjectAgentIdentityId" THEN
        RAISE EXCEPTION 'Mandate version chain must preserve family, issuer, subject, and advance exactly one version'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mandates_validate_version_chain"
BEFORE INSERT ON "mandates"
FOR EACH ROW
EXECUTE FUNCTION "validate_mandate_version_chain"();

-- The signed Mandate payload is immutable. Scope/limits/policy/time/signature
-- changes require issuance of a new version, never UPDATE-in-place.
CREATE FUNCTION "prevent_mandate_update"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Mandate is immutable; issue a new version instead of updating it'
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mandates_no_update"
BEFORE UPDATE ON "mandates"
FOR EACH ROW
EXECUTE FUNCTION "prevent_mandate_update"();

-- Mandates are historical authority facts and cannot be physically deleted.
CREATE FUNCTION "prevent_mandate_delete"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Mandate is an immutable authority fact and cannot be physically deleted'
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mandates_no_delete"
BEFORE DELETE ON "mandates"
FOR EACH ROW
EXECUTE FUNCTION "prevent_mandate_delete"();

-- Revocation is a separate append-only fact. Only the original issuer Principal
-- may revoke the Mandate in M1-04; delegated revocation semantics belong to M1-05.
CREATE FUNCTION "validate_mandate_revocation_issuer"()
RETURNS TRIGGER AS $$
DECLARE
    mandate_issuer TEXT;
BEGIN
    SELECT "issuerPrincipalId"
    INTO mandate_issuer
    FROM "mandates"
    WHERE "id" = NEW."mandateId";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Mandate to revoke does not exist'
            USING ERRCODE = '23503';
    END IF;

    IF mandate_issuer <> NEW."revokedByPrincipalId" THEN
        RAISE EXCEPTION 'Only the Mandate issuer Principal may revoke it in M1-04'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mandate_revocations_validate_issuer"
BEFORE INSERT ON "mandate_revocations"
FOR EACH ROW
EXECUTE FUNCTION "validate_mandate_revocation_issuer"();

CREATE FUNCTION "prevent_mandate_revocation_change"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'MandateRevocation is append-only and cannot be changed or deleted'
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mandate_revocations_no_update"
BEFORE UPDATE ON "mandate_revocations"
FOR EACH ROW
EXECUTE FUNCTION "prevent_mandate_revocation_change"();

CREATE TRIGGER "mandate_revocations_no_delete"
BEFORE DELETE ON "mandate_revocations"
FOR EACH ROW
EXECUTE FUNCTION "prevent_mandate_revocation_change"();
