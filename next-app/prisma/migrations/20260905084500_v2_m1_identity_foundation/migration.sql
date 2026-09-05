-- V2-M1 Identity & Authority Foundation (M1-01 / M1-02)
-- Additive-only migration. Existing v1 tables and write paths are preserved.

-- CreateEnum
CREATE TYPE "PrincipalType" AS ENUM ('individual', 'organization');

-- CreateEnum
CREATE TYPE "PrincipalStatus" AS ENUM ('active', 'suspended');

-- CreateEnum
CREATE TYPE "AgentIdentityStatus" AS ENUM ('active', 'suspended', 'retired');

-- CreateTable
CREATE TABLE "principals" (
    "id" TEXT NOT NULL,
    "type" "PrincipalType" NOT NULL,
    "status" "PrincipalStatus" NOT NULL DEFAULT 'active',
    "userId" TEXT,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt" TIMESTAMP(3),

    CONSTRAINT "principals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_identities" (
    "id" TEXT NOT NULL,
    "principalId" TEXT NOT NULL,
    "legacyAgentProductId" TEXT,
    "name" TEXT NOT NULL,
    "status" "AgentIdentityStatus" NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suspendedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "agent_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_versions" (
    "id" TEXT NOT NULL,
    "agentIdentityId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "softwareVersion" TEXT,
    "runtimeMeta" JSONB,
    "modelMeta" JSONB,
    "capabilityImplementationMeta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "agent_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "principals_userId_key" ON "principals"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "principals_organizationId_key" ON "principals"("organizationId");

-- CreateIndex
CREATE INDEX "principals_type_status_idx" ON "principals"("type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_identities_legacyAgentProductId_key" ON "agent_identities"("legacyAgentProductId");

-- CreateIndex
CREATE INDEX "agent_identities_principalId_status_idx" ON "agent_identities"("principalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "agent_versions_agentIdentityId_version_key" ON "agent_versions"("agentIdentityId", "version");

-- CreateIndex
CREATE INDEX "agent_versions_agentIdentityId_createdAt_idx" ON "agent_versions"("agentIdentityId", "createdAt");

-- AddForeignKey
ALTER TABLE "principals" ADD CONSTRAINT "principals_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "principals" ADD CONSTRAINT "principals_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_principalId_fkey"
FOREIGN KEY ("principalId") REFERENCES "principals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_identities" ADD CONSTRAINT "agent_identities_legacyAgentProductId_fkey"
FOREIGN KEY ("legacyAgentProductId") REFERENCES "agent_products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_versions" ADD CONSTRAINT "agent_versions_agentIdentityId_fkey"
FOREIGN KEY ("agentIdentityId") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Principal legacy mapping invariant for the MVP:
-- individual -> exactly one User; organization -> exactly one Organization.
ALTER TABLE "principals" ADD CONSTRAINT "principals_legacy_mapping_check" CHECK (
    ("type" = 'individual' AND "userId" IS NOT NULL AND "organizationId" IS NULL)
    OR
    ("type" = 'organization' AND "organizationId" IS NOT NULL AND "userId" IS NULL)
);

-- AgentIdentity ownership is immutable in the MVP. Ownership transfer, especially
-- cross-Principal transfer, must be introduced later as an explicit protocol if ever allowed.
CREATE FUNCTION "prevent_agent_identity_principal_change"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."principalId" IS DISTINCT FROM OLD."principalId" THEN
        RAISE EXCEPTION 'AgentIdentity ownership is immutable; cross-Principal transfer is not allowed'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "agent_identities_principal_immutable"
BEFORE UPDATE OF "principalId" ON "agent_identities"
FOR EACH ROW
EXECUTE FUNCTION "prevent_agent_identity_principal_change"();

-- Idempotent legacy Principal backfill. Deterministic IDs make the migration auditable,
-- while unique legacy mapping keys guarantee a User/Organization cannot fan out to
-- duplicate Principals.
INSERT INTO "principals" ("id", "type", "status", "userId", "createdAt")
SELECT
    'prn_ind_' || md5('user:' || u."id"),
    'individual'::"PrincipalType",
    'active'::"PrincipalStatus",
    u."id",
    u."createdAt"
FROM "users" u
ON CONFLICT ("userId") DO NOTHING;

INSERT INTO "principals" ("id", "type", "status", "organizationId", "createdAt")
SELECT
    'prn_org_' || md5('organization:' || o."id"),
    'organization'::"PrincipalType",
    'active'::"PrincipalStatus",
    o."id",
    o."createdAt"
FROM "organizations" o
ON CONFLICT ("organizationId") DO NOTHING;
