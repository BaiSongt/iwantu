-- V2-M1 Identity & Authority Foundation (M1-05 Authority Resolver + Delegation)
-- Extends immutable Mandate facts with a one-hop delegated authority chain.
-- Existing root Mandates remain valid with delegationDepth=0.

ALTER TABLE "mandates"
ADD COLUMN "parentMandateId" TEXT,
ADD COLUMN "delegatingAgentIdentityId" TEXT,
ADD COLUMN "delegationDepth" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "mandates_parentMandateId_idx" ON "mandates"("parentMandateId");
CREATE INDEX "mandates_delegatingAgentIdentityId_idx" ON "mandates"("delegatingAgentIdentityId");
CREATE INDEX "mandates_issuerPrincipalId_delegationDepth_idx"
ON "mandates"("issuerPrincipalId", "delegationDepth");

ALTER TABLE "mandates" ADD CONSTRAINT "mandates_parentMandateId_fkey"
FOREIGN KEY ("parentMandateId") REFERENCES "mandates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "mandates" ADD CONSTRAINT "mandates_delegatingAgentIdentityId_fkey"
FOREIGN KEY ("delegatingAgentIdentityId") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- MVP supports only Principal -> Primary Agent -> Sub-Agent.
ALTER TABLE "mandates" ADD CONSTRAINT "mandates_delegation_structure_check" CHECK (
    (
        "delegationDepth" = 0
        AND "parentMandateId" IS NULL
        AND "delegatingAgentIdentityId" IS NULL
    )
    OR
    (
        "delegationDepth" = 1
        AND "parentMandateId" IS NOT NULL
        AND "delegatingAgentIdentityId" IS NOT NULL
        AND "delegationAllowed" = false
        AND "maxDelegationDepth" = 0
    )
);

-- Structural delegation invariants are enforced in the database. Scope/limit/
-- policy narrowing is additionally enforced by the Authority Core and Resolver,
-- which fail closed if a row somehow exceeds parent authority.
CREATE FUNCTION "validate_mandate_delegation_structure"()
RETURNS TRIGGER AS $$
DECLARE
    parent_mandate RECORD;
    parent_revoked BOOLEAN;
    parent_superseded_at TIMESTAMP(3);
BEGIN
    IF NEW."delegationDepth" = 0 THEN
        RETURN NEW;
    END IF;

    SELECT
        m."issuerPrincipalId",
        m."subjectAgentIdentityId",
        m."delegationDepth",
        m."delegationAllowed",
        m."maxDelegationDepth",
        m."validFrom",
        m."validUntil"
    INTO parent_mandate
    FROM "mandates" m
    WHERE m."id" = NEW."parentMandateId";

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent Mandate does not exist'
            USING ERRCODE = '23503';
    END IF;

    IF parent_mandate."delegationDepth" <> 0
       OR parent_mandate."delegationAllowed" = false
       OR parent_mandate."maxDelegationDepth" < 1 THEN
        RAISE EXCEPTION 'Parent Mandate cannot delegate at the requested depth'
            USING ERRCODE = '23514';
    END IF;

    IF parent_mandate."issuerPrincipalId" <> NEW."issuerPrincipalId" THEN
        RAISE EXCEPTION 'Delegated Mandate must remain attributable to the root Principal'
            USING ERRCODE = '23514';
    END IF;

    IF parent_mandate."subjectAgentIdentityId" <> NEW."delegatingAgentIdentityId" THEN
        RAISE EXCEPTION 'Only the subject Agent of the parent Mandate may delegate it'
            USING ERRCODE = '23514';
    END IF;

    IF NEW."validFrom" < parent_mandate."validFrom" THEN
        RAISE EXCEPTION 'Delegated Mandate cannot start before its parent authority'
            USING ERRCODE = '23514';
    END IF;

    IF parent_mandate."validUntil" IS NOT NULL
       AND (NEW."validUntil" IS NULL OR NEW."validUntil" > parent_mandate."validUntil") THEN
        RAISE EXCEPTION 'Delegated Mandate cannot outlive its parent authority'
            USING ERRCODE = '23514';
    END IF;

    SELECT EXISTS(
        SELECT 1
        FROM "mandate_revocations" r
        WHERE r."mandateId" = NEW."parentMandateId"
          AND r."revokedAt" <= NEW."validFrom"
    ) INTO parent_revoked;

    IF parent_revoked THEN
        RAISE EXCEPTION 'Revoked parent Mandate cannot create new delegated authority'
            USING ERRCODE = '23514';
    END IF;

    SELECT MIN(successor."validFrom")
    INTO parent_superseded_at
    FROM "mandates" successor
    WHERE successor."supersedesMandateId" = NEW."parentMandateId";

    IF parent_superseded_at IS NOT NULL AND parent_superseded_at <= NEW."validFrom" THEN
        RAISE EXCEPTION 'Superseded parent Mandate cannot create new delegated authority'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "mandates_validate_delegation_structure"
BEFORE INSERT ON "mandates"
FOR EACH ROW
EXECUTE FUNCTION "validate_mandate_delegation_structure"();

-- Version changes of a delegated Mandate must preserve its authority-chain
-- position as well as family/issuer/subject identity.
CREATE OR REPLACE FUNCTION "validate_mandate_version_chain"()
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

    SELECT
        "mandateFamilyId",
        "version",
        "issuerPrincipalId",
        "subjectAgentIdentityId",
        "parentMandateId",
        "delegatingAgentIdentityId",
        "delegationDepth"
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
       OR previous_mandate."subjectAgentIdentityId" <> NEW."subjectAgentIdentityId"
       OR previous_mandate."parentMandateId" IS DISTINCT FROM NEW."parentMandateId"
       OR previous_mandate."delegatingAgentIdentityId" IS DISTINCT FROM NEW."delegatingAgentIdentityId"
       OR previous_mandate."delegationDepth" <> NEW."delegationDepth" THEN
        RAISE EXCEPTION 'Mandate version chain must preserve family, issuer, subject, and delegation-chain position while advancing exactly one version'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
