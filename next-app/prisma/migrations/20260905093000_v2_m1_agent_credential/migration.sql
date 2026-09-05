-- V2-M1 Identity & Authority Foundation (M1-03 AgentCredential)
-- Additive-only migration. Legacy ApiKey and current MCP auth remain unchanged.

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
    "metadata" JSONB,
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
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

-- CreateIndex
CREATE INDEX "agent_credentials_expiresAt_idx"
ON "agent_credentials"("expiresAt");

-- AddForeignKey
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_agentIdentityId_fkey"
FOREIGN KEY ("agentIdentityId") REFERENCES "agent_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Credential proves identity; it does not carry authority.
-- API/shared-secret credentials store only a hash. Signing credentials store
-- public verification material and never a private key. OAUTH/A2A credentials
-- may use hashed material, public-key material, or external-provider metadata.
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_material_check" CHECK (
    (
        "kind" = 'api'
        AND "secretHash" IS NOT NULL
        AND "publicKeyJwk" IS NULL
    )
    OR
    (
        "kind" = 'signing'
        AND "secretHash" IS NULL
        AND "publicKeyJwk" IS NOT NULL
        AND "algorithm" IS NOT NULL
    )
    OR
    (
        "kind" = 'oauth_a2a'
        AND (
            "secretHash" IS NOT NULL
            OR "publicKeyJwk" IS NOT NULL
            OR "metadata" IS NOT NULL
        )
    )
);

-- Lifecycle timestamps are facts, not soft-delete aliases.
ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_status_timestamp_check" CHECK (
    (
        "status" = 'active'
        AND "revokedAt" IS NULL
        AND "retiredAt" IS NULL
    )
    OR
    (
        "status" = 'revoked'
        AND "revokedAt" IS NOT NULL
        AND "retiredAt" IS NULL
    )
    OR
    (
        "status" = 'retired'
        AND "retiredAt" IS NOT NULL
        AND "revokedAt" IS NULL
    )
);

ALTER TABLE "agent_credentials" ADD CONSTRAINT "agent_credentials_validity_window_check" CHECK (
    "expiresAt" IS NULL OR "expiresAt" > "validFrom"
);

-- Rotation creates a new credential. Verification material and ownership of an
-- existing credential are immutable so historical signatures/authentication
-- evidence can be reconstructed accurately.
CREATE FUNCTION "prevent_agent_credential_material_change"()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW."agentIdentityId" IS DISTINCT FROM OLD."agentIdentityId"
       OR NEW."kind" IS DISTINCT FROM OLD."kind"
       OR NEW."keyId" IS DISTINCT FROM OLD."keyId"
       OR NEW."prefix" IS DISTINCT FROM OLD."prefix"
       OR NEW."secretHash" IS DISTINCT FROM OLD."secretHash"
       OR NEW."publicKeyJwk" IS DISTINCT FROM OLD."publicKeyJwk"
       OR NEW."algorithm" IS DISTINCT FROM OLD."algorithm"
       OR NEW."metadata" IS DISTINCT FROM OLD."metadata"
       OR NEW."validFrom" IS DISTINCT FROM OLD."validFrom"
       OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
        RAISE EXCEPTION 'AgentCredential identity and verification material are immutable; rotate by creating a new credential'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "agent_credentials_material_immutable"
BEFORE UPDATE ON "agent_credentials"
FOR EACH ROW
EXECUTE FUNCTION "prevent_agent_credential_material_change"();

-- Revoked/retired credentials are terminal historical facts and cannot be
-- silently reactivated. A replacement credential must be issued instead.
CREATE FUNCTION "prevent_agent_credential_reactivation"()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD."status" IN ('revoked', 'retired')
       AND NEW."status" IS DISTINCT FROM OLD."status" THEN
        RAISE EXCEPTION 'Revoked or retired AgentCredential cannot be reactivated or changed to another terminal state'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "agent_credentials_terminal_status"
BEFORE UPDATE OF "status" ON "agent_credentials"
FOR EACH ROW
EXECUTE FUNCTION "prevent_agent_credential_reactivation"();

-- Historical verification material is append-only. Revocation or retirement
-- changes status; it never removes the credential row/public key.
CREATE FUNCTION "prevent_agent_credential_delete"()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'AgentCredential records are historical verification facts and cannot be physically deleted'
        USING ERRCODE = '23514';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "agent_credentials_no_delete"
BEFORE DELETE ON "agent_credentials"
FOR EACH ROW
EXECUTE FUNCTION "prevent_agent_credential_delete"();
