import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const V2_AGENT_API_TOKEN_PREFIX = 'iwantu_ac_';
const KEY_ID_PATTERN = /^agk_[a-f0-9]{24}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const HASH_PATTERN = /^sha256\$([a-f0-9]{64})$/;

export function hashAgentApiToken(rawToken) {
  const digest = createHash('sha256').update(rawToken, 'utf8').digest('hex');
  return `sha256$${digest}`;
}

export function createAgentApiCredentialMaterial() {
  const keyId = `agk_${randomBytes(12).toString('hex')}`;
  const secret = randomBytes(32).toString('base64url');
  const prefix = `${V2_AGENT_API_TOKEN_PREFIX}${keyId}`;
  const rawToken = `${prefix}.${secret}`;

  return {
    rawToken,
    keyId,
    prefix,
    secretHash: hashAgentApiToken(rawToken),
  };
}

export function extractAgentApiKeyId(rawToken) {
  if (
    typeof rawToken !== 'string' ||
    !rawToken.startsWith(V2_AGENT_API_TOKEN_PREFIX)
  ) {
    return null;
  }

  const body = rawToken.slice(V2_AGENT_API_TOKEN_PREFIX.length);
  const separator = body.indexOf('.');
  if (separator <= 0) return null;

  const keyId = body.slice(0, separator);
  const secret = body.slice(separator + 1);
  if (!KEY_ID_PATTERN.test(keyId) || !SECRET_PATTERN.test(secret)) return null;

  return keyId;
}

export function verifyAgentApiToken(rawToken, expectedHash) {
  if (typeof expectedHash !== 'string') return false;
  const match = expectedHash.match(HASH_PATTERN);
  if (!match) return false;

  const actual = Buffer.from(
    hashAgentApiToken(rawToken).slice('sha256$'.length),
    'hex',
  );
  const expected = Buffer.from(match[1], 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/**
 * Resolve an API credential to Principal + AgentIdentity.
 *
 * This function authenticates identity only. It intentionally returns no
 * permissions/scopes/mandate authority. Economic authorization is a separate
 * pipeline and must be resolved after authentication.
 */
export async function authenticateAgentApiToken(
  prisma,
  rawToken,
  now = new Date(),
) {
  const keyId = extractAgentApiKeyId(rawToken);
  if (!keyId) return { ok: false, reason: 'malformed' };

  const credential = await prisma.agentCredential.findUnique({
    where: { keyId },
    include: {
      agentIdentity: {
        include: { principal: true },
      },
    },
  });

  if (
    !credential ||
    credential.kind !== 'api' ||
    !credential.secretHash ||
    !verifyAgentApiToken(rawToken, credential.secretHash)
  ) {
    return { ok: false, reason: 'invalid_credential' };
  }

  if (credential.status !== 'active') {
    return { ok: false, reason: 'credential_inactive' };
  }
  if (credential.validFrom > now) {
    return { ok: false, reason: 'credential_not_yet_valid' };
  }
  if (credential.expiresAt && credential.expiresAt <= now) {
    return { ok: false, reason: 'credential_expired' };
  }

  const agent = credential.agentIdentity;
  if (agent.status !== 'active') {
    return { ok: false, reason: 'agent_inactive' };
  }

  const principal = agent.principal;
  if (principal.status !== 'active') {
    return { ok: false, reason: 'principal_inactive' };
  }

  // Authentication success must not fail only because telemetry cannot update.
  prisma.agentCredential
    .update({
      where: { id: credential.id },
      data: { lastUsedAt: now },
    })
    .catch(() => {
      // Best-effort usage telemetry only.
    });

  return {
    ok: true,
    principal: {
      id: principal.id,
      type: principal.type,
      status: principal.status,
    },
    agent: {
      id: agent.id,
      name: agent.name,
      status: agent.status,
    },
    credential: {
      id: credential.id,
      keyId: credential.keyId,
      kind: credential.kind,
      status: credential.status,
    },
  };
}