import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createAgentApiCredentialMaterial } from '../src/lib/agent-auth-core.mjs';
import {
  OfferProtocolError,
  issueFirmOffer,
  reviseFirmOffer,
} from '../src/lib/offer-protocol.mjs';
import {
  cancelTask,
  closeTask,
  evaluateFirmOfferAcceptability,
  withdrawFirmOffer,
} from '../src/lib/task-offer-lifecycle.mjs';
import { createTask, openTask, reviseTask } from '../src/lib/task-protocol.mjs';

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

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function createPrincipalAgent(label, orgType) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `Lifecycle Org ${suffix}`, type: orgType },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `Lifecycle Agent ${suffix}` },
  });
  return { suffix, organization, principal, agent };
}

async function createSupplierFixture(label, capabilityIds = []) {
  const fixture = await createPrincipalAgent(label, 'supplier');
  const version = await prisma.agentVersion.create({
    data: {
      agentIdentityId: fixture.agent.id,
      version: `1.0.${Math.floor(Math.random() * 100000)}`,
      softwareVersion: 'm3-test',
    },
  });
  if (capabilityIds.length > 0) {
    await prisma.agentCapabilityClaim.createMany({
      data: capabilityIds.map((capabilityId) => ({
        agentVersionId: version.id,
        capabilityId,
        claimStatus: 'declared',
      })),
    });
  }

  const material = createAgentApiCredentialMaterial();
  const credential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: fixture.agent.id,
      kind: 'api',
      keyId: material.keyId,
      prefix: material.prefix,
      secretHash: material.secretHash,
    },
  });
  const mandatePayloadHash = sha256(`m3-03-mandate:${fixture.suffix}`);
  const mandate = await prisma.mandate.create({
    data: {
      mandateFamilyId: `m3-03-family-${fixture.suffix}`,
      version: 1,
      issuerPrincipalId: fixture.principal.id,
      subjectAgentIdentityId: fixture.agent.id,
      actionScopes: ['offer.issue', 'offer.revise', 'offer.withdraw'],
      capabilityScopes: ['*'],
      economicLimits: { singleContract: 1000, currency: 'IWC' },
      resourcePolicy: {},
      dataPolicy: { rawDataAccess: false },
      counterpartyPolicy: {},
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 86_400_000),
      delegationAllowed: false,
      maxDelegationDepth: 0,
      payloadHash: mandatePayloadHash,
      signatureAlgorithm: 'EdDSA',
      signatureKeyId: `principal-key-${fixture.suffix}`,
      signature: `principal-signature-${fixture.suffix}`,
    },
  });
  const authoritySnapshot = await prisma.authoritySnapshot.create({
    data: {
      principalId: fixture.principal.id,
      agentIdentityId: fixture.agent.id,
      credentialId: credential.id,
      credentialKeyId: credential.keyId,
      leafMandateId: mandate.id,
      mandateChain: [{ id: mandate.id, version: 1, payloadHash: mandatePayloadHash }],
      authorityChainHash: sha256(`m3-03-chain:${fixture.suffix}`),
      effectiveAuthority: { actionScopes: ['offer.*'], capabilityScopes: ['*'] },
      requestEvidence: { action: 'offer.issue' },
      resolvedAction: 'offer.issue',
      resolvedAt: new Date(),
      evidenceHash: sha256(`m3-03-snapshot:${fixture.suffix}`),
    },
  });

  return { ...fixture, version, material, credential, mandate, authoritySnapshot };
}

function taskRevisionInput(label, capabilityIds) {
  return {
    protocolPayload: {
      objective: `Produce ${label}`,
      inputs: [{ kind: 'asset_ref', ref: `asset:${label}` }],
      expectedOutputs: [{ kind: 'artifact', schema: `urn:test:${label}:output` }],
    },
    workPayload: { constraints: { deterministic: true, label } },
    marketPayload: { budget: { currency: 'IWC', maxAmount: '500.00000000' } },
    trustPayload: { requiredReputation: { mode: 'insufficient_evidence_allowed' } },
    policyPayload: { acceptancePolicy: { mode: 'REQUESTER_ACCEPTANCE' } },
    capabilityRequirements: capabilityIds.map((capabilityId) => ({ capabilityId })),
  };
}

async function createOpenTask(label, capabilityIds) {
  const buyer = await createPrincipalAgent(`buyer-${label}`, 'buyer');
  const created = await createTask(prisma, {
    issuerPrincipalId: buyer.principal.id,
    issuerAgentIdentityId: buyer.agent.id,
    ...taskRevisionInput(`${label}-v1`, capabilityIds),
  });
  const task = await openTask(prisma, { taskId: created.task.id });
  return { buyer, task, revision: created.revision };
}

function offerInput(taskId, supplier, label, overrides = {}) {
  return {
    taskId,
    supplierPrincipalId: supplier.principal.id,
    supplierAgentIdentityId: supplier.agent.id,
    priceAmount: '25.5',
    currency: 'IWC',
    deliveryCommitmentSeconds: 7200,
    validUntil: new Date(Date.now() + 3_600_000),
    termsPayload: { deliverables: [{ kind: 'artifact' }], label },
    nonce: unique(`m3-03-nonce-${label}`),
    supplierAuthoritySnapshotId: supplier.authoritySnapshot.id,
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: `signing-key-${supplier.suffix}`,
    supplierSignature: `signature-${label}-${supplier.suffix}`,
    ...overrides,
  };
}

function acceptabilityInput(issued) {
  return {
    offerId: issued.offer.id,
    revision: issued.revision.revision,
    offerHash: issued.revision.offerHash,
  };
}

test('M3-03: staleness is derived and no mutable isStale protocol field is introduced', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const source = await readFile(new URL('../src/lib/task-offer-lifecycle.mjs', import.meta.url), 'utf8');
  const offerModel = schema.match(/model Offer \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const revisionModel = schema.match(/model OfferRevision \{([\s\S]*?)\n\}/)?.[1] ?? '';

  assert.doesNotMatch(offerModel, /isStale|staleAt/);
  assert.doesNotMatch(revisionModel, /isStale|staleAt/);
  assert.match(source, /TASK_REVISION_MISMATCH/);
  assert.match(source, /offerRevision\.taskRevisionId !== currentTaskRevision\.id/);
});

test('M3-03: exact current Firm Offer is acceptable when one live AgentVersion satisfies all Task capabilities', async () => {
  const capabilityId = `urn:test:${unique('eligible')}:capability`;
  const task = await createOpenTask('eligible', [capabilityId]);
  const supplier = await createSupplierFixture('eligible', [capabilityId]);
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'eligible'));

  const result = await evaluateFirmOfferAcceptability(prisma, acceptabilityInput(issued));
  assert.equal(result.ok, true);
  assert.equal(result.code, 'OFFER_ACCEPTABLE');
  assert.equal(result.matchingAgentVersionId, supplier.version.id);
  assert.equal(result.taskHash, task.revision.contentHash);
});

test('M3-03: revising Task makes the old Firm Offer stale until supplier rebinds a new OfferRevision', async () => {
  const capabilityId = `urn:test:${unique('stale')}:capability`;
  const task = await createOpenTask('stale', [capabilityId]);
  const supplier = await createSupplierFixture('stale', [capabilityId]);
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'stale-v1'));

  await reviseTask(prisma, {
    taskId: task.task.id,
    ...taskRevisionInput('stale-v2', [capabilityId]),
  });
  const stale = await evaluateFirmOfferAcceptability(prisma, acceptabilityInput(issued));
  assert.equal(stale.ok, false);
  assert.equal(stale.code, 'TASK_REVISION_MISMATCH');

  const rebound = await reviseFirmOffer(prisma, {
    ...offerInput(task.task.id, supplier, 'stale-v2'),
    offerId: issued.offer.id,
    priceAmount: '27',
  });
  const acceptable = await evaluateFirmOfferAcceptability(prisma, acceptabilityInput(rebound));
  assert.equal(acceptable.ok, true);
});

test('M3-03: superseded Offer revision and mismatched Offer hash fail closed', async () => {
  const capabilityId = `urn:test:${unique('superseded')}:capability`;
  const task = await createOpenTask('superseded', [capabilityId]);
  const supplier = await createSupplierFixture('superseded', [capabilityId]);
  const first = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'superseded-v1'));
  const second = await reviseFirmOffer(prisma, {
    ...offerInput(task.task.id, supplier, 'superseded-v2'),
    offerId: first.offer.id,
    priceAmount: '26',
  });

  const old = await evaluateFirmOfferAcceptability(prisma, acceptabilityInput(first));
  assert.equal(old.ok, false);
  assert.equal(old.code, 'OFFER_SUPERSEDED');

  const forged = await evaluateFirmOfferAcceptability(prisma, {
    ...acceptabilityInput(second),
    offerHash: sha256('forged-offer-hash'),
  });
  assert.equal(forged.ok, false);
  assert.equal(forged.code, 'OFFER_REVISION_MISMATCH');
});

test('M3-03: TTL is evaluated at acceptance time without mutating Offer status', async () => {
  const capabilityId = `urn:test:${unique('ttl')}:capability`;
  const task = await createOpenTask('ttl', [capabilityId]);
  const supplier = await createSupplierFixture('ttl', [capabilityId]);
  const baseNow = new Date('2026-09-06T06:00:00.000Z');
  const validUntil = new Date('2026-09-06T06:10:00.000Z');
  const issued = await issueFirmOffer(
    prisma,
    offerInput(task.task.id, supplier, 'ttl', { validUntil }),
    { now: baseNow },
  );

  const expired = await evaluateFirmOfferAcceptability(
    prisma,
    acceptabilityInput(issued),
    { now: new Date('2026-09-06T06:10:00.000Z') },
  );
  assert.equal(expired.ok, false);
  assert.equal(expired.code, 'OFFER_EXPIRED');
  const persisted = await prisma.offer.findUnique({ where: { id: issued.offer.id } });
  assert.equal(persisted?.status, 'active');
});

test('M3-03: Supplier withdrawal is terminal, idempotent and makes the Offer ineligible', async () => {
  const capabilityId = `urn:test:${unique('withdraw')}:capability`;
  const task = await createOpenTask('withdraw', [capabilityId]);
  const supplier = await createSupplierFixture('withdraw', [capabilityId]);
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'withdraw'));

  const withdrawn = await withdrawFirmOffer(prisma, { offerId: issued.offer.id });
  assert.equal(withdrawn.status, 'withdrawn');
  const again = await withdrawFirmOffer(prisma, { offerId: issued.offer.id });
  assert.equal(again.status, 'withdrawn');

  const result = await evaluateFirmOfferAcceptability(prisma, acceptabilityInput(issued));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'OFFER_WITHDRAWN');

  await assert.rejects(
    reviseFirmOffer(prisma, {
      ...offerInput(task.task.id, supplier, 'withdraw-revise'),
      offerId: issued.offer.id,
    }),
    (error) => {
      assert.ok(error instanceof OfferProtocolError);
      assert.equal(error.code, 'OFFER_NOT_REVISIONABLE');
      return true;
    },
  );
});

test('M3-03: cancelling Task atomically closes active Offers and terminal Task cannot reopen', async () => {
  const capabilityId = `urn:test:${unique('cancel')}:capability`;
  const task = await createOpenTask('cancel', [capabilityId]);
  const supplier = await createSupplierFixture('cancel', [capabilityId]);
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'cancel'));

  const cancelled = await cancelTask(prisma, { taskId: task.task.id });
  assert.equal(cancelled.status, 'cancelled');
  assert.ok(cancelled.closedAt);
  const offer = await prisma.offer.findUnique({ where: { id: issued.offer.id } });
  assert.equal(offer?.status, 'closed');

  await assert.rejects(
    prisma.task.update({
      where: { id: task.task.id },
      data: { status: 'open', closedAt: null },
    }),
  );
});

test('M3-03: closing an unawarded OPEN Task closes every active Firm Offer', async () => {
  const capabilityId = `urn:test:${unique('close')}:capability`;
  const task = await createOpenTask('close', [capabilityId]);
  const firstSupplier = await createSupplierFixture('close-a', [capabilityId]);
  const secondSupplier = await createSupplierFixture('close-b', [capabilityId]);
  const first = await issueFirmOffer(prisma, offerInput(task.task.id, firstSupplier, 'close-a'));
  const second = await issueFirmOffer(prisma, offerInput(task.task.id, secondSupplier, 'close-b'));

  const closed = await closeTask(prisma, { taskId: task.task.id });
  assert.equal(closed.status, 'closed');
  const offers = await prisma.offer.findMany({
    where: { id: { in: [first.offer.id, second.offer.id] } },
    orderBy: { id: 'asc' },
  });
  assert.deepEqual(offers.map((offer) => offer.status), ['closed', 'closed']);
});

test('M3-03: capability eligibility is live and requires one non-retired AgentVersion to satisfy the complete requirement set', async () => {
  const capabilityA = `urn:test:${unique('cap-a')}`;
  const capabilityB = `urn:test:${unique('cap-b')}`;
  const task = await createOpenTask('capability', [capabilityA, capabilityB]);
  const supplier = await createSupplierFixture('capability', [capabilityA]);
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'capability'));

  const missing = await evaluateFirmOfferAcceptability(prisma, acceptabilityInput(issued));
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'SUPPLIER_CAPABILITY_MISMATCH');
  assert.deepEqual(missing.details.missingCapabilityIds, [capabilityB]);

  await prisma.agentCapabilityClaim.create({
    data: {
      agentVersionId: supplier.version.id,
      capabilityId: capabilityB,
      claimStatus: 'declared',
    },
  });
  const recovered = await evaluateFirmOfferAcceptability(prisma, acceptabilityInput(issued));
  assert.equal(recovered.ok, true);
  assert.equal(recovered.matchingAgentVersionId, supplier.version.id);
});

test('M3-03: suspended Supplier Principal or Agent makes an otherwise valid Firm Offer ineligible', async () => {
  const capabilityId = `urn:test:${unique('inactive')}:capability`;
  const task = await createOpenTask('inactive', [capabilityId]);
  const supplier = await createSupplierFixture('inactive', [capabilityId]);
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'inactive'));

  await prisma.principal.update({
    where: { id: supplier.principal.id },
    data: { status: 'suspended', suspendedAt: new Date() },
  });
  const inactive = await evaluateFirmOfferAcceptability(prisma, acceptabilityInput(issued));
  assert.equal(inactive.ok, false);
  assert.equal(inactive.code, 'OFFER_SUPPLIER_PRINCIPAL_INACTIVE');
});

test('M3-03: AWARDED / ACCEPTED / NOT_SELECTED cannot be entered before atomic Contract Formation exists', async () => {
  const capabilityId = `urn:test:${unique('reserved')}:capability`;
  const task = await createOpenTask('reserved', [capabilityId]);
  const supplier = await createSupplierFixture('reserved', [capabilityId]);
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'reserved'));

  await assert.rejects(
    prisma.task.update({ where: { id: task.task.id }, data: { status: 'awarded' } }),
  );
  await assert.rejects(
    prisma.offer.update({ where: { id: issued.offer.id }, data: { status: 'accepted' } }),
  );
  await assert.rejects(
    prisma.offer.update({ where: { id: issued.offer.id }, data: { status: 'not_selected' } }),
  );
});

test('M3-03: deferred database gate rejects terminal Task commit that leaves an ACTIVE Offer behind', async () => {
  const capabilityId = `urn:test:${unique('deferred')}:capability`;
  const task = await createOpenTask('deferred', [capabilityId]);
  const supplier = await createSupplierFixture('deferred', [capabilityId]);
  await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'deferred'));

  await assert.rejects(
    prisma.task.update({
      where: { id: task.task.id },
      data: { status: 'cancelled', closedAt: new Date() },
    }),
  );
  const persisted = await prisma.task.findUnique({ where: { id: task.task.id } });
  assert.equal(persisted?.status, 'open');
});

test('M3-03: Task cancellation racing Offer revision follows Task -> Offer lock order without deadlock', async () => {
  const capabilityId = `urn:test:${unique('race-cancel')}:capability`;
  const task = await createOpenTask('race-cancel', [capabilityId]);
  const supplier = await createSupplierFixture('race-cancel', [capabilityId]);
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'race-cancel-v1'));

  const results = await Promise.allSettled([
    cancelTask(prisma, { taskId: task.task.id }),
    reviseFirmOffer(prisma, {
      ...offerInput(task.task.id, supplier, 'race-cancel-v2'),
      offerId: issued.offer.id,
      priceAmount: '29',
    }),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof OfferProtocolError);
      assert.ok(['TASK_NOT_OPEN', 'OFFER_NOT_REVISIONABLE'].includes(result.reason.code));
    }
  }
  const finalTask = await prisma.task.findUnique({ where: { id: task.task.id } });
  const finalOffer = await prisma.offer.findUnique({ where: { id: issued.offer.id } });
  const revisions = await prisma.offerRevision.findMany({
    where: { offerId: issued.offer.id },
    orderBy: { revision: 'asc' },
  });
  assert.equal(finalTask?.status, 'cancelled');
  assert.equal(finalOffer?.status, 'closed');
  assert.deepEqual(
    revisions.map((revision) => revision.revision),
    Array.from({ length: finalOffer.currentRevision }, (_, index) => index + 1),
  );
});

test('M3-03: Supplier withdrawal racing Offer revision serializes on the Offer after a shared Task lock', async () => {
  const capabilityId = `urn:test:${unique('race-withdraw')}:capability`;
  const task = await createOpenTask('race-withdraw', [capabilityId]);
  const supplier = await createSupplierFixture('race-withdraw', [capabilityId]);
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'race-withdraw-v1'));

  const results = await Promise.allSettled([
    withdrawFirmOffer(prisma, { offerId: issued.offer.id }),
    reviseFirmOffer(prisma, {
      ...offerInput(task.task.id, supplier, 'race-withdraw-v2'),
      offerId: issued.offer.id,
      priceAmount: '31',
    }),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      assert.ok(result.reason instanceof OfferProtocolError);
      assert.equal(result.reason.code, 'OFFER_NOT_REVISIONABLE');
    }
  }
  const finalOffer = await prisma.offer.findUnique({ where: { id: issued.offer.id } });
  assert.equal(finalOffer?.status, 'withdrawn');
  const revisions = await prisma.offerRevision.findMany({
    where: { offerId: issued.offer.id },
    orderBy: { revision: 'asc' },
  });
  assert.deepEqual(
    revisions.map((revision) => revision.revision),
    Array.from({ length: finalOffer.currentRevision }, (_, index) => index + 1),
  );
});
