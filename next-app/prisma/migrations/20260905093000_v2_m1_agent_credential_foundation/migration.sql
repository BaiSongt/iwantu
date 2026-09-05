-- V2-M1 Identity & Authority Foundation (M1-03 AgentCredential)
-- Additive migration. Legacy ApiKey and all v1 authentication paths remain intact.

-- CreateEnum
CREATE TYPE "AgentCredentialKind" AS ENUM ('api', 'signing', 'oauth_a2a');

-- CreateEnum
CREATE TYPE "AgentCredentialStatus" AS ENUM ('active', 'retired', 'revoked');

-- CreateTable
CREATE TABLE "agent_credentials" (
    "id" TEXT NOT NULL,
    "agentIdentityId" TEXT NOT NULL,
    "kind" "AgentCredentialKind" NOT NULL,
    "status" "AgentCredentialStatus" NOT NULL DEFAULT 'active',
    "keyId" TEXT NOT NULL,
    "prefix" TEXT,
    "secretHash" TEXT,
    "publicKeyJwk" JSONB,
    "algorithm" TEXT,
    "accessScopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_credentials_keyId_key" ON "agent_credentials"("keyId");

-- CreateIndex
CREATE INDEX "agent_credentials_agentIdentityId_status_idx"
ON "agent_credentials"("agentIdentityId", "status");

-- CreateIndex
CREATE INDEX "agent_credentials_kind_status_idx"
ON "agent_credentials"("kind", "status");

-- AddForeignKey
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_agentIdentityId_fkey"
FOREIGN KEY ("agentIdentityId") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Credential material invariant:
-- * API credentials persist only a hash of the shared secret.
-- * Signing credentials persist only public verification material; private signing keys
--   have no storage column in iWANTU.
-- * OAUTH/A2A credentials remain extensible for provider-specific material.
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_material_check" CHECK (
    ("kind" = 'api' AND "secretHash" IS NOT NULL AND "publicKeyJwk" IS NULL)
    OR
    ("kind" = 'signing' AND "secretHash" IS NULL AND "publicKeyJwk" IS NOT NULL)
    OR
    ("kind" = 'oauth_a2a')
);

-- Lifecycle timestamps must agree with lifecycle state.
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_lifecycle_check" CHECK (
    ("status" = 'active' AND "revokedAt" IS NULL AND "retiredAt" IS NULL)
    OR
    ("status" = 'revoked' AND "revokedAt" IS NOT NULL AND "retiredAt" IS NULL)
    OR
    ("status" = 'retired' AND "retiredAt" IS NOT NULL AND "revokedAt" IS NULL)
);

-- Credential identity/material/access scope are immutable. Rotation creates a new row.
-- Revoked/retired credentials are terminal and remain available for historical lookup.
CREATE FUNCTION "enforce_agent_credential_immutability"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."agentIdentityId" IS DISTINCT FROM OLD."agentIdentityId"
       OR NEW."kind" IS DISTINCT FROM OLD."kind"
       OR NEW."keyId" IS DISTINCT FROM OLD."keyId"
       OR NEW."prefix" IS DISTINCT FROM OLD."prefix"
       OR NEW."secretHash" IS DISTINCT FROM OLD."secretHash"
       OR NEW."publicKeyJwk" IS DISTINCT FROM OLD."publicKeyJwk"
       OR NEW."algorithm" IS DISTINCT FROM OLD."algorithm"
       OR NEW."accessScopes" IS DISTINCT FROM OLD."accessScopes"
       OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" THEN
        RAISE EXCEPTION 'AgentCredential material is immutable; rotate by creating a new credential'
            USING ERRCODE = '23514';
    END IF;

    IF OLD."status" IN ('revoked', 'retired') AND NEW."status" IS DISTINCT FROM OLD."status" THEN
        RAISE EXCEPTION 'Revoked or retired AgentCredential status is terminal'
            USING ERRCODE = '23514';
    END IF;

    IF OLD."revokedAt" IS NOT NULL AND NEW."revokedAt" IS DISTINCT FROM OLD."revokedAt" THEN
        RAISE EXCEPTION 'AgentCredential revokedAt is immutable once set'
            USING ERRCODE = '23514';
    END IF;

    IF OLD."retiredAt" IS NOT NULL AND NEW."retiredAt" IS DISTINCT FROM OLD."retiredAt" THEN
        RAISE EXCEPTION 'AgentCredential retiredAt is immutable once set'
            USING ERRCODE = '23514';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "agent_credentials_immutable_material"
BEFORE UPDATE ON "agent_credentials"
FOR EACH ROW
EXECUTE FUNCTION "enforce_agent_credential_immutability"();