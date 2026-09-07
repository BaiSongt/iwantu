import assert from 'node:assert/strict';
import {
  createHash,
  generateKeyPairSync,
  sign as signDigest,
} from 'node:crypto';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createAgentApiCredentialMaterial } from '../src/lib/agent-auth-core.mjs';
import { sha256Evidence } from '../src/lib/authority/authority-snapshot.mjs';
import {
  buildFirmOfferHash,
  issueFirmOffer,
} from '../src/lib/offer-protocol.mjs';
import {
  FirmOfferIntegrityError,
  verifyStoredFirmOfferIntegrity,
} from '../src/lib/firm-offer-integrity.mjs';
import { createTask, openTask } from '../src/lib/task-protocol.mjs';

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
    data: { name: `M3 Integrity Org ${suffix}`, type: orgType },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `M3 Integrity Agent ${suffix}` },
  });
  return { suffix, organization, principal, agent };
}

async function createOpenTask(label) {
  const buyer = await createPrincipalAgent(`buyer-${label}`, 'buyer');
  const created = await createTask(prisma, {
    issuerPrincipalId: buyer.principal.id,
    issuerAgentIdentityId: buyer.agent.id,
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
  });
  const task = await openTask(prisma, { taskId: created.task.id });
  return { buyer, task, revision: created.revision };
}

async function createSupplier(label) {
  const supplier = await createPrincipalAgent(`supplier-${label}`, 'supplier');
  const apiMaterial = createAgentApiCredentialMaterial();
  const apiCredential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: supplier.agent.id,
      kind: 'api',
      keyId: apiMaterial.keyId,
      prefix: apiMaterial.prefix,
      secretHash: apiMaterial.secretHash,
    },
  });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signingCredential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: supplier.agent.id,
      kind: 'signing',
      keyId: `m3-integrity-signing-${supplier.suffix}`,
      publicKeyJwk: publicKey.export({ format: 'jwk' }),
      algorithm: 'EdDSA',
    },
  });
  const mandate = await prisma.mandate.create({
    data: {
      mandateFamilyId: `m3-integrity-family-${supplier.suffix}`,
      version: 1,
      issuerPrincipalId: supplier.principal.id,
      subjectAgentIdentityId: supplier.agent.id,
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
      payloadHash: sha256(`m3-integrity-mandate:${supplier.suffix}`),
      signatureAlgorithm: 'EdDSA',
      signatureKeyId: `principal-key-${supplier.suffix}`,
      signature: `principal-signature-${supplier.suffix}`,
    },
  });
  return {
    ...supplier,
    apiCredential,
    signingCredential,
    privateKey,
    mandate,
  };
}

function baseOfferInput(taskId, supplier, label) {
  return {
    taskId,
    supplierPrincipalId: supplier.principal.id,
    supplierAgentIdentityId: supplier.agent.id,
    priceAmount: '25.50000000',
    currency: 'IWC',
    deliveryCommitmentSeconds: 7200,
    validUntil: new Date(Date.now() + 3_600_000),
    termsPayload: {
      label,
      deliverables: [{ kind: 'artifact', format: 'json' }],
    },
    nonce: unique(`m3-integrity-nonce-${label}`),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: supplier.signingCredential.keyId,
  };
}

async function createSnapshotForOffer({ supplier, task, offerInput, payloadHash, action = 'offer.issue' }) {
  const commandHash = sha256(`command:${offerInput.nonce}:${payloadHash}:${action}`);
  const signature = signDigest(
    null,
    Buffer.from(commandHash, 'hex'),
    supplier.privateKey,
  ).toString('base64url');
  const resolvedAt = new Date();
  const requestEvidence = {
    action,
    capabilityId: null,
    capabilityIds: [],
    economic: {
      singleContract: '25.50000000',
      currency: 'IWC',
    },
    resourceRefs: [],
    dataRefs: [],
    rawDataAccess: false,
    counterpartyPrincipalId: task.issuerPrincipalId,
    commandHash,
    payloadHash,
    nonce: offerInput.nonce,
    signingCredentialId: supplier.signingCredential.id,
    signingKeyId: supplier.signingCredential.keyId,
    signatureAlgorithm: 'EdDSA',
  };
  const mandateChain = [{
    id: supplier.mandate.id,
    mandateFamilyId: supplier.mandate.mandateFamilyId,
    version: supplier.mandate.version,
    issuerPrincipalId: supplier.mandate.issuerPrincipalId,
    subjectAgentIdentityId: supplier.mandate.subjectAgentIdentityId,
    parentMandateId: supplier.mandate.parentMandateId,
    delegationDepth: supplier.mandate.delegationDepth,
    payloadHash: supplier.mandate.payloadHash,
  }];
  const evidence = {
    protocolVersion: 'iwantu-authority-snapshot/0.1',
    principalId: supplier.principal.id,
    agentIdentityId: supplier.agent.id,
    credentialId: supplier.apiCredential.id,
    credentialKeyId: supplier.apiCredential.keyId,
    leafMandateId: supplier.mandate.id,
    mandateChain,
    authorityChainHash: sha256Evidence(mandateChain),
    effectiveAuthority: {
      actionScopes: ['offer.issue', 'offer.revise'],
      capabilityScopes: ['*'],
      economicLimits: { singleContract: 1000, currency: 'IWC' },
    },
    requestEvidence,
    resolvedAction: action,
    resolvedCapabilityId: null,
    resolvedAt,
  };
  const snapshot = await prisma.authoritySnapshot.create({
    data: {
      ...evidence,
      evidenceHash: sha256Evidence(evidence),
    },
  });
  return { snapshot, commandHash, signature };
}

test('M3-05: stored Firm Offer integrity re-verifies canonical hash, authority evidence and historical signature', async () => {
  const task = await createOpenTask('verified');
  const supplier = await createSupplier('verified');
  const input = baseOfferInput(task.task.id, supplier, 'verified');
  const offerHash = buildFirmOfferHash({
    ...input,
    taskRevision: task.revision.revision,
    taskHash: task.revision.contentHash,
    offerRevision: 1,
  });
  const evidence = await createSnapshotForOffer({
    supplier,
    task: task.task,
    offerInput: input,
    payloadHash: offerHash,
  });
  const issued = await issueFirmOffer(prisma, {
    ...input,
    supplierAuthoritySnapshotId: evidence.snapshot.id,
    supplierSignature: evidence.signature,
  });

  const verified = await verifyStoredFirmOfferIntegrity(prisma, {
    offerId: issued.offer.id,
    revision: 1,
    offerHash: issued.revision.offerHash,
  });

  assert.equal(verified.ok, true);
  assert.equal(verified.code, 'OFFER_INTEGRITY_VERIFIED');
  assert.equal(verified.offerHash, offerHash);
  assert.equal(verified.action, 'offer.issue');
  assert.equal(verified.authoritySnapshot.id, evidence.snapshot.id);
  assert.equal(verified.signingCredential.id, supplier.signingCredential.id);
});

test('M3-05: same-supplier AuthoritySnapshot cannot be substituted for a different Firm Offer payload', async () => {
  const task = await createOpenTask('snapshot-substitution');
  const supplier = await createSupplier('snapshot-substitution');
  const input = baseOfferInput(task.task.id, supplier, 'snapshot-substitution');
  const offerHash = buildFirmOfferHash({
    ...input,
    taskRevision: task.revision.revision,
    taskHash: task.revision.contentHash,
    offerRevision: 1,
  });
  const unrelatedPayloadHash = sha256(`unrelated:${offerHash}`);
  const evidence = await createSnapshotForOffer({
    supplier,
    task: task.task,
    offerInput: input,
    payloadHash: unrelatedPayloadHash,
  });
  const issued = await issueFirmOffer(prisma, {
    ...input,
    supplierAuthoritySnapshotId: evidence.snapshot.id,
    supplierSignature: evidence.signature,
  });

  await assert.rejects(
    verifyStoredFirmOfferIntegrity(prisma, {
      offerId: issued.offer.id,
      revision: 1,
      offerHash: issued.revision.offerHash,
    }),
    (error) => {
      assert.ok(error instanceof FirmOfferIntegrityError);
      assert.equal(error.code, 'OFFER_AUTHORITY_EVIDENCE_MISMATCH');
      return true;
    },
  );
});

test('M3-05: historical signing credential may be revoked later without erasing verification evidence', async () => {
  const task = await createOpenTask('revoked-history');
  const supplier = await createSupplier('revoked-history');
  const input = baseOfferInput(task.task.id, supplier, 'revoked-history');
  const offerHash = buildFirmOfferHash({
    ...input,
    taskRevision: task.revision.revision,
    taskHash: task.revision.contentHash,
    offerRevision: 1,
  });
  const evidence = await createSnapshotForOffer({
    supplier,
    task: task.task,
    offerInput: input,
    payloadHash: offerHash,
  });
  const issued = await issueFirmOffer(prisma, {
    ...input,
    supplierAuthoritySnapshotId: evidence.snapshot.id,
    supplierSignature: evidence.signature,
  });

  await prisma.agentCredential.update({
    where: { id: supplier.signingCredential.id },
    data: { status: 'revoked', revokedAt: new Date() },
  });

  const verified = await verifyStoredFirmOfferIntegrity(prisma, {
    offerId: issued.offer.id,
    revision: 1,
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.signingCredential.id, supplier.signingCredential.id);
});
