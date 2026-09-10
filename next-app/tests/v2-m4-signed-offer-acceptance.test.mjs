import assert from 'node:assert/strict';
import {
  createHash,
  generateKeyPairSync,
  sign as signDigest,
} from 'node:crypto';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createAgentApiCredentialMaterial } from '../src/lib/agent-auth-core.mjs';
import { createV2AgentAuthenticationContext } from '../src/lib/agent-auth-context-core.mjs';
import { formAuthorizedContract } from '../src/lib/contract-formation.mjs';
import { awardProtocolIncentive } from '../src/lib/ledger/incentive-awards.mjs';
import { buildFirmOfferHash } from '../src/lib/offer-protocol.mjs';
import {
  buildEconomicCommandEvidence,
  hashEconomicCommandEvidence,
  issueSignedFirmOffer,
} from '../src/lib/signed-economic-command.mjs';
import {
  acceptSignedFirmOffer,
  buildOfferAcceptanceEvidence,
  hashOfferAcceptanceEvidence,
} from '../src/lib/signed-offer-acceptance.mjs';
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

async function createActor(label, orgType, actionScopes) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `Acceptance Org ${suffix}`, type: orgType },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `Acceptance Agent ${suffix}` },
  });
  const apiMaterial = createAgentApiCredentialMaterial();
  const apiCredential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: agent.id,
      kind: 'api',
      keyId: apiMaterial.keyId,
      prefix: apiMaterial.prefix,
      secretHash: apiMaterial.secretHash,
    },
  });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signingKeyId = `acceptance-signing-${suffix}`;
  await prisma.agentCredential.create({
    data: {
      agentIdentityId: agent.id,
      kind: 'signing',
      keyId: signingKeyId,
      publicKeyJwk: publicKey.export({ format: 'jwk' }),
      algorithm: 'EdDSA',
    },
  });
  const mandatePayloadHash = sha256(`acceptance-mandate:${suffix}`);
  const mandate = await prisma.mandate.create({
    data: {
      mandateFamilyId: `acceptance-family-${suffix}`,
      version: 1,
      issuerPrincipalId: principal.id,
      subjectAgentIdentityId: agent.id,
      actionScopes,
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
      signatureKeyId: `principal-key-${suffix}`,
      signature: `principal-signature-${suffix}`,
    },
  });
  const authentication = createV2AgentAuthenticationContext({
    principal: { id: principal.id, type: 'organization', status: 'active' },
    agent: { id: agent.id, name: agent.name, status: 'active' },
    credential: { id: apiCredential.id, keyId: apiCredential.keyId, kind: 'api', status: 'active' },
  });
  return { suffix, organization, principal, agent, apiCredential, signingKeyId, privateKey, mandate, authentication };
}

async function createMarketFixture(label) {
  const buyer = await createActor(`buyer-${label}`, 'buyer', ['offer.accept']);
  const supplier = await createActor(`supplier-${label}`, 'supplier', ['offer.issue']);
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
    capabilityRequirements: [],
  });
  await openTask(prisma, { taskId: created.task.id });

  const now = new Date();
  const unsignedOffer = {
    taskId: created.task.id,
    priceAmount: '25.50000000',
    currency: 'IWC',
    deliveryCommitmentSeconds: 3600,
    validUntil: new Date(now.getTime() + 60 * 60_000),
    termsPayload: { label, deliverables: [{ kind: 'artifact', format: 'json' }] },
    nonce: unique(`offer-${label}`),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: supplier.signingKeyId,
    mandateId: supplier.mandate.id,
    commandIssuedAt: new Date(now.getTime() - 1000),
    commandExpiresAt: new Date(now.getTime() + 5 * 60_000),
  };
  const offerHash = buildFirmOfferHash({
    ...unsignedOffer,
    supplierPrincipalId: supplier.principal.id,
    supplierAgentIdentityId: supplier.agent.id,
    taskRevision: created.revision.revision,
    taskHash: created.revision.contentHash,
    offerRevision: 1,
  }, now);
  const offerCommand = buildEconomicCommandEvidence({
    action: 'offer.issue',
    principalId: supplier.principal.id,
    agentIdentityId: supplier.agent.id,
    mandateId: supplier.mandate.id,
    payloadHash: offerHash,
    nonce: unsignedOffer.nonce,
    issuedAt: unsignedOffer.commandIssuedAt,
    expiresAt: unsignedOffer.commandExpiresAt,
    signingKeyId: supplier.signingKeyId,
    signatureAlgorithm: 'EdDSA',
  });
  const offerCommandHash = hashEconomicCommandEvidence(offerCommand);
  const issued = await issueSignedFirmOffer(
    prisma,
    supplier.authentication,
    {
      ...unsignedOffer,
      supplierSignature: signDigest(null, Buffer.from(offerCommandHash, 'hex'), supplier.privateKey).toString('base64url'),
    },
    { now },
  );

  await awardProtocolIncentive(prisma, {
    principalId: buyer.principal.id,
    programId: unique('acceptance-test-program'),
    awardId: unique('acceptance-test-award'),
    amount: '100.00000000',
  });

  return { buyer, supplier, task: created.task, taskRevision: created.revision, issued };
}

function signAcceptance(fixture, now = new Date(), overrides = {}) {
  const formationIdempotencyKey = unique('formation');
  const nonce = unique('acceptance');
  const base = {
    formationIdempotencyKey,
    offerId: fixture.issued.offer.id,
    offerRevision: fixture.issued.revision.revision,
    offerHash: fixture.issued.revision.offerHash,
    nonce,
    mandateId: fixture.buyer.mandate.id,
    commandIssuedAt: new Date(now.getTime() - 1000),
    commandExpiresAt: new Date(now.getTime() + 5 * 60_000),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: fixture.buyer.signingKeyId,
    ...overrides,
  };
  const acceptanceEvidence = buildOfferAcceptanceEvidence({
    formationIdempotencyKey: base.formationIdempotencyKey,
    taskId: fixture.task.id,
    taskRevision: fixture.taskRevision.revision,
    taskHash: fixture.taskRevision.contentHash,
    offerId: base.offerId,
    offerRevision: base.offerRevision,
    offerHash: base.offerHash,
    buyerPrincipalId: fixture.buyer.principal.id,
    buyerAgentIdentityId: fixture.buyer.agent.id,
    supplierPrincipalId: fixture.supplier.principal.id,
    priceAmount: String(fixture.issued.revision.priceAmount),
    currency: fixture.issued.revision.currency,
    nonce: base.nonce,
  });
  const acceptanceHash = hashOfferAcceptanceEvidence(acceptanceEvidence);
  const commandEvidence = buildEconomicCommandEvidence({
    action: 'offer.accept',
    principalId: fixture.buyer.principal.id,
    agentIdentityId: fixture.buyer.agent.id,
    mandateId: base.mandateId,
    payloadHash: acceptanceHash,
    nonce: base.nonce,
    issuedAt: base.commandIssuedAt,
    expiresAt: base.commandExpiresAt,
    signingKeyId: base.signatureKeyId,
    signatureAlgorithm: base.signatureAlgorithm,
  });
  const commandHash = hashEconomicCommandEvidence(commandEvidence);
  return {
    input: {
      ...base,
      buyerSignature: signDigest(null, Buffer.from(commandHash, 'hex'), fixture.buyer.privateKey).toString('base64url'),
    },
    acceptanceHash,
    commandHash,
  };
}

test('M4-02: signed Buyer acceptance forms exactly one active Contract and immutable receipt', async () => {
  const fixture = await createMarketFixture('signed-acceptance');
  const now = new Date();
  const signed = signAcceptance(fixture, now);
  const result = await acceptSignedFirmOffer(prisma, fixture.buyer.authentication, signed.input, { now });

  assert.equal(result.contract.lifecycleState, 'active');
  assert.equal(result.escrow.status, 'locked');
  assert.equal(result.acceptanceHash, signed.acceptanceHash);
  assert.equal(result.commandHash, signed.commandHash);
  assert.equal(result.acceptanceReceipt.offerHash, fixture.issued.revision.offerHash);
  assert.equal(result.buyerAuthoritySnapshot.resolvedAction, 'offer.accept');
  assert.equal(result.buyerAuthoritySnapshot.requestEvidence.payloadHash, signed.acceptanceHash);
  assert.equal(result.buyerAuthoritySnapshot.requestEvidence.commandHash, signed.commandHash);

  const task = await prisma.task.findUnique({ where: { id: fixture.task.id } });
  const offer = await prisma.offer.findUnique({ where: { id: fixture.issued.offer.id } });
  assert.equal(task.status, 'awarded');
  assert.equal(offer.status, 'accepted');

  const receipts = await prisma.$queryRaw`
    SELECT * FROM "offer_acceptance_receipts" WHERE "id" = ${result.acceptanceReceipt.id}
  `;
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].receiptHash, result.acceptanceReceipt.receiptHash);

  const replay = await acceptSignedFirmOffer(prisma, fixture.buyer.authentication, signed.input, { now });
  assert.equal(replay.contract.id, result.contract.id);
  assert.equal(replay.idempotent, true);

  await assert.rejects(
    prisma.$executeRaw`UPDATE "offer_acceptance_receipts" SET "signingKeyId" = 'tampered' WHERE "id" = ${result.acceptanceReceipt.id}`,
  );
  await assert.rejects(
    prisma.$executeRaw`DELETE FROM "offer_acceptance_receipts" WHERE "id" = ${result.acceptanceReceipt.id}`,
  );
});

test('M4-02: tampered Buyer signature fails closed before Contract or Escrow creation', async () => {
  const fixture = await createMarketFixture('tampered-acceptance');
  const signed = signAcceptance(fixture);
  signed.input.buyerSignature = Buffer.from('forged-signature').toString('base64url');

  await assert.rejects(
    acceptSignedFirmOffer(prisma, fixture.buyer.authentication, signed.input),
    (error) => {
      assert.equal(error.code, 'ECONOMIC_SIGNATURE_INVALID');
      return true;
    },
  );
  const contracts = await prisma.$queryRaw`
    SELECT "id" FROM "contracts" WHERE "taskId" = ${fixture.task.id}
  `;
  const receipts = await prisma.$queryRaw`
    SELECT "id" FROM "offer_acceptance_receipts" WHERE "offerId" = ${fixture.issued.offer.id}
  `;
  assert.equal(contracts.length, 0);
  assert.equal(receipts.length, 0);
  assert.equal((await prisma.task.findUnique({ where: { id: fixture.task.id } })).status, 'open');
  assert.equal((await prisma.offer.findUnique({ where: { id: fixture.issued.offer.id } })).status, 'active');
});

test('M4-02: database gate rejects unsigned direct Contract Formation even with forged offer.accept snapshot', async () => {
  const fixture = await createMarketFixture('unsigned-bypass');
  const fakeAcceptanceHash = sha256(unique('fake-acceptance'));
  const fakeCommandHash = sha256(unique('fake-command'));
  const snapshot = await prisma.authoritySnapshot.create({
    data: {
      principalId: fixture.buyer.principal.id,
      agentIdentityId: fixture.buyer.agent.id,
      credentialId: fixture.buyer.apiCredential.id,
      credentialKeyId: fixture.buyer.apiCredential.keyId,
      leafMandateId: fixture.buyer.mandate.id,
      mandateChain: [{ id: fixture.buyer.mandate.id, version: 1, payloadHash: fixture.buyer.mandate.payloadHash }],
      authorityChainHash: sha256(unique('fake-chain')),
      effectiveAuthority: { actionScopes: ['offer.accept'], capabilityScopes: ['*'], economicLimits: { singleContract: 1000, currency: 'IWC' } },
      requestEvidence: { action: 'offer.accept', payloadHash: fakeAcceptanceHash, commandHash: fakeCommandHash },
      resolvedAction: 'offer.accept',
      resolvedAt: new Date(),
      evidenceHash: sha256(unique('fake-snapshot')),
    },
  });

  await assert.rejects(
    formAuthorizedContract(prisma, {
      formationIdempotencyKey: unique('unsigned-formation'),
      offerId: fixture.issued.offer.id,
      offerRevision: fixture.issued.revision.revision,
      offerHash: fixture.issued.revision.offerHash,
      buyerAcceptanceHash: fakeAcceptanceHash,
      buyerAuthoritySnapshotId: snapshot.id,
    }),
    /CONTRACT_SIGNED_BUYER_ACCEPTANCE_REQUIRED/,
  );

  const contracts = await prisma.$queryRaw`
    SELECT "id" FROM "contracts" WHERE "taskId" = ${fixture.task.id}
  `;
  assert.equal(contracts.length, 0);
  assert.equal((await prisma.task.findUnique({ where: { id: fixture.task.id } })).status, 'open');
  assert.equal((await prisma.offer.findUnique({ where: { id: fixture.issued.offer.id } })).status, 'active');
});
