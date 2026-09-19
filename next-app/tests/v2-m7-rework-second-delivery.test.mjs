import assert from 'node:assert/strict';
import {
  createHash,
  generateKeyPairSync,
  sign as signDigest,
} from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createAgentApiCredentialMaterial } from '../src/lib/agent-auth-core.mjs';
import { createV2AgentAuthenticationContext } from '../src/lib/agent-auth-context-core.mjs';
import { settleAcceptedDelivery } from '../src/lib/atomic-settlement.mjs';
import {
  buildDeliveryEvidence,
  hashDeliveryEvidence,
  submitSignedDelivery,
} from '../src/lib/signed-delivery.mjs';
import {
  buildDeliveryAcceptanceEvidence,
  decideSignedDelivery,
  hashDeliveryAcceptanceEvidence,
} from '../src/lib/signed-delivery-acceptance.mjs';
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
    data: { name: `M7 Org ${suffix}`, type: orgType },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `M7 Agent ${suffix}` },
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
  const signingKeyId = `m7-signing-${suffix}`;
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
      mandateFamilyId: `m7-family-${suffix}`,
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
      payloadHash: sha256(`m7-mandate:${suffix}`),
      signatureAlgorithm: 'EdDSA',
      signatureKeyId: `principal-key-${suffix}`,
      signature: `principal-signature-${suffix}`,
    },
  });
  const authentication = createV2AgentAuthenticationContext({
    principal: { id: principal.id, type: 'organization', status: 'active' },
    agent: { id: agent.id, name: agent.name, status: 'active' },
    credential: {
      id: apiCredential.id,
      keyId: apiCredential.keyId,
      kind: 'api',
      status: 'active',
    },
  });
  return {
    principal,
    agent,
    signingKeyId,
    privateKey,
    mandate,
    authentication,
  };
}

async function createContract(label, deliveryPolicy = { maxAttempts: 2, reworkWindowSeconds: 60 }) {
  const buyer = await createActor(
    `buyer-${label}`,
    'buyer',
    ['offer.accept', 'delivery.accept', 'delivery.reject'],
  );
  const supplier = await createActor(
    `supplier-${label}`,
    'supplier',
    ['offer.issue', 'delivery.submit'],
  );

  const task = await createTask(prisma, {
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
  await openTask(prisma, { taskId: task.task.id });

  const now = new Date();
  const termsPayload = {
    label,
    deliverables: [{ kind: 'artifact', format: 'json' }],
    ...(deliveryPolicy === null ? {} : { deliveryPolicy }),
  };
  const unsignedOffer = {
    taskId: task.task.id,
    priceAmount: '25.50000000',
    currency: 'IWC',
    deliveryCommitmentSeconds: 3600,
    validUntil: new Date(now.getTime() + 60 * 60_000),
    termsPayload,
    nonce: unique('m7-offer'),
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
    taskRevision: task.revision.revision,
    taskHash: task.revision.contentHash,
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
  const issued = await issueSignedFirmOffer(
    prisma,
    supplier.authentication,
    {
      ...unsignedOffer,
      supplierSignature: signDigest(
        null,
        Buffer.from(hashEconomicCommandEvidence(offerCommand), 'hex'),
        supplier.privateKey,
      ).toString('base64url'),
    },
    { now },
  );

  await issueGenesisCredit(prisma, {
    principalId: buyer.principal.id,
    allocationVersion: unique('m7-allocation'),
    amount: '100.00000000',
  });

  const formationIdempotencyKey = unique('m7-formation');
  const acceptanceNonce = unique('m7-offer-accept');
  const offerAcceptanceEvidence = buildOfferAcceptanceEvidence({
    formationIdempotencyKey,
    taskId: task.task.id,
    taskRevision: task.revision.revision,
    taskHash: task.revision.contentHash,
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
    payloadHash: hashOfferAcceptanceEvidence(offerAcceptanceEvidence),
    nonce: acceptanceNonce,
    issuedAt: acceptanceInput.commandIssuedAt,
    expiresAt: acceptanceInput.commandExpiresAt,
    signingKeyId: buyer.signingKeyId,
    signatureAlgorithm: 'EdDSA',
  });
  const formed = await acceptSignedFirmOffer(
    prisma,
    buyer.authentication,
    {
      ...acceptanceInput,
      buyerSignature: signDigest(
        null,
        Buffer.from(hashEconomicCommandEvidence(acceptanceCommand), 'hex'),
        buyer.privateKey,
      ).toString('base64url'),
    },
    { now },
  );

  return { buyer, supplier, task, issued, formed };
}

function signDelivery(fixture, sequence, now = new Date()) {
  const input = {
    deliveryIdempotencyKey: unique(`m7-delivery-${sequence}`),
    contractId: fixture.formed.contract.id,
    effectiveContractHash: fixture.formed.contract.effectiveContractHash,
    deliverables: [{
      assetRef: `artifact:${unique(`m7-output-${sequence}`)}`,
      mediaType: 'application/json',
      contentHash: sha256(unique(`m7-content-${sequence}`)),
    }],
    evidence: [{ kind: 'attempt', value: sequence }],
    nonce: unique(`m7-delivery-nonce-${sequence}`),
    mandateId: fixture.supplier.mandate.id,
    commandIssuedAt: new Date(now.getTime() - 1000),
    commandExpiresAt: new Date(now.getTime() + 5 * 60_000),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: fixture.supplier.signingKeyId,
  };
  const evidence = buildDeliveryEvidence({
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    contractId: input.contractId,
    effectiveContractHash: input.effectiveContractHash,
    acceptedOfferRevisionId: fixture.formed.contract.acceptedOfferRevisionId,
    sequence,
    supplierPrincipalId: fixture.supplier.principal.id,
    supplierAgentIdentityId: fixture.supplier.agent.id,
    deliverables: input.deliverables,
    evidence: input.evidence,
    nonce: input.nonce,
  });
  const deliveryHash = hashDeliveryEvidence(evidence);
  const command = buildEconomicCommandEvidence({
    action: 'delivery.submit',
    principalId: fixture.supplier.principal.id,
    agentIdentityId: fixture.supplier.agent.id,
    mandateId: input.mandateId,
    payloadHash: deliveryHash,
    nonce: input.nonce,
    issuedAt: input.commandIssuedAt,
    expiresAt: input.commandExpiresAt,
    signingKeyId: input.signatureKeyId,
    signatureAlgorithm: input.signatureAlgorithm,
  });
  return {
    input: {
      ...input,
      supplierSignature: signDigest(
        null,
        Buffer.from(hashEconomicCommandEvidence(command), 'hex'),
        fixture.supplier.privateKey,
      ).toString('base64url'),
    },
    deliveryHash,
  };
}

function signDecision(fixture, delivery, decision, now = new Date(), reasonCode = undefined) {
  const input = {
    decisionIdempotencyKey: unique(`m7-${decision}`),
    contractId: fixture.formed.contract.id,
    effectiveContractHash: fixture.formed.contract.effectiveContractHash,
    deliveryId: delivery.id,
    deliveryHash: delivery.deliveryHash,
    decision,
    reasonCode,
    reasonDetail: reasonCode ? `M7 ${reasonCode} claim` : undefined,
    buyerPrincipalId: fixture.buyer.principal.id,
    buyerAgentIdentityId: fixture.buyer.agent.id,
    nonce: unique(`m7-${decision}-nonce`),
  };
  const decisionHash = hashDeliveryAcceptanceEvidence(buildDeliveryAcceptanceEvidence(input));
  const commandIssuedAt = new Date(now.getTime() - 1000);
  const commandExpiresAt = new Date(now.getTime() + 5 * 60_000);
  const action = decision === 'accept' ? 'delivery.accept' : 'delivery.reject';
  const command = buildEconomicCommandEvidence({
    action,
    principalId: fixture.buyer.principal.id,
    agentIdentityId: fixture.buyer.agent.id,
    mandateId: fixture.buyer.mandate.id,
    payloadHash: decisionHash,
    nonce: input.nonce,
    issuedAt: commandIssuedAt,
    expiresAt: commandExpiresAt,
    signingKeyId: fixture.buyer.signingKeyId,
    signatureAlgorithm: 'EdDSA',
  });
  return {
    ...input,
    mandateId: fixture.buyer.mandate.id,
    commandIssuedAt,
    commandExpiresAt,
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: fixture.buyer.signingKeyId,
    buyerSignature: signDigest(
      null,
      Buffer.from(hashEconomicCommandEvidence(command), 'hex'),
      fixture.buyer.privateKey,
    ).toString('base64url'),
  };
}

test('M7-01: REJECT creates immutable ReworkAuthorization and second Delivery can settle', async () => {
  const fixture = await createContract('rework-success');
  const firstNow = new Date();
  const firstSigned = signDelivery(fixture, 1, firstNow);
  const first = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    firstSigned.input,
    { now: firstNow },
  );
  assert.equal(first.delivery.sequence, 1);
  assert.equal(first.contract.lifecycleState, 'acceptance_pending');

  const rejectNow = new Date();
  const rejected = await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    signDecision(fixture, first.delivery, 'reject', rejectNow, 'INCOMPLETE'),
    { now: rejectNow },
  );
  assert.equal(rejected.acceptanceDecision.decision, 'reject');
  assert.equal(rejected.contract.lifecycleState, 'rework');
  assert.ok(rejected.reworkAuthorization);
  assert.equal(rejected.reworkAuthorization.rejectedSequence, 1);
  assert.equal(rejected.reworkAuthorization.nextSequence, 2);
  assert.equal(rejected.reworkAuthorization.maxAttempts, 2);
  assert.equal(rejected.reworkAuthorization.reworkWindowSeconds, 60);
  assert.equal(rejected.escrow.status, 'locked');

  const secondNow = new Date();
  const secondSigned = signDelivery(fixture, 2, secondNow);
  const second = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    secondSigned.input,
    { now: secondNow },
  );
  assert.equal(second.delivery.sequence, 2);
  assert.equal(second.delivery.deadlineStatus, 'rework_on_time');
  assert.equal(second.reworkAuthorization.id, rejected.reworkAuthorization.id);
  assert.equal(second.contract.lifecycleState, 'acceptance_pending');

  const accepted = await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    signDecision(fixture, second.delivery, 'accept'),
  );
  assert.equal(accepted.acceptanceDecision.decision, 'accept');
  assert.equal(accepted.contract.lifecycleState, 'acceptance_pending');

  const settled = await settleAcceptedDelivery(prisma, {
    contractId: fixture.formed.contract.id,
    idempotencyKey: unique('m7-settlement'),
  });
  assert.equal(settled.settlement.deliveryId, second.delivery.id);

  const [contractRows, escrow, deliveries, decisions, reworks] = await Promise.all([
    prisma.$queryRaw`SELECT * FROM "contracts" WHERE "id" = ${fixture.formed.contract.id}`,
    prisma.escrow.findUniqueOrThrow({ where: { id: fixture.formed.escrow.id } }),
    prisma.$queryRaw`
      SELECT "id", "sequence" FROM "deliveries"
      WHERE "contractId" = ${fixture.formed.contract.id}
      ORDER BY "sequence"
    `,
    prisma.$queryRaw`
      SELECT "id", "decision", "deliveryId" FROM "delivery_acceptance_decisions"
      WHERE "contractId" = ${fixture.formed.contract.id}
      ORDER BY "decidedAt"
    `,
    prisma.$queryRaw`
      SELECT * FROM "rework_authorizations"
      WHERE "contractId" = ${fixture.formed.contract.id}
    `,
  ]);
  assert.equal(contractRows[0].lifecycleState, 'closed');
  assert.equal(escrow.status, 'released');
  assert.deepEqual(deliveries.map((row) => row.sequence), [1, 2]);
  assert.deepEqual(decisions.map((row) => row.decision), ['reject', 'accept']);
  assert.equal(reworks.length, 1);

  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "rework_authorizations"
      SET "reworkDeadline" = NOW() + INTERVAL '1 day'
      WHERE "id" = ${rejected.reworkAuthorization.id}
    `,
    /REWORK_AUTHORIZATION_IS_IMMUTABLE/,
  );
});

test('M7-01: rejection without signed rework entitlement moves Contract to DISPUTED', async () => {
  const fixture = await createContract('no-rework-entitlement', null);
  const signed = signDelivery(fixture, 1);
  const delivered = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signed.input,
  );
  const rejected = await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    signDecision(fixture, delivered.delivery, 'reject', new Date(), 'CONSTRAINT_NOT_MET'),
  );

  assert.equal(rejected.contract.lifecycleState, 'disputed');
  assert.equal(rejected.reworkAuthorization, null);
  assert.equal(rejected.escrow.status, 'locked');

  const reworks = await prisma.$queryRaw`
    SELECT "id" FROM "rework_authorizations"
    WHERE "contractId" = ${fixture.formed.contract.id}
  `;
  assert.equal(reworks.length, 0);

  await assert.rejects(
    submitSignedDelivery(
      prisma,
      fixture.supplier.authentication,
      signDelivery(fixture, 2).input,
    ),
    (error) => error?.code === 'DELIVERY_CONTRACT_STATE_INVALID',
  );
});

test('M7-01: final allowed Delivery rejection exhausts attempts and moves to DISPUTED', async () => {
  const fixture = await createContract('attempts-exhausted');
  const first = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signDelivery(fixture, 1).input,
  );
  const firstRejected = await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    signDecision(fixture, first.delivery, 'reject', new Date(), 'INCOMPLETE'),
  );
  assert.equal(firstRejected.contract.lifecycleState, 'rework');

  const second = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signDelivery(fixture, 2).input,
  );
  const finalRejected = await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    signDecision(fixture, second.delivery, 'reject', new Date(), 'CONSTRAINT_NOT_MET'),
  );

  assert.equal(finalRejected.contract.lifecycleState, 'disputed');
  assert.equal(finalRejected.reworkAuthorization, null);
  assert.equal(finalRejected.escrow.status, 'locked');

  const reworks = await prisma.$queryRaw`
    SELECT "nextSequence" FROM "rework_authorizations"
    WHERE "contractId" = ${fixture.formed.contract.id}
    ORDER BY "nextSequence"
  `;
  assert.deepEqual(reworks.map((row) => row.nextSequence), [2]);
});

test('M7-01: expired rework window rejects second Delivery without consuming an attempt', async () => {
  const fixture = await createContract(
    'rework-expired',
    { maxAttempts: 2, reworkWindowSeconds: 1 },
  );
  const first = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signDelivery(fixture, 1).input,
  );
  const rejected = await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    signDecision(fixture, first.delivery, 'reject', new Date(), 'INCOMPLETE'),
  );
  assert.equal(rejected.contract.lifecycleState, 'rework');

  await delay(1200);
  await assert.rejects(
    submitSignedDelivery(
      prisma,
      fixture.supplier.authentication,
      signDelivery(fixture, 2).input,
    ),
    (error) => error?.code === 'REWORK_WINDOW_EXPIRED' || /REWORK_WINDOW_EXPIRED/.test(error?.message ?? ''),
  );

  const deliveries = await prisma.$queryRaw`
    SELECT "sequence" FROM "deliveries"
    WHERE "contractId" = ${fixture.formed.contract.id}
    ORDER BY "sequence"
  `;
  assert.deepEqual(deliveries.map((row) => row.sequence), [1]);
  const contractRows = await prisma.$queryRaw`
    SELECT "lifecycleState" FROM "contracts"
    WHERE "id" = ${fixture.formed.contract.id}
  `;
  assert.equal(contractRows[0].lifecycleState, 'rework');
});


test('M7-02: database rejects direct ACCEPTANCE_PENDING to REWORK transition without ReworkAuthorization', async () => {
  const fixture = await createContract('rework-state-bypass');
  const first = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signDelivery(fixture, 1).input,
  );
  assert.equal(first.contract.lifecycleState, 'acceptance_pending');

  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "contracts"
      SET "lifecycleState" = 'rework'::"ContractLifecycleState"
      WHERE "id" = ${fixture.formed.contract.id}
    `,
    /REWORK_REQUIRES_PROTOCOL_AUTHORIZATION/,
  );

  const contractRows = await prisma.$queryRaw`
    SELECT "lifecycleState" FROM "contracts"
    WHERE "id" = ${fixture.formed.contract.id}
  `;
  assert.equal(contractRows[0].lifecycleState, 'acceptance_pending');
});

test('M7-02: replayed Buyer rejection returns the same immutable ReworkAuthorization', async () => {
  const fixture = await createContract('rework-replay');
  const first = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signDelivery(fixture, 1).input,
  );
  const rejectInput = signDecision(
    fixture,
    first.delivery,
    'reject',
    new Date(),
    'INCOMPLETE',
  );

  const original = await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    rejectInput,
  );
  const replay = await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    rejectInput,
  );

  assert.equal(original.reworkAuthorization.id, replay.reworkAuthorization.id);
  assert.equal(replay.idempotent, true);

  const rows = await prisma.$queryRaw`
    SELECT "id" FROM "rework_authorizations"
    WHERE "contractId" = ${fixture.formed.contract.id}
  `;
  assert.equal(rows.length, 1);
});

test('M7-02: concurrent second Delivery commands consume one rework attempt exactly once', async () => {
  const fixture = await createContract('rework-concurrency');
  const first = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signDelivery(fixture, 1).input,
  );
  const rejected = await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    signDecision(fixture, first.delivery, 'reject', new Date(), 'INCOMPLETE'),
  );
  assert.equal(rejected.contract.lifecycleState, 'rework');

  const left = signDelivery(fixture, 2);
  const right = signDelivery(fixture, 2);
  const results = await Promise.allSettled([
    submitSignedDelivery(prisma, fixture.supplier.authentication, left.input),
    submitSignedDelivery(prisma, fixture.supplier.authentication, right.input),
  ]);

  const fulfilled = results.filter((result) => result.status === 'fulfilled');
  const rejectedResults = results.filter((result) => result.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejectedResults.length, 1);
  assert.ok(
    rejectedResults[0].reason?.code === 'DELIVERY_CONTRACT_STATE_INVALID'
      || rejectedResults[0].reason?.code === 'IDEMPOTENCY_CONFLICT'
      || /DELIVERY_CONTRACT_STATE_INVALID|serialization|concurrent/i.test(
        rejectedResults[0].reason?.message ?? '',
      ),
  );

  const deliveries = await prisma.$queryRaw`
    SELECT "sequence" FROM "deliveries"
    WHERE "contractId" = ${fixture.formed.contract.id}
    ORDER BY "sequence"
  `;
  assert.deepEqual(deliveries.map((row) => row.sequence), [1, 2]);

  const contractRows = await prisma.$queryRaw`
    SELECT "lifecycleState" FROM "contracts"
    WHERE "id" = ${fixture.formed.contract.id}
  `;
  assert.equal(contractRows[0].lifecycleState, 'acceptance_pending');
});
