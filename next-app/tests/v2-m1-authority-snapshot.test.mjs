import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  authenticateAgentApiToken,
  createAgentApiCredentialMaterial,
} from '../src/lib/agent-auth-core.mjs';
import {
  bindAuthorityToAuthentication,
  createV2AgentAuthenticationContext,
} from '../src/lib/agent-auth-context-core.mjs';
import { resolveAuthority } from '../src/lib/authority/authority.mjs';
import {
  buildAuthoritySnapshot,
  captureAuthoritySnapshot,
  sha256Evidence,
} from '../src/lib/authority/authority-snapshot.mjs';

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

let hashIndex = 0;
function nextHash() {
  const chars = '0123456789abcdef';
  const pair = `${chars[hashIndex % 16]}${chars[(hashIndex + 9) % 16]}`;
  hashIndex += 1;
  return pair.repeat(32);
}

async function createFixture(label) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `Snapshot Org ${suffix}`, type: 'supplier' },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `Snapshot Agent ${suffix}` },
  });
  const material = createAgentApiCredentialMaterial();
  const credential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: agent.id,
      kind: 'api',
      keyId: material.keyId,
      prefix: material.prefix,
      secretHash: material.secretHash,
    },
  });
  const mandate = await prisma.mandate.create({
    data: {
      mandateFamilyId: `snapshot-family-${suffix}`,
      version: 1,
      issuerPrincipalId: principal.id,
      subjectAgentIdentityId: agent.id,
      actionScopes: ['offer.*', 'contract.form'],
      capabilityScopes: ['urn:iwantu:capability:manufacturing.cam.*'],
      economicLimits: { singleContract: 500, daily: 2000, currency: 'IWC' },
      resourcePolicy: { allowedResourceRefs: ['resource:cad'] },
      dataPolicy: { allowedDataRefs: ['asset:part'], rawDataAccess: false },
      counterpartyPolicy: { allow: ['principal:vendor-1'] },
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 3_600_000),
      delegationAllowed: false,
      maxDelegationDepth: 0,
      payloadHash: nextHash(),
      signatureAlgorithm: 'EdDSA',
      signatureKeyId: `principal-key-${suffix}`,
      signature: `principal-signature-${suffix}`,
    },
  });

  return { suffix, organization, principal, agent, material, credential, mandate };
}

const authorityRequest = {
  action: 'contract.form',
  capabilityId: 'urn:iwantu:capability:manufacturing.cam.toolpath.generate',
  economic: { singleContract: 100, currency: 'IWC' },
  resourceRefs: ['resource:cad'],
  dataRefs: ['asset:part'],
  rawDataAccess: false,
  counterpartyPrincipalId: 'principal:vendor-1',
};

async function resolveBoundContext(fixture) {
  const rawAuth = await authenticateAgentApiToken(prisma, fixture.material.rawToken);
  assert.equal(rawAuth.ok, true);
  if (!rawAuth.ok) throw new Error('fixture authentication failed');
  const authentication = createV2AgentAuthenticationContext(rawAuth);
  const authority = await resolveAuthority(prisma, {
    mandateId: fixture.mandate.id,
    subjectAgentIdentityId: fixture.agent.id,
    ...authorityRequest,
  });
  return bindAuthorityToAuthentication(authentication, authority);
}

test('M1-07: AuthoritySnapshot schema is evidence-only and contains no raw credential/private-key material', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const source = await readFile(
    new URL('../src/lib/authority/authority-snapshot.mjs', import.meta.url),
    'utf8',
  );
  const model = schema.match(/model AuthoritySnapshot \{([\s\S]*?)\n\}/)?.[1] ?? '';

  assert.match(model, /principalId/);
  assert.match(model, /agentIdentityId/);
  assert.match(model, /credentialKeyId/);
  assert.match(model, /mandateChain/);
  assert.match(model, /authorityChainHash/);
  assert.match(model, /effectiveAuthority/);
  assert.match(model, /requestEvidence/);
  assert.match(model, /evidenceHash/);
  assert.doesNotMatch(model, /secretHash|rawSecret|privateKey|apiKey/);
  assert.doesNotMatch(source, /authorizeFromSnapshot|resolveAuthorityFromSnapshot/);
});

test('M1-07: snapshot hashes are deterministic over canonical authority evidence', async () => {
  const fixture = await createFixture('deterministic');
  const bound = await resolveBoundContext(fixture);
  const resolvedAt = new Date('2026-09-05T09:00:00.000Z');
  const first = buildAuthoritySnapshot(bound, authorityRequest, resolvedAt);
  const second = buildAuthoritySnapshot(bound, authorityRequest, resolvedAt);

  assert.equal(first.evidenceHash, second.evidenceHash);
  assert.equal(first.authorityChainHash, second.authorityChainHash);
  assert.equal(first.authorityChainHash, sha256Evidence(first.mandateChain));
  assert.equal(first.leafMandateId, fixture.mandate.id);
  assert.deepEqual(first.requestEvidence.economic, { singleContract: 100, currency: 'IWC' });
});

test('M1-07: capture persists Principal, Agent, Credential, Mandate chain and effective authority evidence', async () => {
  const fixture = await createFixture('capture');
  const bound = await resolveBoundContext(fixture);
  const snapshot = await captureAuthoritySnapshot(
    prisma,
    bound,
    authorityRequest,
    new Date(),
  );

  assert.equal(snapshot.principalId, fixture.principal.id);
  assert.equal(snapshot.agentIdentityId, fixture.agent.id);
  assert.equal(snapshot.credentialId, fixture.credential.id);
  assert.equal(snapshot.credentialKeyId, fixture.credential.keyId);
  assert.equal(snapshot.leafMandateId, fixture.mandate.id);
  assert.equal(snapshot.resolvedAction, 'contract.form');
  assert.equal(snapshot.resolvedCapabilityId, authorityRequest.capabilityId);
  assert.deepEqual(snapshot.mandateChain, [
    {
      id: fixture.mandate.id,
      version: fixture.mandate.version,
      payloadHash: fixture.mandate.payloadHash,
    },
  ]);
});

test('M1-07: database rejects credential/Agent/Principal/Mandate evidence mismatch', async () => {
  const fixture = await createFixture('mismatch-a');
  const other = await createFixture('mismatch-b');
  const bound = await resolveBoundContext(fixture);
  const candidate = buildAuthoritySnapshot(bound, authorityRequest, new Date());

  await assert.rejects(
    prisma.authoritySnapshot.create({
      data: {
        ...candidate,
        credentialId: other.credential.id,
        evidenceHash: nextHash(),
      },
    }),
  );

  await assert.rejects(
    prisma.authoritySnapshot.create({
      data: {
        ...candidate,
        leafMandateId: other.mandate.id,
        evidenceHash: nextHash(),
      },
    }),
  );
});

test('M1-07: AuthoritySnapshot is append-only and cannot be edited or deleted', async () => {
  const fixture = await createFixture('immutable');
  const bound = await resolveBoundContext(fixture);
  const snapshot = await captureAuthoritySnapshot(prisma, bound, authorityRequest);

  await assert.rejects(
    prisma.authoritySnapshot.update({
      where: { id: snapshot.id },
      data: { resolvedAction: 'offer.accept' },
    }),
  );

  await assert.rejects(
    prisma.authoritySnapshot.delete({ where: { id: snapshot.id } }),
  );

  const persisted = await prisma.authoritySnapshot.findUnique({
    where: { id: snapshot.id },
  });
  assert.equal(persisted?.evidenceHash, snapshot.evidenceHash);
  assert.equal(persisted?.resolvedAction, 'contract.form');
});

test('M1-07: later Credential/Mandate revocation preserves historical snapshot evidence but does not create new authority', async () => {
  const fixture = await createFixture('history');
  const bound = await resolveBoundContext(fixture);
  const snapshot = await captureAuthoritySnapshot(prisma, bound, authorityRequest);
  const revokedAt = new Date();

  await prisma.agentCredential.update({
    where: { id: fixture.credential.id },
    data: { status: 'revoked', revokedAt },
  });
  await prisma.mandateRevocation.create({
    data: {
      mandateId: fixture.mandate.id,
      revokedByPrincipalId: fixture.principal.id,
      reasonCode: 'snapshot-history-test',
      payloadHash: nextHash(),
      signatureAlgorithm: 'EdDSA',
      signatureKeyId: `principal-key-${fixture.suffix}`,
      signature: `revocation-signature-${fixture.suffix}`,
      revokedAt,
    },
  });

  const historical = await prisma.authoritySnapshot.findUnique({
    where: { id: snapshot.id },
  });
  assert.equal(historical?.evidenceHash, snapshot.evidenceHash);

  const authAfterRevocation = await authenticateAgentApiToken(
    prisma,
    fixture.material.rawToken,
    new Date(revokedAt.getTime() + 1),
  );
  assert.deepEqual(authAfterRevocation, { ok: false, reason: 'credential_inactive' });
});
