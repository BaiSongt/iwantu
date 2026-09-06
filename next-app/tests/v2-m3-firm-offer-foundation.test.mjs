import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createAgentApiCredentialMaterial } from '../src/lib/agent-auth-core.mjs';
import {
  OfferProtocolError,
  buildFirmOfferHash,
  issueFirmOffer,
  loadCurrentFirmOfferSnapshot,
  loadOfferRevisionSnapshot,
  reviseFirmOffer,
} from '../src/lib/offer-protocol.mjs';
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
    data: { name: `Offer Org ${suffix}`, type: orgType },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `Offer Agent ${suffix}` },
  });
  return { suffix, organization, principal, agent };
}

async function createSupplierFixture(label) {
  const fixture = await createPrincipalAgent(label, 'supplier');
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
  const mandatePayloadHash = sha256(`mandate:${fixture.suffix}`);
  const mandate = await prisma.mandate.create({
    data: {
      mandateFamilyId: `offer-family-${fixture.suffix}`,
      version: 1,
      issuerPrincipalId: fixture.principal.id,
      subjectAgentIdentityId: fixture.agent.id,
      actionScopes: ['offer.issue', 'offer.revise'],
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
      authorityChainHash: sha256(`authority-chain:${fixture.suffix}`),
      effectiveAuthority: {
        actionScopes: ['offer.issue', 'offer.revise'],
        capabilityScopes: ['*'],
      },
      requestEvidence: { action: 'offer.issue' },
      resolvedAction: 'offer.issue',
      resolvedAt: new Date(),
      evidenceHash: sha256(`authority-snapshot:${fixture.suffix}`),
    },
  });
  return { ...fixture, material, credential, mandate, authoritySnapshot };
}

function taskRevisionInput(label) {
  return {
    protocolPayload: {
      objective: `Produce ${label}`,
      inputs: [{ kind: 'asset_ref', ref: `asset:${label}` }],
      expectedOutputs: [{ kind: 'artifact', schema: `urn:test:${label}:output` }],
    },
    workPayload: { constraints: { deterministic: true } },
    marketPayload: { budget: { currency: 'IWC', maxAmount: '500.00000000' } },
    trustPayload: { requiredReputation: { mode: 'insufficient_evidence_allowed' } },
    policyPayload: { acceptancePolicy: { mode: 'REQUESTER_ACCEPTANCE' } },
    capabilityRequirements: [{ capabilityId: `urn:test:${label}:capability` }],
  };
}

async function createOpenTask(label) {
  const buyer = await createPrincipalAgent(`buyer-${label}`, 'buyer');
  const created = await createTask(prisma, {
    issuerPrincipalId: buyer.principal.id,
    issuerAgentIdentityId: buyer.agent.id,
    ...taskRevisionInput(`${label}-v1`),
  });
  const opened = await openTask(prisma, { taskId: created.task.id });
  return { buyer, task: opened, revision: created.revision };
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
    termsPayload: {
      deliverables: [{ kind: 'artifact', format: 'json' }],
      serviceLevel: { retries: 1 },
    },
    nonce: unique(`nonce-${label}`),
    supplierAuthoritySnapshotId: supplier.authoritySnapshot.id,
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: `signing-key-${supplier.suffix}`,
    supplierSignature: `signature-${label}-${supplier.suffix}`,
    ...overrides,
  };
}

test('M3-02: Firm Offer domain is separate from legacy Proposal and contains no human approval semantics', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const offerModel = schema.match(/model Offer \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const revisionModel = schema.match(/model OfferRevision \{([\s\S]*?)\n\}/)?.[1] ?? '';

  assert.match(schema, /model Proposal \{/);
  assert.match(schema, /model Offer \{/);
  assert.match(schema, /model OfferRevision \{/);
  assert.match(offerModel, /supplierPrincipalId/);
  assert.match(offerModel, /supplierAgentIdentityId/);
  assert.match(revisionModel, /taskRevisionId/);
  assert.match(revisionModel, /taskHash/);
  assert.match(revisionModel, /validUntil/);
  assert.match(revisionModel, /nonce/);
  assert.match(revisionModel, /supplierAuthoritySnapshotId/);
  assert.match(revisionModel, /supplierSignature/);
  assert.doesNotMatch(offerModel, /approval|userId|supplierOrgId/i);
  assert.doesNotMatch(revisionModel, /approval|userId|supplierOrgId/i);
});

test('M3-02: issueFirmOffer creates an ACTIVE immutable commitment bound to the exact current Task snapshot', async () => {
  const task = await createOpenTask('issue');
  const supplier = await createSupplierFixture('issue');
  const input = offerInput(task.task.id, supplier, 'issue');
  const issued = await issueFirmOffer(prisma, input);

  assert.equal(issued.offer.status, 'active');
  assert.equal(issued.offer.currentRevision, 1);
  assert.equal(issued.revision.revision, 1);
  assert.equal(issued.revision.taskRevisionId, task.revision.id);
  assert.equal(issued.revision.taskHash, task.revision.contentHash);
  assert.equal(issued.revision.currency, 'IWC');
  assert.equal(issued.revision.priceAmount.toString(), '25.5');
  assert.equal(issued.revision.supplierAuthoritySnapshotId, supplier.authoritySnapshot.id);

  const expectedHash = buildFirmOfferHash({
    ...input,
    taskRevision: 1,
    taskHash: task.revision.contentHash,
    offerRevision: 1,
  });
  assert.equal(issued.revision.offerHash, expectedHash);
});

test('M3-02: canonical Firm Offer hash ignores JSON object key order', async () => {
  const task = await createOpenTask('canonical');
  const supplier = await createSupplierFixture('canonical');
  const validUntil = new Date(Date.now() + 3_600_000);
  const base = {
    taskId: task.task.id,
    taskRevision: 1,
    taskHash: task.revision.contentHash,
    offerRevision: 1,
    supplierPrincipalId: supplier.principal.id,
    supplierAgentIdentityId: supplier.agent.id,
    priceAmount: '10',
    currency: 'IWC',
    deliveryCommitmentSeconds: 300,
    validUntil,
    nonce: unique('canonical-nonce'),
    supplierAuthoritySnapshotId: supplier.authoritySnapshot.id,
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: 'signing-key-canonical',
    supplierSignature: 'signature-canonical',
  };
  const first = buildFirmOfferHash({
    ...base,
    termsPayload: { a: 1, nested: { x: true, y: 2 } },
  });
  const second = buildFirmOfferHash({
    ...base,
    termsPayload: { nested: { y: 2, x: true }, a: 1 },
  });
  assert.equal(first, second);
});

test('M3-02: only OPEN Tasks may receive a Firm Offer', async () => {
  const buyer = await createPrincipalAgent('draft-task', 'buyer');
  const created = await createTask(prisma, {
    issuerPrincipalId: buyer.principal.id,
    issuerAgentIdentityId: buyer.agent.id,
    ...taskRevisionInput('draft-task'),
  });
  const supplier = await createSupplierFixture('draft-task');

  await assert.rejects(
    issueFirmOffer(prisma, offerInput(created.task.id, supplier, 'draft-task')),
    (error) => {
      assert.ok(error instanceof OfferProtocolError);
      assert.equal(error.code, 'TASK_NOT_OPEN');
      return true;
    },
  );
});

test('M3-02: Supplier Agent and AuthoritySnapshot must belong to the same Supplier Principal', async () => {
  const task = await createOpenTask('supplier-evidence');
  const left = await createSupplierFixture('supplier-left');
  const right = await createSupplierFixture('supplier-right');

  await assert.rejects(
    issueFirmOffer(prisma, offerInput(task.task.id, left, 'snapshot-mismatch', {
      supplierAuthoritySnapshotId: right.authoritySnapshot.id,
    })),
    (error) => {
      assert.ok(error instanceof OfferProtocolError);
      assert.equal(error.code, 'OFFER_AUTHORITY_SNAPSHOT_MISMATCH');
      return true;
    },
  );

  await assert.rejects(
    issueFirmOffer(prisma, {
      ...offerInput(task.task.id, left, 'agent-mismatch'),
      supplierAgentIdentityId: right.agent.id,
    }),
    (error) => {
      assert.ok(error instanceof OfferProtocolError);
      assert.equal(error.code, 'OFFER_SUPPLIER_OWNERSHIP_MISMATCH');
      return true;
    },
  );
});

test('M3-02: one Supplier Principal has exactly one Offer chain per Task', async () => {
  const task = await createOpenTask('one-chain');
  const supplier = await createSupplierFixture('one-chain');
  await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'one-chain-a'));

  await assert.rejects(
    issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'one-chain-b')),
    (error) => {
      assert.ok(error instanceof OfferProtocolError);
      assert.equal(error.code, 'OFFER_CHAIN_EXISTS');
      return true;
    },
  );
});

test('M3-02: OfferRevision is append-only immutable evidence', async () => {
  const task = await createOpenTask('immutable');
  const supplier = await createSupplierFixture('immutable');
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'immutable'));

  await assert.rejects(
    prisma.offerRevision.update({
      where: { id: issued.revision.id },
      data: { priceAmount: '1' },
    }),
  );
  await assert.rejects(
    prisma.offerRevision.delete({ where: { id: issued.revision.id } }),
  );
  await assert.rejects(
    prisma.offer.update({
      where: { id: issued.offer.id },
      data: { supplierPrincipalId: task.buyer.principal.id },
    }),
  );
});

test('M3-02: revising an OPEN Task preserves old Offer evidence and a new OfferRevision rebinds the new Task snapshot', async () => {
  const task = await createOpenTask('task-revision');
  const supplier = await createSupplierFixture('task-revision');
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'task-revision-v1'));

  const taskV2 = await reviseTask(prisma, {
    taskId: task.task.id,
    ...taskRevisionInput('task-revision-v2'),
  });
  const revisedOffer = await reviseFirmOffer(prisma, offerInput(task.task.id, supplier, 'task-revision-v2', {
    offerId: issued.offer.id,
    priceAmount: '30',
  }));

  const oldOfferRevision = await loadOfferRevisionSnapshot(prisma, {
    offerId: issued.offer.id,
    revision: 1,
  });
  assert.equal(oldOfferRevision.taskRevisionId, task.revision.id);
  assert.equal(oldOfferRevision.taskHash, task.revision.contentHash);
  assert.equal(revisedOffer.revision.taskRevisionId, taskV2.revision.id);
  assert.equal(revisedOffer.revision.taskHash, taskV2.revision.contentHash);
  assert.equal(revisedOffer.offer.currentRevision, 2);
});

test('M3-02: concurrent Firm Offer revisions serialize into one contiguous immutable revision chain', async () => {
  const task = await createOpenTask('concurrent');
  const supplier = await createSupplierFixture('concurrent');
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'concurrent-v1'));

  const results = await Promise.all([
    reviseFirmOffer(prisma, offerInput(task.task.id, supplier, 'concurrent-v2a', {
      offerId: issued.offer.id,
      priceAmount: '26',
    })),
    reviseFirmOffer(prisma, offerInput(task.task.id, supplier, 'concurrent-v2b', {
      offerId: issued.offer.id,
      priceAmount: '27',
    })),
  ]);

  assert.deepEqual(results.map((result) => result.revision.revision).sort(), [2, 3]);
  const current = await loadCurrentFirmOfferSnapshot(prisma, { offerId: issued.offer.id });
  const revisions = await prisma.offerRevision.findMany({
    where: { offerId: issued.offer.id },
    orderBy: { revision: 'asc' },
  });
  assert.equal(current.offer.currentRevision, 3);
  assert.equal(current.revision.revision, 3);
  assert.deepEqual(revisions.map((revision) => revision.revision), [1, 2, 3]);
});

test('M3-02: finite TTL and nonce replay protection fail closed', async () => {
  const task = await createOpenTask('ttl');
  const supplier = await createSupplierFixture('ttl');
  const expiredInput = offerInput(task.task.id, supplier, 'expired', {
    validUntil: new Date(Date.now() - 1000),
  });

  await assert.rejects(
    issueFirmOffer(prisma, expiredInput),
    (error) => {
      assert.ok(error instanceof OfferProtocolError);
      assert.equal(error.code, 'OFFER_EXPIRED');
      return true;
    },
  );

  const nonce = unique('shared-nonce');
  await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'nonce-first', { nonce }));
  const otherTask = await createOpenTask('nonce-other-task');
  const otherSupplier = await createSupplierFixture('nonce-other-supplier');
  await assert.rejects(
    issueFirmOffer(prisma, offerInput(otherTask.task.id, otherSupplier, 'nonce-second', { nonce })),
    (error) => {
      assert.ok(error instanceof OfferProtocolError);
      assert.equal(error.code, 'OFFER_UNIQUE_CONFLICT');
      return true;
    },
  );
});

test('M3-02: database rejects an Offer committed without its contiguous revision chain', async () => {
  const task = await createOpenTask('deferred-guard');
  const supplier = await createSupplierFixture('deferred-guard');

  await assert.rejects(
    prisma.offer.create({
      data: {
        taskId: task.task.id,
        supplierPrincipalId: supplier.principal.id,
        supplierAgentIdentityId: supplier.agent.id,
      },
    }),
  );
});

test('M3-02: database independently rejects Task hash and supplier snapshot binding mismatch', async () => {
  const task = await createOpenTask('db-binding');
  const supplier = await createSupplierFixture('db-binding');
  const otherSupplier = await createSupplierFixture('db-binding-other');
  const issued = await issueFirmOffer(prisma, offerInput(task.task.id, supplier, 'db-binding-v1'));

  await assert.rejects(
    prisma.offerRevision.create({
      data: {
        offerId: issued.offer.id,
        revision: 2,
        taskRevisionId: task.revision.id,
        taskHash: sha256('wrong-task-hash'),
        priceAmount: '20',
        currency: 'IWC',
        validUntil: new Date(Date.now() + 3_600_000),
        termsPayload: {},
        termsHash: sha256('{}'),
        nonce: unique('db-binding-wrong-hash'),
        offerHash: sha256(unique('db-binding-wrong-hash-offer')),
        supplierAuthoritySnapshotId: supplier.authoritySnapshot.id,
        signatureAlgorithm: 'EdDSA',
        signatureKeyId: 'key',
        supplierSignature: 'signature',
      },
    }),
  );

  await assert.rejects(
    prisma.offerRevision.create({
      data: {
        offerId: issued.offer.id,
        revision: 2,
        taskRevisionId: task.revision.id,
        taskHash: task.revision.contentHash,
        priceAmount: '20',
        currency: 'IWC',
        validUntil: new Date(Date.now() + 3_600_000),
        termsPayload: {},
        termsHash: sha256('{}'),
        nonce: unique('db-binding-wrong-snapshot'),
        offerHash: sha256(unique('db-binding-wrong-snapshot-offer')),
        supplierAuthoritySnapshotId: otherSupplier.authoritySnapshot.id,
        signatureAlgorithm: 'EdDSA',
        signatureKeyId: 'key',
        supplierSignature: 'signature',
      },
    }),
  );
});
