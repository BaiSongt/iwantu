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

function hash(char) {
  return char.repeat(64);
}

async function createMandateFixture(label) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: {
      name: `M1-04 Org ${suffix}`,
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
      name: `Mandated Agent ${suffix}`,
    },
  });

  return { suffix, organization, principal, agent };
}

function mandateData(fixture, overrides = {}) {
  return {
    mandateFamilyId: `mandate-family-${fixture.suffix}`,
    version: 1,
    issuerPrincipalId: fixture.principal.id,
    subjectAgentIdentityId: fixture.agent.id,
    actionScopes: ['task.offer.submit'],
    capabilityScopes: ['urn:iwantu:capability:test'],
    economicLimits: {
      maxCommitmentPerTransaction: 100,
      maxOutstandingCommitment: 500,
      currency: 'IWC',
    },
    resourcePolicy: { allowedResourceRefs: ['resource:test'] },
    dataPolicy: { allowedDataRefs: ['asset:test'], rawDataAccess: false },
    counterpartyPolicy: { allow: ['principal:test-counterparty'] },
    validFrom: new Date(Date.now() - 1_000),
    validUntil: new Date(Date.now() + 60_000),
    delegationAllowed: false,
    maxDelegationDepth: 0,
    payloadHash: hash('a'),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: `principal-key-${fixture.suffix}`,
    signature: `detached-signature-${fixture.suffix}`,
    ...overrides,
  };
}

test('M1-04: Mandate is a signed authority object, separate from Credential and Approval', async () => {
  const schema = await readFile(
    new URL('../prisma/schema.prisma', import.meta.url),
    'utf8',
  );
  const match = schema.match(/model Mandate \{([\s\S]*?)\n\}/);
  assert.ok(match, 'Mandate model must exist');
  const model = match[1];

  assert.match(model, /issuerPrincipalId\s+String/);
  assert.match(model, /subjectAgentIdentityId\s+String/);
  assert.match(model, /actionScopes\s+String\[\]/);
  assert.match(model, /economicLimits\s+Json/);
  assert.match(model, /resourcePolicy\s+Json/);
  assert.match(model, /dataPolicy\s+Json/);
  assert.match(model, /payloadHash\s+String/);
  assert.match(model, /signatureKeyId\s+String/);
  assert.match(model, /signature\s+String/);

  for (const forbiddenField of [
    'credentialId',
    'apiKeyId',
    'approvalStatus',
    'approvedBy',
    'rawSecret',
    'privateKey',
  ]) {
    assert.doesNotMatch(
      model,
      new RegExp(`^\\s*${forbiddenField}\\s+`, 'm'),
      `Mandate must not collapse identity credential/approval into authority: ${forbiddenField}`,
    );
  }
});

test('M1-04: Mandate requires valid Principal and AgentIdentity references', async () => {
  const fixture = await createMandateFixture('fk');

  await assert.rejects(
    prisma.mandate.create({
      data: mandateData(fixture, {
        issuerPrincipalId: unique('missing-principal'),
      }),
    }),
  );

  await assert.rejects(
    prisma.mandate.create({
      data: mandateData(fixture, {
        mandateFamilyId: unique('missing-agent-family'),
        payloadHash: hash('b'),
        subjectAgentIdentityId: unique('missing-agent'),
      }),
    }),
  );
});

test('M1-04: Mandate scope, validity, hash, and delegation constraints are enforced by the database', async () => {
  const fixture = await createMandateFixture('constraints');

  await assert.rejects(
    prisma.mandate.create({
      data: mandateData(fixture, {
        mandateFamilyId: unique('empty-scope'),
        payloadHash: hash('b'),
        actionScopes: [],
      }),
    }),
  );

  await assert.rejects(
    prisma.mandate.create({
      data: mandateData(fixture, {
        mandateFamilyId: unique('bad-window'),
        payloadHash: hash('c'),
        validFrom: new Date(Date.now() + 60_000),
        validUntil: new Date(),
      }),
    }),
  );

  await assert.rejects(
    prisma.mandate.create({
      data: mandateData(fixture, {
        mandateFamilyId: unique('bad-hash'),
        payloadHash: 'not-a-sha256',
      }),
    }),
  );

  await assert.rejects(
    prisma.mandate.create({
      data: mandateData(fixture, {
        mandateFamilyId: unique('bad-depth-disabled'),
        payloadHash: hash('d'),
        delegationAllowed: false,
        maxDelegationDepth: 1,
      }),
    }),
  );

  const delegable = await prisma.mandate.create({
    data: mandateData(fixture, {
      mandateFamilyId: unique('one-hop-enabled'),
      payloadHash: hash('e'),
      delegationAllowed: true,
      maxDelegationDepth: 1,
    }),
  });
  assert.equal(delegable.maxDelegationDepth, 1);

  await assert.rejects(
    prisma.mandate.create({
      data: mandateData(fixture, {
        mandateFamilyId: unique('too-deep'),
        payloadHash: hash('f'),
        delegationAllowed: true,
        maxDelegationDepth: 2,
      }),
    }),
  );
});

test('M1-04: Mandate versioning is append-only and preserves family, issuer, and subject', async () => {
  const fixture = await createMandateFixture('versioning');
  const familyId = `family-versioning-${fixture.suffix}`;

  const v1 = await prisma.mandate.create({
    data: mandateData(fixture, {
      mandateFamilyId: familyId,
      version: 1,
      payloadHash: hash('1'),
    }),
  });

  await assert.rejects(
    prisma.mandate.create({
      data: mandateData(fixture, {
        mandateFamilyId: familyId,
        version: 2,
        payloadHash: hash('2'),
      }),
    }),
  );

  const v2 = await prisma.mandate.create({
    data: mandateData(fixture, {
      mandateFamilyId: familyId,
      version: 2,
      payloadHash: hash('2'),
      supersedesMandateId: v1.id,
      economicLimits: {
        maxCommitmentPerTransaction: 80,
        maxOutstandingCommitment: 300,
        currency: 'IWC',
      },
    }),
  });

  assert.equal(v2.supersedesMandateId, v1.id);

  const oldVersion = await prisma.mandate.findUniqueOrThrow({
    where: { id: v1.id },
  });
  assert.deepEqual(oldVersion.economicLimits, {
    maxCommitmentPerTransaction: 100,
    maxOutstandingCommitment: 500,
    currency: 'IWC',
  });

  await assert.rejects(
    prisma.mandate.create({
      data: mandateData(fixture, {
        mandateFamilyId: familyId,
        version: 3,
        payloadHash: hash('3'),
        supersedesMandateId: v1.id,
      }),
    }),
  );

  const otherFixture = await createMandateFixture('other-subject');
  await assert.rejects(
    prisma.mandate.create({
      data: mandateData(otherFixture, {
        mandateFamilyId: familyId,
        version: 3,
        payloadHash: hash('4'),
        supersedesMandateId: v2.id,
        issuerPrincipalId: fixture.principal.id,
      }),
    }),
  );
});

test('M1-04: signed Mandate payload cannot be updated or physically deleted', async () => {
  const fixture = await createMandateFixture('immutable');
  const mandate = await prisma.mandate.create({
    data: mandateData(fixture, {
      mandateFamilyId: unique('immutable-family'),
      payloadHash: hash('5'),
    }),
  });

  await assert.rejects(
    prisma.mandate.update({
      where: { id: mandate.id },
      data: { actionScopes: ['task.offer.accept'] },
    }),
  );

  await assert.rejects(
    prisma.mandate.update({
      where: { id: mandate.id },
      data: { signature: 'replacement-signature' },
    }),
  );

  await assert.rejects(
    prisma.mandate.delete({ where: { id: mandate.id } }),
  );

  const historical = await prisma.mandate.findUniqueOrThrow({
    where: { id: mandate.id },
  });
  assert.equal(historical.signature, mandate.signature);
  assert.deepEqual(historical.actionScopes, ['task.offer.submit']);
});

test('M1-04: revocation is a separate signed append-only fact and only the issuer Principal can revoke', async () => {
  const fixture = await createMandateFixture('revocation');
  const otherFixture = await createMandateFixture('wrong-revoker');
  const mandate = await prisma.mandate.create({
    data: mandateData(fixture, {
      mandateFamilyId: unique('revocation-family'),
      payloadHash: hash('6'),
    }),
  });

  await assert.rejects(
    prisma.mandateRevocation.create({
      data: {
        mandateId: mandate.id,
        revokedByPrincipalId: otherFixture.principal.id,
        reasonCode: 'wrong-issuer',
        payloadHash: hash('7'),
        signatureAlgorithm: 'EdDSA',
        signatureKeyId: 'wrong-key',
        signature: 'wrong-signature',
      },
    }),
  );

  const revocation = await prisma.mandateRevocation.create({
    data: {
      mandateId: mandate.id,
      revokedByPrincipalId: fixture.principal.id,
      reasonCode: 'principal-request',
      reason: 'test revocation',
      payloadHash: hash('8'),
      signatureAlgorithm: 'EdDSA',
      signatureKeyId: `principal-key-${fixture.suffix}`,
      signature: `revocation-signature-${fixture.suffix}`,
    },
  });

  assert.equal(revocation.mandateId, mandate.id);

  await assert.rejects(
    prisma.mandateRevocation.create({
      data: {
        mandateId: mandate.id,
        revokedByPrincipalId: fixture.principal.id,
        reasonCode: 'duplicate',
        payloadHash: hash('9'),
        signatureAlgorithm: 'EdDSA',
        signatureKeyId: `principal-key-${fixture.suffix}`,
        signature: 'duplicate-signature',
      },
    }),
  );

  await assert.rejects(
    prisma.mandateRevocation.update({
      where: { id: revocation.id },
      data: { reasonCode: 'changed' },
    }),
  );

  await assert.rejects(
    prisma.mandateRevocation.delete({ where: { id: revocation.id } }),
  );

  const historicalMandate = await prisma.mandate.findUniqueOrThrow({
    where: { id: mandate.id },
    include: { revocation: true },
  });
  assert.equal(historicalMandate.revocation?.id, revocation.id);
});

test('M1-04: expiration is derived from the immutable validity window; historical Mandate remains resolvable', async () => {
  const fixture = await createMandateFixture('expired');
  const validFrom = new Date(Date.now() - 120_000);
  const validUntil = new Date(Date.now() - 60_000);
  const mandate = await prisma.mandate.create({
    data: mandateData(fixture, {
      mandateFamilyId: unique('expired-family'),
      payloadHash: hash('0'),
      validFrom,
      validUntil,
    }),
  });

  const historical = await prisma.mandate.findUniqueOrThrow({
    where: { id: mandate.id },
  });
  assert.ok(historical.validUntil);
  assert.ok(historical.validUntil.getTime() < Date.now());
  assert.equal(historical.id, mandate.id);
});
