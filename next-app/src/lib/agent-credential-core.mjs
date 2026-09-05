import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const AGENT_API_CREDENTIAL_TOKEN_PREFIX = 'iwantu_v2_';
const KEY_ID_PATTERN = /^agk_[a-f0-9]{24}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

export function hashAgentApiCredential(rawKey) {
  return createHash('sha256').update(rawKey, 'utf8').digest('hex');
}

export function createAgentApiCredentialMaterial() {
  const keyId = `agk_${randomBytes(12).toString('hex')}`;
  const secret = randomBytes(32).toString('base64url');
  const rawKey = `${AGENT_API_CREDENTIAL_TOKEN_PREFIX}${keyId}.${secret}`;

  return {
    rawKey,
    keyId,
    prefix: `${AGENT_API_CREDENTIAL_TOKEN_PREFIX}${keyId}`,
    secretHash: hashAgentApiCredential(rawKey),
  };
}

export function extractAgentCredentialKeyId(rawKey) {
  if (
    typeof rawKey !== 'string' ||
    !rawKey.startsWith(AGENT_API_CREDENTIAL_TOKEN_PREFIX)
  ) {
    return null;
  }

  const tokenBody = rawKey.slice(AGENT_API_CREDENTIAL_TOKEN_PREFIX.length);
  const separatorIndex = tokenBody.indexOf('.');
  if (separatorIndex <= 0) return null;

  const keyId = tokenBody.slice(0, separatorIndex);
  const secret = tokenBody.slice(separatorIndex + 1);
  if (!KEY_ID_PATTERN.test(keyId) || !SECRET_PATTERN.test(secret)) return null;

  return keyId;
}

export function verifyAgentApiCredential(rawKey, expectedHash) {
  if (
    typeof expectedHash !== 'string' ||
    !SHA256_HEX_PATTERN.test(expectedHash)
  ) {
    return false;
  }

  const actual = Buffer.from(hashAgentApiCredential(rawKey), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}