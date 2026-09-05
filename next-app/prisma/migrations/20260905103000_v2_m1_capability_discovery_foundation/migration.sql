-- V2-M1-08: capability discovery foundation.
-- CapabilityDefinition is an index, not an allowlist. AgentCapabilityClaim is
-- deliberately NOT foreign-keyed to CapabilityDefinition so an AgentVersion
-- may declare an external/unknown capability namespace without platform
-- pre-registration.

CREATE TYPE "CapabilityClaimStatus" AS ENUM ('declared', 'verified');

CREATE TABLE "capability_definitions" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "namespace" TEXT NOT NULL,
    "version" TEXT,
    "schemaRef" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "capability_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_capability_claims" (
    "id" TEXT NOT NULL,
    "agentVersionId" TEXT NOT NULL,
    "capabilityId" TEXT NOT NULL,
    "claimStatus" "CapabilityClaimStatus" NOT NULL DEFAULT 'declared',
    "descriptor" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_capability_claims_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "agent_market_profiles" (
    "id" TEXT NOT NULL,
    "agentIdentityId" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "a2aCardUrl" TEXT,
    "acceptsPublicTasks" BOOLEAN NOT NULL DEFAULT true,
    "availability" TEXT NOT NULL DEFAULT 'available',
    "extensions" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_market_profiles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "capability_definitions_namespace_status_idx"
ON "capability_definitions"("namespace", "status");
CREATE INDEX "capability_definitions_parentId_idx"
ON "capability_definitions"("parentId");

CREATE UNIQUE INDEX "agent_capability_claims_agentVersionId_capabilityId_key"
ON "agent_capability_claims"("agentVersionId", "capabilityId");
CREATE INDEX "agent_capability_claims_capabilityId_claimStatus_idx"
ON "agent_capability_claims"("capabilityId", "claimStatus");
CREATE INDEX "agent_capability_claims_agentVersionId_idx"
ON "agent_capability_claims"("agentVersionId");

CREATE UNIQUE INDEX "agent_market_profiles_agentIdentityId_key"
ON "agent_market_profiles"("agentIdentityId");
CREATE INDEX "agent_market_profiles_availability_acceptsPublicTasks_idx"
ON "agent_market_profiles"("availability", "acceptsPublicTasks");

ALTER TABLE "capability_definitions"
ADD CONSTRAINT "capability_definitions_parentId_fkey"
FOREIGN KEY ("parentId") REFERENCES "capability_definitions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_capability_claims"
ADD CONSTRAINT "agent_capability_claims_agentVersionId_fkey"
FOREIGN KEY ("agentVersionId") REFERENCES "agent_versions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "agent_market_profiles"
ADD CONSTRAINT "agent_market_profiles_agentIdentityId_fkey"
FOREIGN KEY ("agentIdentityId") REFERENCES "agent_identities"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "capability_definitions"
ADD CONSTRAINT "capability_definitions_nonempty_check" CHECK (
  length("id") > 0 AND length("name") > 0 AND length("namespace") > 0
);

ALTER TABLE "capability_definitions"
ADD CONSTRAINT "capability_definitions_parent_not_self_check" CHECK (
  "parentId" IS NULL OR "parentId" <> "id"
);

ALTER TABLE "agent_capability_claims"
ADD CONSTRAINT "agent_capability_claims_capability_nonempty_check" CHECK (
  length("capabilityId") > 0
);

ALTER TABLE "agent_market_profiles"
ADD CONSTRAINT "agent_market_profiles_availability_nonempty_check" CHECK (
  length("availability") > 0
);
