import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  createAgentApiCredentialMaterial,
  extractAgentCredentialKeyId,
  hashAgentApiCredential,
  verifyAgentApiCredential,
} from '../src/lib/agent-credential-core.mjs';

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

async function createAgentFixture(label) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: {
      name: `M1 Credential Org ${suffix}`,
      type: 'supplier',
    },
  });
  const principal = await prisma.principal.create({
    data: {
      type: 'organization',
      organizationId: organization.id,
    },
  });
  const agentIdentity = await prisma.agentIdentity.create({
    data: {
      principalId: principal.id,
      name: `Credential Agent ${suffix}`,
    },
  });

  return { organization, principal, agentIdentity };
}

async function cleanupAgentFixture(fixture) {
  await prisma.agentCredential.deleteMany({
    where: { agentIdentityId: fixture.agentIdentity.id },
  });
  await prisma.agentVersion.deleteMany({
    where: { agentIdentityId: fixture.agentIdentity.id },
  });
  await prisma.agentIdentity.delete({ where: { id: fixture.agentIdentity.id } });
  await prisma.principal.delete({ where: { id: fixture.principal.id } });
  await prisma.organization.delete({ where: { id: fixture.organization.id } });
}

test('M1-03: generated API credential material stores a locator and hash, not the raw secret', () => {
  const material = createAgentApiCredentialMaterial();

  assert.match(material.rawKey, /^iwantu_v2_agk_[a-f0-9]{24}\.[A-Za-z0-9_-]{43}$/);
  assert.equal(extractAgentCredentialKeyId(material.rawKey), material.keyId);
  assert.equal(hashAgentApiCredential(material.rawKey), material.secretHash);
  assert.equal(verifyAgentApiCredential(material.rawKey, material.secretHash), true);
  assert.equal(
    verifyAgentApiCredential(`${material.rawKey}x`, material.secretHash),
    false,
  );
  assert.notEqual(material.secretHash, material.rawKey);
  assert.equal(material.prefix.includes('.'), false);
});

test('M1-03: API credential requires a valid AgentIdentity and persists only a secret hash', async (t) => {
  const fixture = await createAgentFixture('api');
  t.after(() => cleanupAgentFixture(fixture));
  const material = createAgentApiCredentialMaterial();

  const credential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: fixture.agentIdentity.id,
      kind: 'api',
      keyId: material.keyId,
      prefix: material.prefix,
      secretHash: material.secretHash,
      accessScopes: ['read'],
    },
  });

  assert.equal(credential.secretHash, material.secretHash);
  assert.equal(credential.publicKeyJwk, null);
  assert.equal(credential.accessScopes[0], 'read');

  await assert.rejects(
    prisma.agentCredential.create({
      data: {
        agentIdentityId: fixture.agentIdentity.id,
        kind: 'api',
        keyId: `agk_${'a'.repeat(24)}`,
      },
    }),
  );

  const invalidMaterial = createAgentApiCredentialMaterial();
  await assert.rejects(
    prisma.agentCredential.create({
      data: {
        agentIdentityId: unique('missing-agent'),
        kind: 'api',
        keyId: invalidMaterial.keyId,
        prefix: invalidMaterial.prefix,
        secretHash: invalidMaterial.secretHash,
      },
    }),
  );
});

test('M1-03: signing credential stores public verification material and rejects private/shared secret storage', async (t) => {
  const fixture = await createAgentFixture('signing');
  t.after(() => cleanupAgentFixture(fixture));

  const credential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: fixture.agentIdentity.id,
      kind: 'signing',
      keyId: `sig_${unique('public-key')}`,
      publicKeyJwk: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: 'test-public-key-material',
      },
      algorithm: 'EdDSA',
    },
  });

  assert.equal(credential.secretHash, null);
  assert.equal(credential.algorithm, 'EdDSA');

  await assert.rejects(
    prisma.agentCredential.create({
      data: {
        agentIdentityId: fixture.agentIdentity.id,
        kind: 'signing',
        keyId: `sig_${unique('missing-public')}`,
      },
    }),
  );

  await assert.rejects(
    prisma.agentCredential.create({
      data: {
        agentIdentityId: fixture.agentIdentity.id,
        kind: 'signing',
        keyId: `sig_${unique('secret-not-allowed')}`,
        secretHash: 'a'.repeat(64),
        publicKeyJwk: { kty: 'OKP', crv: 'Ed25519', x: 'public' },
      },
    }),
  );
});

test('M1-03: credential material/scopes are immutable and revocation is terminal', async (t) => {
  const fixture = await createAgentFixture('lifecycle');
  t.after(() => cleanupAgentFixture(fixture));
  const material = createAgentApiCredentialMaterial();

  const credential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: fixture.agentIdentity.id,
      kind: 'api',
      keyId: material.keyId,
      prefix: material.prefix,
      secretHash: material.secretHash,
      accessScopes: ['read'],
    },
  });

  await assert.rejects(
    prisma.agentCredential.update({
      where: { id: credential.id },
      data: { accessScopes: ['read', 'write:demand'] },
    }),
  );

  const revokedAt = new Date();
  await prisma.agentCredential.update({
    where: { id: credential.id },
    data: { status: 'revoked', revokedAt },
  });

  await assert.rejects(
    prisma.agentCredential.update({
      where: { id: credential.id },
      data: { status: 'active', revokedAt: null },
    }),
  );

  const revoked = await prisma.agentCredential.findUniqueOrThrow({
    where: { id: credential.id },
  });
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revokedAt?.getTime(), revokedAt.getTime());
});