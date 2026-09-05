import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  authenticateAgentApiToken,
  createAgentApiCredentialMaterial,
  extractAgentApiKeyId,
  hashAgentApiToken,
  verifyAgentApiToken,
} from '../src/lib/agent-auth-core.mjs';

const prisma = new PrismaClient();

before(async () => {
  await prisma.$connect();
});

after(async () => {
  await prisma.$disconnect();
});

function unique(label) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createFixture(label) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `M1 Auth Org ${suffix}`, type: 'supplier' },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `M1 Auth Agent ${suffix}` },
  });
  return { organization, principal, agent };
}

async function issueApiCredential(agentId, overrides = {}) {
  const material = createAgentApiCredentialMaterial();
  const credential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: agentId,
      kind: 'api',
      keyId: material.keyId,
      prefix: material.prefix,
      secretHash: material.secretHash,
      ...overrides,
    },
  });
  return { material, credential };
}

test('M1 auth: generated API token uses a public key locator and persists only a one-way hash', () => {
  const material = createAgentApiCredentialMaterial();

  assert.match(
    material.rawToken,
    /^iwantu_ac_agk_[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/,
  );
  assert.equal(extractAgentApiKeyId(material.rawToken), material.keyId);
  assert.equal(hashAgentApiToken(material.rawToken), material.secretHash);
  assert.equal(verifyAgentApiToken(material.rawToken, material.secretHash), true);
  assert.equal(
    verifyAgentApiToken(`${material.rawToken}x`, material.secretHash),
    false,
  );
  assert.notEqual(material.secretHash, material.rawToken);
  assert.equal(material.prefix.includes('.'), false);
});

test('M1 auth: active API credential resolves AgentIdentity and Principal without authority fields', async () => {
  const fixture = await createFixture('success');
  const { material, credential } = await issueApiCredential(fixture.agent.id);

  const result = await authenticateAgentApiToken(prisma, material.rawToken);
  assert.equal(result.ok, true);
  if (!result.ok) return;

  assert.equal(result.credential.id, credential.id);
  assert.equal(result.agent.id, fixture.agent.id);
  assert.equal(result.principal.id, fixture.principal.id);

  for (const forbidden of [
    'scopes',
    'permissions',
    'mandate',
    'economicLimits',
    'authority',
  ]) {
    assert.equal(forbidden in result, false);
    assert.equal(forbidden in result.credential, false);
  }
});

test('M1 auth: token tampering and unknown credentials fail closed', async () => {
  const fixture = await createFixture('tamper');
  const { material } = await issueApiCredential(fixture.agent.id);

  const finalChar = material.rawToken.at(-1);
  const tampered = `${material.rawToken.slice(0, -1)}${finalChar === 'A' ? 'B' : 'A'}`;
  const tamperedResult = await authenticateAgentApiToken(prisma, tampered);
  assert.equal(tamperedResult.ok, false);
  assert.equal(tamperedResult.reason, 'invalid_credential');

  const unknown = createAgentApiCredentialMaterial();
  const unknownResult = await authenticateAgentApiToken(prisma, unknown.rawToken);
  assert.equal(unknownResult.ok, false);
  assert.equal(unknownResult.reason, 'invalid_credential');

  const malformedResult = await authenticateAgentApiToken(prisma, 'iwantu_bad');
  assert.deepEqual(malformedResult, { ok: false, reason: 'malformed' });
});

test('M1 auth: credential validity and revocation kill switches block authentication', async () => {
  const fixture = await createFixture('credential-state');
  const now = new Date();

  const expired = await issueApiCredential(fixture.agent.id, {
    validFrom: new Date(now.getTime() - 120_000),
    expiresAt: new Date(now.getTime() - 60_000),
  });
  const expiredResult = await authenticateAgentApiToken(
    prisma,
    expired.material.rawToken,
    now,
  );
  assert.deepEqual(expiredResult, { ok: false, reason: 'credential_expired' });

  const future = await issueApiCredential(fixture.agent.id, {
    validFrom: new Date(now.getTime() + 60_000),
  });
  const futureResult = await authenticateAgentApiToken(
    prisma,
    future.material.rawToken,
    now,
  );
  assert.deepEqual(futureResult, {
    ok: false,
    reason: 'credential_not_yet_valid',
  });

  const revoked = await issueApiCredential(fixture.agent.id);
  await prisma.agentCredential.update({
    where: { id: revoked.credential.id },
    data: { status: 'revoked', revokedAt: now },
  });
  const revokedResult = await authenticateAgentApiToken(
    prisma,
    revoked.material.rawToken,
    now,
  );
  assert.deepEqual(revokedResult, {
    ok: false,
    reason: 'credential_inactive',
  });
});

test('M1 auth: Agent suspend and Principal suspend independently block new authenticated requests', async () => {
  const agentFixture = await createFixture('agent-suspend');
  const agentCredential = await issueApiCredential(agentFixture.agent.id);
  await prisma.agentIdentity.update({
    where: { id: agentFixture.agent.id },
    data: { status: 'suspended', suspendedAt: new Date() },
  });

  const agentResult = await authenticateAgentApiToken(
    prisma,
    agentCredential.material.rawToken,
  );
  assert.deepEqual(agentResult, { ok: false, reason: 'agent_inactive' });

  const principalFixture = await createFixture('principal-suspend');
  const principalCredential = await issueApiCredential(principalFixture.agent.id);
  await prisma.principal.update({
    where: { id: principalFixture.principal.id },
    data: { status: 'suspended', suspendedAt: new Date() },
  });

  const principalResult = await authenticateAgentApiToken(
    prisma,
    principalCredential.material.rawToken,
  );
  assert.deepEqual(principalResult, {
    ok: false,
    reason: 'principal_inactive',
  });
});