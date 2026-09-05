import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';

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
      name: `M1-03 Org ${suffix}`,
      type: 'supplier',
    },
  });
  const principal = await prisma.principal.create({
    data: {
      type: 'organization',
      organizationId: organization.id,
    },
  });
  const agent = await prisma.agentIdentity.create({
    data: {
      principalId: principal.id,
      name: `Credential Agent ${suffix}`,
    },
  });
  return { suffix, organization, principal, agent };
}

function signingJwk(suffix) {
  return {
    kty: 'OKP',
    crv: 'Ed25519',
    x: `test-public-key-${suffix}`,
  };
}

test('M1-03: AgentCredential schema contains verification material but no authority or raw-secret fields', async () => {
  const schema = await readFile(
    new URL('../prisma/schema.prisma', import.meta.url),
    'utf8',
  );
  const match = schema.match(/model AgentCredential \{([\s\S]*?)\n\}/);
  assert.ok(match, 'AgentCredential model must exist');
  const model = match[1];

  assert.match(model, /agentIdentityId\s+String/);
  assert.match(model, /secretHash\s+String\?/);
  assert.match(model, /publicKeyJwk\s+Json\?/);
  assert.match(model, /keyId\s+String\s+@unique/);

  for (const forbiddenField of [
    'secret',
    'rawSecret',
    'privateKey',
    'scopes',
    'permissions',
    'mandateId',
    'economicLimit',
  ]) {
    assert.doesNotMatch(
      model,
      new RegExp(`^\\s*${forbiddenField}\\s+`, 'm'),
      `Credential must not contain authority/raw-secret field ${forbiddenField}`,
    );
  }
});

test('M1-03: AgentCredential requires an existing AgentIdentity', async () => {
  await assert.rejects(
    prisma.agentCredential.create({
      data: {
        agentIdentityId: unique('missing-agent'),
        kind: 'api',
        keyId: unique('key'),
        prefix: 'iwantu_ac_test',
        secretHash: 'scrypt$test-only-hash',
      },
    }),
  );
});

test('M1-03: API credentials accept hashed verification material only and keyId is globally unique', async () => {
  const fixture = await createAgentFixture('api');
  const keyId = unique('api-key');
  const credential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: fixture.agent.id,
      kind: 'api',
      keyId,
      prefix: `iwantu_ac_${fixture.suffix.slice(0, 12)}`,
      secretHash: 'scrypt$16384$8$1$fixture-salt$fixture-digest',
    },
  });

  assert.equal(credential.kind, 'api');
  assert.ok(credential.secretHash);
  assert.equal(credential.publicKeyJwk, null);

  await assert.rejects(
    prisma.agentCredential.create({
      data: {
        agentIdentityId: fixture.agent.id,
        kind: 'api',
        keyId: unique('api-no-hash'),
        prefix: 'iwantu_ac_missing_hash',
      },
    }),
  );

  await assert.rejects(
    prisma.agentCredential.create({
      data: {
        agentIdentityId: fixture.agent.id,
        kind: 'api',
        keyId: unique('api-public-key'),
        secretHash: 'scrypt$fixture',
        publicKeyJwk: signingJwk(fixture.suffix),
      },
    }),
  );

  await assert.rejects(
    prisma.agentCredential.create({
      data: {
        agentIdentityId: fixture.agent.id,
        kind: 'api',
        keyId,
        secretHash: 'scrypt$another-hash',
      },
    }),
  );
});

test('M1-03: signing credentials store public verification material, never a private/shared secret', async () => {
  const fixture = await createAgentFixture('signing');
  const publicKeyJwk = signingJwk(fixture.suffix);
  const credential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: fixture.agent.id,
      kind: 'signing',
      keyId: unique('signing-key'),
      publicKeyJwk,
      algorithm: 'EdDSA',
    },
  });

  assert.equal(credential.secretHash, null);
  assert.deepEqual(credential.publicKeyJwk, publicKeyJwk);
  assert.equal(credential.algorithm, 'EdDSA');

  await assert.rejects(
    prisma.agentCredential.create({
      data: {
        agentIdentityId: fixture.agent.id,
        kind: 'signing',
        keyId: unique('signing-mixed-material'),
        secretHash: 'must-not-be-accepted',
        publicKeyJwk,
        algorithm: 'EdDSA',
      },
    }),
  );

  await prisma.agentIdentity.update({
    where: { id: fixture.agent.id },
    data: { status: 'suspended', suspendedAt: new Date() },
  });

  const historical = await prisma.agentCredential.findUniqueOrThrow({
    where: { id: credential.id },
  });
  assert.deepEqual(historical.publicKeyJwk, publicKeyJwk);
});

test('M1-03: credential rotation/lifecycle is append-only and terminal credentials cannot reactivate', async () => {
  const fixture = await createAgentFixture('lifecycle');
  const credential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: fixture.agent.id,
      kind: 'signing',
      keyId: unique('lifecycle-key'),
      publicKeyJwk: signingJwk(fixture.suffix),
      algorithm: 'EdDSA',
    },
  });

  const revokedAt = new Date();
  await prisma.agentCredential.update({
    where: { id: credential.id },
    data: { status: 'revoked', revokedAt },
  });

  await assert.rejects(
    prisma.agentCredential.update({
      where: { id: credential.id },
      data: { keyId: unique('mutated-key-id') },
    }),
  );

  await assert.rejects(
    prisma.agentCredential.update({
      where: { id: credential.id },
      data: { status: 'active', revokedAt: null },
    }),
  );

  await assert.rejects(
    prisma.agentCredential.delete({ where: { id: credential.id } }),
  );

  const historical = await prisma.agentCredential.findUniqueOrThrow({
    where: { id: credential.id },
  });
  assert.equal(historical.status, 'revoked');
  assert.ok(historical.publicKeyJwk);
  assert.ok(historical.revokedAt);
});

test('M1-03: validity windows are coherent and OAUTH/A2A credentials can use external-provider metadata', async () => {
  const fixture = await createAgentFixture('validity');
  const now = new Date();
  const past = new Date(now.getTime() - 60_000);

  await assert.rejects(
    prisma.agentCredential.create({
      data: {
        agentIdentityId: fixture.agent.id,
        kind: 'api',
        keyId: unique('invalid-window'),
        secretHash: 'scrypt$fixture',
        validFrom: now,
        expiresAt: past,
      },
    }),
  );

  const oauth = await prisma.agentCredential.create({
    data: {
      agentIdentityId: fixture.agent.id,
      kind: 'oauth_a2a',
      keyId: unique('oauth-a2a'),
      metadata: {
        issuer: 'https://issuer.example.test',
        audience: 'iwantu',
      },
    },
  });

  assert.equal(oauth.kind, 'oauth_a2a');
  assert.equal(oauth.secretHash, null);
  assert.equal(oauth.publicKeyJwk, null);
  assert.deepEqual(oauth.metadata, {
    issuer: 'https://issuer.example.test',
    audience: 'iwantu',
  });
});
