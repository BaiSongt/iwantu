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
import {
  buildMutualSettlementAgreementEvidence,
  hashMutualSettlementAgreementEvidence,
  settleMutualSplit,
} from '../src/lib/mutual-settlement.mjs';
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
import { defaultAndRefundContract } from '../src/lib/supplier-default-refund.mjs';
import { createTask, openTask } from '../src/lib/task-protocol.mjs';

const prisma = new PrismaClient();

before(async () => prisma.$connect());
after(async () => prisma.$disconnect());

function unique(label) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

async function createActor(label, orgType, actionScopes) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `M9 Org ${suffix}`, type: orgType },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `M9 Agent ${suffix}` },
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
  const signingKeyId = `m9-signing-${suffix}`;
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
      mandateFamilyId: `m9-family-${suffix}`,
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
      payloadHash: sha256(`m9-mandate:${suffix}`),
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

async function createContract(label, deliveryCommitmentSeconds = 3600) {
  const buyer = await createActor(
    `buyer-${label}`,
    'buyer',
    ['offer.accept', 'delivery.accept', 'delivery.reject', 'settlement.mutual'],
  );
  const supplier = await createActor(
    `supplier-${label}`,
    'supplier',
    ['offer.issue', 'delivery.submit', 'settlement.mutual'],
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
  const offerInput = {
    taskId: task.task.id,
    priceAmount: '25.50000000',
    currency: 'IWC',
    deliveryCommitmentSeconds,
    validUntil: new Date(now.getTime() + 60 * 60_000),
    termsPayload: {
      label,
      deliverables: [{ kind: 'artifact', format: 'json' }],
    },
    nonce: unique('m9-offer'),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: supplier.signingKeyId,
    mandateId: supplier.mandate.id,
    commandIssuedAt: new Date(now.getTime() - 1000),
    commandExpiresAt: new Date(now.getTime() + 5 * 60_000),
  };
  const offerHash = buildFirmOfferHash({
    ...offerInput,
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
    nonce: offerInput.nonce,
    issuedAt: offerInput.commandIssuedAt,
    expiresAt: offerInput.commandExpiresAt,
    signingKeyId: supplier.signingKeyId,
    signatureAlgorithm: 'EdDSA',
  });
  const issued = await issueSignedFirmOffer(
    prisma,
    supplier.authentication,
    {
      ...offerInput,
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
    allocationVersion: unique('m9-genesis'),
    amount: '100.00000000',
  });

  const formationIdempotencyKey = unique('m9-formation');
  const nonce = unique('m9-offer-accept');
  const acceptanceEvidence = buildOfferAcceptanceEvidence({
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
    nonce,
  });
  const acceptanceInput = {
    formationIdempotencyKey,
    offerId: issued.offer.id,
    offerRevision: issued.revision.revision,
    offerHash: issued.revision.offerHash,
    nonce,
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
    payloadHash: hashOfferAcceptanceEvidence(acceptanceEvidence),
    nonce,
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

function signDelivery(fixture, now = new Date()) {
  const input = {
    deliveryIdempotencyKey: unique('m9-delivery'),
    contractId: fixture.formed.contract.id,
    effectiveContractHash: fixture.formed.contract.effectiveContractHash,
    deliverables: [{
      assetRef: `artifact:${unique('m9-output')}`,
      mediaType: 'application/json',
      contentHash: sha256(unique('m9-content')),
    }],
    evidence: [{ kind: 'test', value: 'delivered' }],
    nonce: unique('m9-delivery-nonce'),
    mandateId: fixture.supplier.mandate.id,
    commandIssuedAt: new Date(now.getTime() - 1000),
    commandExpiresAt: new Date(now.getTime() + 5 * 60_000),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: fixture.supplier.signingKeyId,
  };
  const deliveryEvidence = buildDeliveryEvidence({
    deliveryIdempotencyKey: input.deliveryIdempotencyKey,
    contractId: input.contractId,
    effectiveContractHash: input.effectiveContractHash,
    acceptedOfferRevisionId: fixture.formed.contract.acceptedOfferRevisionId,
    sequence: 1,
    supplierPrincipalId: fixture.supplier.principal.id,
    supplierAgentIdentityId: fixture.supplier.agent.id,
    deliverables: input.deliverables,
    evidence: input.evidence,
    nonce: input.nonce,
  });
  const deliveryHash = hashDeliveryEvidence(deliveryEvidence);
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
    ...input,
    supplierSignature: signDigest(
      null,
      Buffer.from(hashEconomicCommandEvidence(command), 'hex'),
      fixture.supplier.privateKey,
    ).toString('base64url'),
  };
}

function signDecision(fixture, delivery, decision, reasonCode = undefined, now = new Date()) {
  const evidenceInput = {
    decisionIdempotencyKey: unique(`m9-${decision}`),
    contractId: fixture.formed.contract.id,
    effectiveContractHash: fixture.formed.contract.effectiveContractHash,
    deliveryId: delivery.id,
    deliveryHash: delivery.deliveryHash,
    decision,
    reasonCode,
    reasonDetail: reasonCode ? `M9 ${reasonCode} claim` : undefined,
    buyerPrincipalId: fixture.buyer.principal.id,
    buyerAgentIdentityId: fixture.buyer.agent.id,
    nonce: unique(`m9-${decision}-nonce`),
  };
  const decisionHash = hashDeliveryAcceptanceEvidence(
    buildDeliveryAcceptanceEvidence(evidenceInput),
  );
  const commandIssuedAt = new Date(now.getTime() - 1000);
  const commandExpiresAt = new Date(now.getTime() + 5 * 60_000);
  const command = buildEconomicCommandEvidence({
    action: decision === 'accept' ? 'delivery.accept' : 'delivery.reject',
    principalId: fixture.buyer.principal.id,
    agentIdentityId: fixture.buyer.agent.id,
    mandateId: fixture.buyer.mandate.id,
    payloadHash: decisionHash,
    nonce: evidenceInput.nonce,
    issuedAt: commandIssuedAt,
    expiresAt: commandExpiresAt,
    signingKeyId: fixture.buyer.signingKeyId,
    signatureAlgorithm: 'EdDSA',
  });
  return {
    ...evidenceInput,
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

function signMutualSettlement(prepared, supplierAmount, buyerRefundAmount, now = new Date()) {
  const { fixture, rejected } = prepared;
  const agreementEvidence = buildMutualSettlementAgreementEvidence({
    contractId: fixture.formed.contract.id,
    effectiveContractHash: fixture.formed.contract.effectiveContractHash,
    disputeId: rejected.dispute.id,
    disputeHash: rejected.dispute.disputeHash,
    buyerPrincipalId: fixture.buyer.principal.id,
    buyerAgentIdentityId: fixture.buyer.agent.id,
    supplierPrincipalId: fixture.supplier.principal.id,
    supplierAgentIdentityId: fixture.supplier.agent.id,
    grossAmount: String(fixture.formed.escrow.amount),
    supplierAmount,
    buyerRefundAmount,
    currency: 'IWC',
  });
  const agreementHash = hashMutualSettlementAgreementEvidence(agreementEvidence);

  function party(actor) {
    const nonce = unique('m9-mutual-party');
    const commandIssuedAt = new Date(now.getTime() - 1000);
    const commandExpiresAt = new Date(now.getTime() + 5 * 60_000);
    const command = buildEconomicCommandEvidence({
      action: 'settlement.mutual',
      principalId: actor.principal.id,
      agentIdentityId: actor.agent.id,
      mandateId: actor.mandate.id,
      payloadHash: agreementHash,
      nonce,
      issuedAt: commandIssuedAt,
      expiresAt: commandExpiresAt,
      signingKeyId: actor.signingKeyId,
      signatureAlgorithm: 'EdDSA',
    });
    return {
      mandateId: actor.mandate.id,
      nonce,
      commandIssuedAt,
      commandExpiresAt,
      signingKeyId: actor.signingKeyId,
      signatureAlgorithm: 'EdDSA',
      signature: signDigest(
        null,
        Buffer.from(hashEconomicCommandEvidence(command), 'hex'),
        actor.privateKey,
      ).toString('base64url'),
    };
  }

  return {
    contractId: fixture.formed.contract.id,
    idempotencyKey: unique('m9-mutual-settlement'),
    supplierAmount,
    buyerRefundAmount,
    buyer: party(fixture.buyer),
    supplier: party(fixture.supplier),
  };
}

async function reputationRows(contractId) {
  return prisma.$queryRaw`
    SELECT *
    FROM "reputation_evidence"
    WHERE "contractId" = ${contractId}
    ORDER BY "subjectRole", "evidenceClass"
  `;
}

test('M9-01: intermediate rejection/dispute creates no ReputationEvidence before terminal settlement', async () => {
  const fixture = await createContract('no-intermediate-reputation');
  const delivered = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signDelivery(fixture),
  );
  const rejected = await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    signDecision(fixture, delivered.delivery, 'reject', 'INCOMPLETE'),
  );
  assert.equal(rejected.contract.lifecycleState, 'disputed');
  assert.equal((await reputationRows(fixture.formed.contract.id)).length, 0);
});

test('M9-01: FULL_SETTLEMENT emits immutable Buyer/Supplier transaction and economic evidence', async () => {
  const fixture = await createContract('success-reputation');
  const delivered = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signDelivery(fixture),
  );
  await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    signDecision(fixture, delivered.delivery, 'accept'),
  );
  const settled = await settleAcceptedDelivery(prisma, {
    contractId: fixture.formed.contract.id,
    idempotencyKey: unique('m9-success-settlement'),
  });

  const rows = await reputationRows(fixture.formed.contract.id);
  assert.equal(rows.length, 4);
  assert.deepEqual(
    rows.map((row) => [row.subjectRole, row.evidenceClass]),
    [
      ['buyer', 'economic'],
      ['buyer', 'transaction'],
      ['supplier', 'economic'],
      ['supplier', 'transaction'],
    ],
  );

  const supplierTx = rows.find(
    (row) => row.subjectRole === 'supplier' && row.evidenceClass === 'transaction',
  );
  const supplierEconomic = rows.find(
    (row) => row.subjectRole === 'supplier' && row.evidenceClass === 'economic',
  );
  const buyerEconomic = rows.find(
    (row) => row.subjectRole === 'buyer' && row.evidenceClass === 'economic',
  );

  assert.equal(supplierTx.evidence.terminalOutcome, 'success');
  assert.equal(supplierTx.evidence.acceptanceSource, 'buyer_signed');
  assert.equal(supplierTx.evidence.deliveryAttempts, 1);
  assert.equal(supplierTx.evidence.rejectionCount, 0);
  assert.equal(supplierEconomic.evidence.subjectReceivedAmount, '25.50000000');
  assert.equal(buyerEconomic.evidence.subjectReceivedAmount, '0');
  assert.equal(supplierEconomic.evidence.ledgerTransactionId, settled.ledgerTransaction.id);

  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "reputation_evidence"
      SET "evidenceType" = 'forged'
      WHERE "id" = ${supplierTx.id}
    `,
    /REPUTATION_EVIDENCE_IS_IMMUTABLE/,
  );
  await assert.rejects(
    prisma.$executeRaw`
      DELETE FROM "reputation_evidence"
      WHERE "id" = ${supplierTx.id}
    `,
    /REPUTATION_EVIDENCE_IS_IMMUTABLE/,
  );
});

test('M9-01: SUPPLIER_DEFAULT full refund emits terminal evidence only after refund settlement', async () => {
  const fixture = await createContract('default-reputation', 1);
  assert.equal((await reputationRows(fixture.formed.contract.id)).length, 0);

  const deadline = fixture.formed.contract.activatedAt.getTime() + 1000;
  await delay(Math.max(0, deadline - Date.now() + 150));

  await defaultAndRefundContract(prisma, {
    contractId: fixture.formed.contract.id,
    idempotencyKey: unique('m9-default-refund'),
  });

  const rows = await reputationRows(fixture.formed.contract.id);
  assert.equal(rows.length, 4);

  const supplierTx = rows.find(
    (row) => row.subjectRole === 'supplier' && row.evidenceClass === 'transaction',
  );
  const supplierEconomic = rows.find(
    (row) => row.subjectRole === 'supplier' && row.evidenceClass === 'economic',
  );
  const buyerEconomic = rows.find(
    (row) => row.subjectRole === 'buyer' && row.evidenceClass === 'economic',
  );

  assert.equal(supplierTx.evidence.terminalOutcome, 'supplier_default');
  assert.equal(supplierTx.evidence.deliveryAttempts, 0);
  assert.equal(supplierEconomic.evidence.subjectReceivedAmount, '0');
  assert.equal(buyerEconomic.evidence.subjectReceivedAmount, '25.50000000');
});

test('M9-01: MUTUAL_SPLIT evidence records dispute/rejections and exact bilateral credit allocation', async () => {
  const fixture = await createContract('mutual-reputation');
  const delivered = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signDelivery(fixture),
  );
  const rejected = await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    signDecision(fixture, delivered.delivery, 'reject', 'CONSTRAINT_NOT_MET'),
  );
  assert.equal(rejected.contract.lifecycleState, 'disputed');
  assert.equal((await reputationRows(fixture.formed.contract.id)).length, 0);

  const prepared = { fixture, rejected };
  await settleMutualSplit(
    prisma,
    fixture.buyer.authentication,
    fixture.supplier.authentication,
    signMutualSettlement(prepared, '12.50000000', '13.00000000'),
  );

  const rows = await reputationRows(fixture.formed.contract.id);
  assert.equal(rows.length, 4);

  const buyerTx = rows.find(
    (row) => row.subjectRole === 'buyer' && row.evidenceClass === 'transaction',
  );
  const supplierTx = rows.find(
    (row) => row.subjectRole === 'supplier' && row.evidenceClass === 'transaction',
  );
  const buyerEconomic = rows.find(
    (row) => row.subjectRole === 'buyer' && row.evidenceClass === 'economic',
  );
  const supplierEconomic = rows.find(
    (row) => row.subjectRole === 'supplier' && row.evidenceClass === 'economic',
  );

  assert.equal(buyerTx.evidence.terminalOutcome, 'mutual_split');
  assert.equal(supplierTx.evidence.terminalOutcome, 'mutual_split');
  assert.equal(supplierTx.evidence.disputed, true);
  assert.equal(supplierTx.evidence.rejectionCount, 1);
  assert.equal(supplierEconomic.evidence.subjectReceivedAmount, '12.50000000');
  assert.equal(buyerEconomic.evidence.subjectReceivedAmount, '13.00000000');
});

test('M9-01: direct fabricated ReputationEvidence payload is rejected by settlement-derived DB binding', async () => {
  const fixture = await createContract('reputation-bypass');
  const delivered = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signDelivery(fixture),
  );
  await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    signDecision(fixture, delivered.delivery, 'accept'),
  );
  const settled = await settleAcceptedDelivery(prisma, {
    contractId: fixture.formed.contract.id,
    idempotencyKey: unique('m9-bypass-settlement'),
  });
  const rows = await reputationRows(fixture.formed.contract.id);
  const canonical = rows.find(
    (row) => row.subjectRole === 'supplier' && row.evidenceClass === 'transaction',
  );

  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "reputation_evidence" (
        "id", "settlementId", "contractId", "subjectRole",
        "evidenceClass", "evidenceType", "subjectPrincipalId",
        "subjectAgentIdentityId", "counterpartyPrincipalId",
        "counterpartyAgentIdentityId", "evidence", "occurredAt"
      ) VALUES (
        ${unique('forged-reputation')}, ${settled.settlement.id},
        ${fixture.formed.contract.id}, 'supplier', 'transaction',
        'terminal_contract_outcome', ${fixture.supplier.principal.id},
        ${fixture.supplier.agent.id}, ${fixture.buyer.principal.id},
        ${fixture.buyer.agent.id},
        ${JSON.stringify({ ...canonical.evidence, terminalOutcome: 'forged' })}::jsonb,
        ${canonical.occurredAt}
      )
    `,
    /REPUTATION_EVIDENCE_PAYLOAD_MISMATCH|duplicate key/,
  );
});
