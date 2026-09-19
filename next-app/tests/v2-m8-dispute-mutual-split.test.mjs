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

async function ledgerBalance(accountId) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(sum(CASE
      WHEN t."status" = 'posted' AND e."side" = 'credit' THEN e."amount"
      WHEN t."status" = 'posted' AND e."side" = 'debit' THEN -e."amount"
      ELSE 0
    END), 0)::DECIMAL(36,8) AS "balance"
    FROM "ledger_accounts" a
    LEFT JOIN "ledger_entries" e ON e."accountId" = a."id"
    LEFT JOIN "ledger_transactions" t ON t."id" = e."transactionId"
    WHERE a."id" = ${accountId}
    GROUP BY a."id"
  `;
  return Number(rows[0]?.balance ?? 0);
}

async function createActor(label, orgType, actionScopes) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `M8 Org ${suffix}`, type: orgType },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `M8 Agent ${suffix}` },
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
  const signingKeyId = `m8-signing-${suffix}`;
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
      mandateFamilyId: `m8-family-${suffix}`,
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
      payloadHash: sha256(`m8-mandate:${suffix}`),
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

async function createContract(label) {
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
  const unsignedOffer = {
    taskId: task.task.id,
    priceAmount: '25.50000000',
    currency: 'IWC',
    deliveryCommitmentSeconds: 3600,
    validUntil: new Date(now.getTime() + 60 * 60_000),
    termsPayload: {
      label,
      deliverables: [{ kind: 'artifact', format: 'json' }],
    },
    nonce: unique('m8-offer'),
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
    allocationVersion: unique('m8-allocation'),
    amount: '100.00000000',
  });

  const formationIdempotencyKey = unique('m8-formation');
  const acceptanceNonce = unique('m8-offer-accept');
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
  const offerAcceptanceInput = {
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
    issuedAt: offerAcceptanceInput.commandIssuedAt,
    expiresAt: offerAcceptanceInput.commandExpiresAt,
    signingKeyId: buyer.signingKeyId,
    signatureAlgorithm: 'EdDSA',
  });
  const formed = await acceptSignedFirmOffer(
    prisma,
    buyer.authentication,
    {
      ...offerAcceptanceInput,
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
    deliveryIdempotencyKey: unique('m8-delivery'),
    contractId: fixture.formed.contract.id,
    effectiveContractHash: fixture.formed.contract.effectiveContractHash,
    deliverables: [{
      assetRef: `artifact:${unique('m8-output')}`,
      mediaType: 'application/json',
      contentHash: sha256(unique('m8-content')),
    }],
    evidence: [{ kind: 'test', value: 'delivered' }],
    nonce: unique('m8-delivery-nonce'),
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
    sequence: 1,
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
    ...input,
    supplierSignature: signDigest(
      null,
      Buffer.from(hashEconomicCommandEvidence(command), 'hex'),
      fixture.supplier.privateKey,
    ).toString('base64url'),
  };
}

function signRejection(fixture, delivery, now = new Date()) {
  const input = {
    decisionIdempotencyKey: unique('m8-reject'),
    contractId: fixture.formed.contract.id,
    effectiveContractHash: fixture.formed.contract.effectiveContractHash,
    deliveryId: delivery.id,
    deliveryHash: delivery.deliveryHash,
    decision: 'reject',
    reasonCode: 'INCOMPLETE',
    reasonDetail: 'Mutual settlement test rejection',
    buyerPrincipalId: fixture.buyer.principal.id,
    buyerAgentIdentityId: fixture.buyer.agent.id,
    nonce: unique('m8-reject-nonce'),
  };
  const decisionHash = hashDeliveryAcceptanceEvidence(buildDeliveryAcceptanceEvidence(input));
  const commandIssuedAt = new Date(now.getTime() - 1000);
  const commandExpiresAt = new Date(now.getTime() + 5 * 60_000);
  const command = buildEconomicCommandEvidence({
    action: 'delivery.reject',
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

async function prepareDisputedContract(label) {
  const fixture = await createContract(label);
  const delivery = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signDelivery(fixture),
  );
  const rejected = await decideSignedDelivery(
    prisma,
    fixture.buyer.authentication,
    signRejection(fixture, delivery.delivery),
  );
  assert.equal(rejected.contract.lifecycleState, 'disputed');
  assert.ok(rejected.dispute);
  assert.equal(rejected.escrow.status, 'locked');
  return { fixture, delivered: delivery.delivery, rejected };
}

function signMutualSettlement(prepared, supplierAmount, buyerRefundAmount, now = new Date()) {
  const { fixture, rejected } = prepared;
  const grossAmount = String(fixture.formed.escrow.amount);
  const evidence = buildMutualSettlementAgreementEvidence({
    contractId: fixture.formed.contract.id,
    effectiveContractHash: fixture.formed.contract.effectiveContractHash,
    disputeId: rejected.dispute.id,
    disputeHash: rejected.dispute.disputeHash,
    buyerPrincipalId: fixture.buyer.principal.id,
    buyerAgentIdentityId: fixture.buyer.agent.id,
    supplierPrincipalId: fixture.supplier.principal.id,
    supplierAgentIdentityId: fixture.supplier.agent.id,
    grossAmount,
    supplierAmount,
    buyerRefundAmount,
    currency: 'IWC',
  });
  const agreementHash = hashMutualSettlementAgreementEvidence(evidence);

  function party(actor, counterparty, label) {
    const commandIssuedAt = new Date(now.getTime() - 1000);
    const commandExpiresAt = new Date(now.getTime() + 5 * 60_000);
    const nonce = unique(`m8-mutual-${label}`);
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
      counterpartyPrincipalId: counterparty.principal.id,
    };
  }

  return {
    input: {
      contractId: fixture.formed.contract.id,
      idempotencyKey: unique('m8-mutual-settlement'),
      supplierAmount,
      buyerRefundAmount,
      buyer: party(fixture.buyer, fixture.supplier, 'buyer'),
      supplier: party(fixture.supplier, fixture.buyer, 'supplier'),
    },
    agreementHash,
  };
}

test('M8-01: final rejection materializes immutable Dispute and keeps Escrow locked', async () => {
  const prepared = await prepareDisputedContract('dispute-fact');
  const { fixture, delivered, rejected } = prepared;

  assert.equal(rejected.dispute.contractId, fixture.formed.contract.id);
  assert.equal(rejected.dispute.deliveryId, delivered.id);
  assert.equal(rejected.dispute.rejectionDecisionId, rejected.acceptanceDecision.id);
  assert.equal(rejected.dispute.reasonCode, 'rework_not_granted');
  assert.match(rejected.dispute.disputeHash, /^[0-9a-f]{64}$/);

  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "disputes"
      SET "reasonCode" = 'attempts_exhausted'
      WHERE "id" = ${rejected.dispute.id}
    `,
    /DISPUTE_IS_IMMUTABLE/,
  );
});

test('M8-01: database rejects direct DISPUTED transition without immutable Dispute', async () => {
  const fixture = await createContract('dispute-bypass');
  const delivery = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    signDelivery(fixture),
  );
  assert.equal(delivery.contract.lifecycleState, 'acceptance_pending');

  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "contracts"
      SET "lifecycleState" = 'disputed'::"ContractLifecycleState"
      WHERE "id" = ${fixture.formed.contract.id}
    `,
    /DISPUTED_REQUIRES_PROTOCOL_DISPUTE/,
  );
});

test('M8-02: bilateral signed MUTUAL_SPLIT atomically allocates Escrow and closes Contract', async () => {
  const prepared = await prepareDisputedContract('mutual-split');
  const { fixture } = prepared;
  const signed = signMutualSettlement(prepared, '15.50000000', '10.00000000');

  const buyerAvailable = await prisma.ledgerAccount.findFirstOrThrow({
    where: {
      principalId: fixture.buyer.principal.id,
      type: 'principal_available',
      currency: 'IWC',
    },
  });
  const buyerLocked = await prisma.ledgerAccount.findFirstOrThrow({
    where: {
      principalId: fixture.buyer.principal.id,
      type: 'principal_locked',
      currency: 'IWC',
    },
  });
  const beforeBuyerAvailable = await ledgerBalance(buyerAvailable.id);
  const beforeBuyerLocked = await ledgerBalance(buyerLocked.id);
  assert.equal(beforeBuyerAvailable, 74.5);
  assert.equal(beforeBuyerLocked, 25.5);

  const result = await settleMutualSplit(
    prisma,
    fixture.buyer.authentication,
    fixture.supplier.authentication,
    signed.input,
  );

  assert.equal(result.replayed, false);
  assert.equal(result.agreement.agreementHash, signed.agreementHash);
  assert.equal(result.settlement.type, 'mutual_split');
  assert.equal(result.settlement.disputeId, prepared.rejected.dispute.id);
  assert.equal(result.settlement.mutualSettlementAgreementId, result.agreement.id);

  const [contractRows, escrow, supplierAvailable, postings] = await Promise.all([
    prisma.$queryRaw`
      SELECT * FROM "contracts" WHERE "id" = ${fixture.formed.contract.id}
    `,
    prisma.escrow.findUniqueOrThrow({ where: { id: fixture.formed.escrow.id } }),
    prisma.ledgerAccount.findFirstOrThrow({
      where: {
        principalId: fixture.supplier.principal.id,
        type: 'principal_available',
        currency: 'IWC',
      },
    }),
    prisma.$queryRaw`
      SELECT * FROM "ledger_transactions"
      WHERE "referenceType" = 'escrow_mutual_split'
        AND "referenceId" = ${fixture.formed.contract.id}
    `,
  ]);

  assert.equal(contractRows[0].lifecycleState, 'closed');
  assert.ok(contractRows[0].closedAt);
  assert.equal(escrow.status, 'released');
  assert.equal(escrow.releaseLedgerTransactionId, result.ledgerTransaction.id);
  assert.equal(postings.length, 1);
  assert.equal(await ledgerBalance(buyerAvailable.id), 84.5);
  assert.equal(await ledgerBalance(buyerLocked.id), 0);
  assert.equal(await ledgerBalance(supplierAvailable.id), 15.5);

  const entries = await prisma.$queryRaw`
    SELECT a."principalId", a."type", e."side", e."amount"
    FROM "ledger_entries" e
    JOIN "ledger_accounts" a ON a."id" = e."accountId"
    WHERE e."transactionId" = ${result.ledgerTransaction.id}
    ORDER BY e."entryIndex"
  `;
  assert.equal(entries.length, 3);
});

test('M8-02: tampered Supplier signature fails closed before Agreement, Ledger or terminal state', async () => {
  const prepared = await prepareDisputedContract('mutual-signature-fail');
  const { fixture } = prepared;
  const signed = signMutualSettlement(prepared, '15.50000000', '10.00000000');
  signed.input.supplier.signature = Buffer.from('forged-mutual-signature').toString('base64url');

  await assert.rejects(
    settleMutualSplit(
      prisma,
      fixture.buyer.authentication,
      fixture.supplier.authentication,
      signed.input,
    ),
    (error) => error?.code === 'MUTUAL_SETTLEMENT_SIGNATURE_INVALID',
  );

  const [agreements, settlements, postings, contractRows, escrow] = await Promise.all([
    prisma.$queryRaw`
      SELECT "id" FROM "mutual_settlement_agreements"
      WHERE "contractId" = ${fixture.formed.contract.id}
    `,
    prisma.$queryRaw`
      SELECT "id" FROM "settlements"
      WHERE "contractId" = ${fixture.formed.contract.id}
    `,
    prisma.$queryRaw`
      SELECT "id" FROM "ledger_transactions"
      WHERE "referenceType" = 'escrow_mutual_split'
        AND "referenceId" = ${fixture.formed.contract.id}
    `,
    prisma.$queryRaw`
      SELECT "lifecycleState" FROM "contracts"
      WHERE "id" = ${fixture.formed.contract.id}
    `,
    prisma.escrow.findUniqueOrThrow({ where: { id: fixture.formed.escrow.id } }),
  ]);
  assert.equal(agreements.length, 0);
  assert.equal(settlements.length, 0);
  assert.equal(postings.length, 0);
  assert.equal(contractRows[0].lifecycleState, 'disputed');
  assert.equal(escrow.status, 'locked');
});

test('M8-02: unbalanced or one-sided allocation is not a MUTUAL_SPLIT', async () => {
  const prepared = await prepareDisputedContract('mutual-allocation-invalid');
  const { fixture } = prepared;

  await assert.rejects(
    settleMutualSplit(
      prisma,
      fixture.buyer.authentication,
      fixture.supplier.authentication,
      signMutualSettlement(prepared, '20.00000000', '4.00000000').input,
    ),
    (error) => error?.code === 'MUTUAL_SETTLEMENT_ALLOCATION_UNBALANCED',
  );

  await assert.rejects(
    settleMutualSplit(
      prisma,
      fixture.buyer.authentication,
      fixture.supplier.authentication,
      signMutualSettlement(prepared, '25.50000000', '0').input,
    ),
    (error) => error?.code === 'MUTUAL_SETTLEMENT_PARTIAL_SPLIT_REQUIRED',
  );
});

test('M8-02: idempotent replay and concurrent calls converge to one Agreement, Settlement and Ledger posting', async () => {
  const prepared = await prepareDisputedContract('mutual-concurrency');
  const { fixture } = prepared;
  const signed = signMutualSettlement(prepared, '12.75000000', '12.75000000');

  const [left, right] = await Promise.all([
    settleMutualSplit(
      prisma,
      fixture.buyer.authentication,
      fixture.supplier.authentication,
      signed.input,
    ),
    settleMutualSplit(
      prisma,
      fixture.buyer.authentication,
      fixture.supplier.authentication,
      signed.input,
    ),
  ]);

  assert.equal(left.settlement.id, right.settlement.id);
  assert.equal(left.agreement.id, right.agreement.id);
  assert.equal([left.replayed, right.replayed].filter(Boolean).length, 1);

  const replay = await settleMutualSplit(
    prisma,
    fixture.buyer.authentication,
    fixture.supplier.authentication,
    signed.input,
  );
  assert.equal(replay.replayed, true);
  assert.equal(replay.settlement.id, left.settlement.id);

  const [agreements, settlements, postings] = await Promise.all([
    prisma.$queryRaw`
      SELECT "id" FROM "mutual_settlement_agreements"
      WHERE "contractId" = ${fixture.formed.contract.id}
    `,
    prisma.$queryRaw`
      SELECT "id" FROM "settlements"
      WHERE "contractId" = ${fixture.formed.contract.id}
    `,
    prisma.$queryRaw`
      SELECT "id" FROM "ledger_transactions"
      WHERE "referenceType" = 'escrow_mutual_split'
        AND "referenceId" = ${fixture.formed.contract.id}
    `,
  ]);
  assert.equal(agreements.length, 1);
  assert.equal(settlements.length, 1);
  assert.equal(postings.length, 1);
});

test('M8-02: Settlement persistence failure rolls back Agreement, Ledger and terminal states', async () => {
  const prepared = await prepareDisputedContract('mutual-rollback');
  const { fixture } = prepared;
  const signed = signMutualSettlement(prepared, '15.50000000', '10.00000000');

  const buyerAvailable = await prisma.ledgerAccount.findFirstOrThrow({
    where: {
      principalId: fixture.buyer.principal.id,
      type: 'principal_available',
      currency: 'IWC',
    },
  });
  const buyerLocked = await prisma.ledgerAccount.findFirstOrThrow({
    where: {
      principalId: fixture.buyer.principal.id,
      type: 'principal_locked',
      currency: 'IWC',
    },
  });

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION iwantu_test_fail_mutual_split_settlement()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW."type" = 'mutual_split' THEN
        RAISE EXCEPTION 'IWANTU_TEST_MUTUAL_SPLIT_SETTLEMENT_FAILURE';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS iwantu_test_fail_mutual_split_settlement_trigger ON settlements',
  );
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER iwantu_test_fail_mutual_split_settlement_trigger
    BEFORE INSERT ON settlements
    FOR EACH ROW
    EXECUTE FUNCTION iwantu_test_fail_mutual_split_settlement()
  `);

  try {
    await assert.rejects(
      settleMutualSplit(
        prisma,
        fixture.buyer.authentication,
        fixture.supplier.authentication,
        signed.input,
      ),
      /IWANTU_TEST_MUTUAL_SPLIT_SETTLEMENT_FAILURE/,
    );

    const [agreements, settlements, postings, contractRows, escrow] = await Promise.all([
      prisma.$queryRaw`
        SELECT "id" FROM "mutual_settlement_agreements"
        WHERE "contractId" = ${fixture.formed.contract.id}
      `,
      prisma.$queryRaw`
        SELECT "id" FROM "settlements"
        WHERE "contractId" = ${fixture.formed.contract.id}
      `,
      prisma.$queryRaw`
        SELECT "id" FROM "ledger_transactions"
        WHERE "referenceType" = 'escrow_mutual_split'
          AND "referenceId" = ${fixture.formed.contract.id}
      `,
      prisma.$queryRaw`
        SELECT * FROM "contracts"
        WHERE "id" = ${fixture.formed.contract.id}
      `,
      prisma.escrow.findUniqueOrThrow({ where: { id: fixture.formed.escrow.id } }),
    ]);

    assert.equal(agreements.length, 0);
    assert.equal(settlements.length, 0);
    assert.equal(postings.length, 0);
    assert.equal(contractRows[0].lifecycleState, 'disputed');
    assert.equal(contractRows[0].closedAt, null);
    assert.equal(escrow.status, 'locked');
    assert.equal(escrow.releaseLedgerTransactionId, null);
    assert.equal(await ledgerBalance(buyerAvailable.id), 74.5);
    assert.equal(await ledgerBalance(buyerLocked.id), 25.5);
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS iwantu_test_fail_mutual_split_settlement_trigger ON settlements',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS iwantu_test_fail_mutual_split_settlement()',
    );
  }
});

test('M8-02: database blocks disputed Contract close and Escrow release without terminal mutual Settlement', async () => {
  const prepared = await prepareDisputedContract('mutual-bypass');
  const { fixture } = prepared;

  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "contracts"
      SET "lifecycleState" = 'closed'::"ContractLifecycleState",
          "closedAt" = NOW()
      WHERE "id" = ${fixture.formed.contract.id}
    `,
    /CONTRACT_CLOSE_REQUIRES_TERMINAL_SETTLEMENT/,
  );

  await assert.rejects(
    prisma.$executeRaw`
      UPDATE "escrows"
      SET "status" = 'released'::"EscrowStatus",
          "releasedAt" = NOW()
      WHERE "id" = ${fixture.formed.escrow.id}
    `,
    /ESCROW_RELEASE_REQUIRES_PROTOCOL_SETTLEMENT/,
  );
});


test('M8-03: terminal replay rejects changed allocation under the same idempotency key', async () => {
  const prepared = await prepareDisputedContract('mutual-replay-conflict');
  const { fixture } = prepared;
  const signed = signMutualSettlement(prepared, '15.50000000', '10.00000000');

  const settled = await settleMutualSplit(
    prisma,
    fixture.buyer.authentication,
    fixture.supplier.authentication,
    signed.input,
  );
  assert.equal(settled.replayed, false);

  await assert.rejects(
    settleMutualSplit(
      prisma,
      fixture.buyer.authentication,
      fixture.supplier.authentication,
      {
        ...signed.input,
        supplierAmount: '10.50000000',
        buyerRefundAmount: '15.00000000',
      },
    ),
    (error) => error?.code === 'MUTUAL_SETTLEMENT_IDEMPOTENCY_CONFLICT',
  );
});

test('M8-03: mutual settlement is a new commitment and requires live bilateral authority', async () => {
  const prepared = await prepareDisputedContract('mutual-live-authority');
  const { fixture } = prepared;
  const signed = signMutualSettlement(prepared, '15.50000000', '10.00000000');

  await prisma.agentIdentity.update({
    where: { id: fixture.supplier.agent.id },
    data: { status: 'suspended' },
  });

  await assert.rejects(
    settleMutualSplit(
      prisma,
      fixture.buyer.authentication,
      fixture.supplier.authentication,
      signed.input,
    ),
    (error) => error?.code === 'MUTUAL_SETTLEMENT_AGENT_NOT_ACTIVE',
  );

  const [agreements, settlements, postings, contractRows, escrow] = await Promise.all([
    prisma.$queryRaw`
      SELECT "id" FROM "mutual_settlement_agreements"
      WHERE "contractId" = ${fixture.formed.contract.id}
    `,
    prisma.$queryRaw`
      SELECT "id" FROM "settlements"
      WHERE "contractId" = ${fixture.formed.contract.id}
    `,
    prisma.$queryRaw`
      SELECT "id" FROM "ledger_transactions"
      WHERE "referenceType" = 'escrow_mutual_split'
        AND "referenceId" = ${fixture.formed.contract.id}
    `,
    prisma.$queryRaw`
      SELECT "lifecycleState" FROM "contracts"
      WHERE "id" = ${fixture.formed.contract.id}
    `,
    prisma.escrow.findUniqueOrThrow({ where: { id: fixture.formed.escrow.id } }),
  ]);
  assert.equal(agreements.length, 0);
  assert.equal(settlements.length, 0);
  assert.equal(postings.length, 0);
  assert.equal(contractRows[0].lifecycleState, 'disputed');
  assert.equal(escrow.status, 'locked');
});
