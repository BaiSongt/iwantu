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
import { issueGenesisCredit } from '../src/lib/ledger/credit-foundation.mjs';
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
import {
  buildDeliveryEvidence,
  hashDeliveryEvidence,
  submitSignedDelivery,
} from '../src/lib/signed-delivery.mjs';
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
    data: { name: `Delivery Org ${suffix}`, type: orgType },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `Delivery Agent ${suffix}` },
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
  const signingKeyId = `delivery-signing-${suffix}`;
  await prisma.agentCredential.create({
    data: {
      agentIdentityId: agent.id,
      kind: 'signing',
      keyId: signingKeyId,
      publicKeyJwk: publicKey.export({ format: 'jwk' }),
      algorithm: 'EdDSA',
    },
  });
  const mandate = await prisma.mandate.create({
    data: {
      mandateFamilyId: `delivery-family-${suffix}`,
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
      payloadHash: sha256(`delivery-mandate:${suffix}`),
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
  return { principal, agent, apiCredential, signingKeyId, privateKey, mandate, authentication };
}

async function createActiveContract(label) {
  const buyer = await createActor(`buyer-${label}`, 'buyer', ['offer.accept']);
  const supplier = await createActor(`supplier-${label}`, 'supplier', ['offer.issue', 'delivery.submit']);
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

  await issueGenesisCredit(prisma, {
    principalId: buyer.principal.id,
    allocationVersion: unique('delivery-test-allocation'),
    amount: '100.00000000',
  });

  const formationIdempotencyKey = unique('formation');
  const acceptanceNonce = unique('acceptance');
  const acceptanceEvidence = buildOfferAcceptanceEvidence({
    formationIdempotencyKey,
    taskId: created.task.id,
    taskRevision: created.revision.revision,
    taskHash: created.revision.contentHash,
    offerId: issued.offer.id,
    offerRevision: issued.revision.revision,
    offerHash: issued.revision.offerHash,
    buyerPrincipalId: buyer.principal.id,
    buyerAgentIdentityId: buyer.agent.id,
    supplierPrincipalId: supplier.principal.id,
    priceAmount: String(issued.revision.priceAmount),
    currency: issued.revision.currency,
    nonce: acceptanceNonce,
  });
  const acceptanceHash = hashOfferAcceptanceEvidence(acceptanceEvidence);
  const acceptanceInput = {
    formationIdempotencyKey,
    offerId: issued.offer.id,
    offerRevision: issued.revision.revision,
    offerHash: issued.revision.offerHash,
    nonce: acceptanceNonce,
    mandateId: buyer.mandate.id,
    commandIssuedAt: new Date(now.getTime() - 1000),
    commandExpiresAt: new Date(now.getTime() + 5 * 60_000),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: buyer.signingKeyId,
  };
  const acceptanceCommand = buildEconomicCommandEvidence({
    action: 'offer.accept',
    principalId: buyer.principal.id,
    agentIdentityId: buyer.agent.id,
    mandateId: buyer.mandate.id,
    payloadHash: acceptanceHash,
    nonce: acceptanceNonce,
    issuedAt: acceptanceInput.commandIssuedAt,
    expiresAt: acceptanceInput.commandExpiresAt,
    signingKeyId: buyer.signingKeyId,
    signatureAlgorithm: 'EdDSA',
  });
  const acceptanceCommandHash = hashEconomicCommandEvidence(acceptanceCommand);
  const formed = await acceptSignedFirmOffer(
    prisma,
    buyer.authentication,
    {
      ...acceptanceInput,
      buyerSignature: signDigest(null, Buffer.from(acceptanceCommandHash, 'hex'), buyer.privateKey).toString('base64url'),
    },
    { now },
  );

  return { buyer, supplier, task: created.task, issued, formed };
}

function signDelivery(fixture, now = new Date(), overrides = {}) {
  const base = {
    deliveryIdempotencyKey: unique('delivery'),
    contractId: fixture.formed.contract.id,
    effectiveContractHash: fixture.formed.contract.effectiveContractHash,
    deliverables: [{
      assetRef: `artifact:${unique('output')}`,
      mediaType: 'application/json',
      contentHash: sha256(unique('delivery-content')),
    }],
    evidence: [{ kind: 'test', value: 'passed' }],
    nonce: unique('delivery-nonce'),
    mandateId: fixture.supplier.mandate.id,
    commandIssuedAt: new Date(now.getTime() - 1000),
    commandExpiresAt: new Date(now.getTime() + 5 * 60_000),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: fixture.supplier.signingKeyId,
    ...overrides,
  };
  const deliveryEvidence = buildDeliveryEvidence({
    deliveryIdempotencyKey: base.deliveryIdempotencyKey,
    contractId: base.contractId,
    effectiveContractHash: base.effectiveContractHash,
    acceptedOfferRevisionId: fixture.formed.contract.acceptedOfferRevisionId,
    sequence: 1,
    supplierPrincipalId: fixture.supplier.principal.id,
    supplierAgentIdentityId: fixture.supplier.agent.id,
    deliverables: base.deliverables,
    evidence: base.evidence,
    nonce: base.nonce,
  });
  const deliveryHash = hashDeliveryEvidence(deliveryEvidence);
  const command = buildEconomicCommandEvidence({
    action: 'delivery.submit',
    principalId: fixture.supplier.principal.id,
    agentIdentityId: fixture.supplier.agent.id,
    mandateId: base.mandateId,
    payloadHash: deliveryHash,
    nonce: base.nonce,
    issuedAt: base.commandIssuedAt,
    expiresAt: base.commandExpiresAt,
    signingKeyId: base.signatureKeyId,
    signatureAlgorithm: base.signatureAlgorithm,
  });
  const commandHash = hashEconomicCommandEvidence(command);
  return {
    input: {
      ...base,
      supplierSignature: signDigest(null, Buffer.from(commandHash, 'hex'), fixture.supplier.privateKey).toString('base64url'),
    },
    deliveryHash,
    commandHash,
  };
}

test('M5-01: signed Supplier Delivery is immutable, advances Contract and keeps Escrow locked', async () => {
  const fixture = await createActiveContract('signed-delivery');
  const now = new Date();
  const signed = signDelivery(fixture, now);
  const result = await submitSignedDelivery(prisma, fixture.supplier.authentication, signed.input, { now });

  assert.equal(result.delivery.deliveryHash, signed.deliveryHash);
  assert.equal(result.delivery.commandHash, signed.commandHash);
  assert.equal(result.delivery.sequence, 1);
  assert.equal(result.delivery.deadlineStatus, 'on_time');
  assert.equal(result.authoritySnapshot.resolvedAction, 'delivery.submit');
  assert.equal(result.authoritySnapshot.requestEvidence.payloadHash, signed.deliveryHash);
  assert.equal(result.contract.lifecycleState, 'acceptance_pending');
  assert.equal(result.escrow.status, 'locked');
  assert.equal(result.escrow.releaseLedgerTransactionId, null);
  assert.equal(result.escrow.refundLedgerTransactionId, null);

  const contractRows = await prisma.$queryRaw`SELECT "lifecycleState" FROM "contracts" WHERE "id" = ${fixture.formed.contract.id}`;
  assert.equal(contractRows[0].lifecycleState, 'acceptance_pending');

  const replay = await submitSignedDelivery(prisma, fixture.supplier.authentication, signed.input, { now });
  assert.equal(replay.delivery.id, result.delivery.id);
  assert.equal(replay.idempotent, true);

  await assert.rejects(
    prisma.$executeRaw`UPDATE "deliveries" SET "signingKeyId" = 'tampered' WHERE "id" = ${result.delivery.id}`,
    /DELIVERY_IS_IMMUTABLE/,
  );
  await assert.rejects(
    prisma.$executeRaw`DELETE FROM "deliveries" WHERE "id" = ${result.delivery.id}`,
    /DELIVERY_IS_IMMUTABLE/,
  );
});

test('M5-01: tampered Supplier Delivery signature fails closed before persistence or state transition', async () => {
  const fixture = await createActiveContract('tampered-delivery');
  const signed = signDelivery(fixture);
  signed.input.supplierSignature = Buffer.from('forged-delivery-signature').toString('base64url');

  await assert.rejects(
    submitSignedDelivery(prisma, fixture.supplier.authentication, signed.input),
    (error) => {
      assert.equal(error.code, 'ECONOMIC_SIGNATURE_INVALID');
      return true;
    },
  );

  const deliveries = await prisma.$queryRaw`SELECT "id" FROM "deliveries" WHERE "contractId" = ${fixture.formed.contract.id}`;
  const contracts = await prisma.$queryRaw`SELECT "lifecycleState" FROM "contracts" WHERE "id" = ${fixture.formed.contract.id}`;
  const escrow = await prisma.escrow.findUnique({ where: { id: fixture.formed.escrow.id } });
  assert.equal(deliveries.length, 0);
  assert.equal(contracts[0].lifecycleState, 'active');
  assert.equal(escrow.status, 'locked');
});

test('M5-01: database rejects direct ACCEPTANCE_PENDING transition without a protocol Delivery', async () => {
  const fixture = await createActiveContract('delivery-bypass');

  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "contracts"
      SET "lifecycleState" = 'acceptance_pending'::"ContractLifecycleState"
      WHERE "id" = ${fixture.formed.contract.id}
    `,
    /ACCEPTANCE_PENDING_REQUIRES_PROTOCOL_DELIVERY/,
  );

  const contractRows = await prisma.$queryRaw`SELECT "lifecycleState" FROM "contracts" WHERE "id" = ${fixture.formed.contract.id}`;
  assert.equal(contractRows[0].lifecycleState, 'active');
  assert.equal((await prisma.escrow.findUnique({ where: { id: fixture.formed.escrow.id } })).status, 'locked');
});