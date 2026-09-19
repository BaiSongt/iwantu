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
import {
  buildFullRefundSettlementEvidence,
  buildSupplierDefaultEvidence,
  defaultAndRefundContract,
  hashFullRefundSettlementEvidence,
  hashSupplierDefaultEvidence,
} from '../src/lib/supplier-default-refund.mjs';
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
    data: { name: `M6 Org ${suffix}`, type: orgType },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `M6 Agent ${suffix}` },
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
  const signingKeyId = `m6-signing-${suffix}`;
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
      mandateFamilyId: `m6-family-${suffix}`,
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
      payloadHash: sha256(`m6-mandate:${suffix}`),
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

async function createDefaultableContract(label, deliveryCommitmentSeconds = 1) {
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
    deliveryCommitmentSeconds,
    validUntil: new Date(now.getTime() + 60 * 60_000),
    termsPayload: { label, deliverables: [{ kind: 'artifact', format: 'json' }] },
    nonce: unique(`m6-offer-${label}`),
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
    allocationVersion: unique('m6-allocation'),
    amount: '100.00000000',
  });

  const formationIdempotencyKey = unique('m6-formation');
  const nonce = unique('m6-acceptance');
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

  return { buyer, supplier, issued, formed };
}

function signDelivery(fixture, now = new Date()) {
  const base = {
    deliveryIdempotencyKey: unique('m6-delivery'),
    contractId: fixture.formed.contract.id,
    effectiveContractHash: fixture.formed.contract.effectiveContractHash,
    deliverables: [{
      assetRef: `artifact:${unique('m6-output')}`,
      mediaType: 'application/json',
      contentHash: sha256(unique('m6-delivery-content')),
    }],
    evidence: [{ kind: 'test', value: 'passed' }],
    nonce: unique('m6-delivery-nonce'),
    mandateId: fixture.supplier.mandate.id,
    commandIssuedAt: new Date(now.getTime() - 1000),
    commandExpiresAt: new Date(now.getTime() + 5 * 60_000),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: fixture.supplier.signingKeyId,
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
    mandateId: fixture.supplier.mandate.id,
    payloadHash: deliveryHash,
    nonce: base.nonce,
    issuedAt: base.commandIssuedAt,
    expiresAt: base.commandExpiresAt,
    signingKeyId: base.signatureKeyId,
    signatureAlgorithm: base.signatureAlgorithm,
  });
  return {
    ...base,
    supplierSignature: signDigest(
      null,
      Buffer.from(hashEconomicCommandEvidence(command), 'hex'),
      fixture.supplier.privateKey,
    ).toString('base64url'),
  };
}

async function waitUntilDefaultDue(fixture, paddingMs = 150) {
  const deadline = fixture.formed.contract.activatedAt.getTime()
    + fixture.issued.revision.deliveryCommitmentSeconds * 1000;
  await delay(Math.max(0, deadline - Date.now() + paddingMs));
}

test('M6-01: SupplierDefault and FULL_REFUND evidence bind deterministic terminal facts', () => {
  const defaultEvidence = buildSupplierDefaultEvidence({
    contractId: 'contract-1',
    effectiveContractHash: 'contract-hash-1',
    supplierPrincipalId: 'supplier-principal-1',
    supplierAgentIdentityId: 'supplier-agent-1',
    deliveryDeadline: new Date('2026-09-19T00:00:00Z'),
    observedAt: new Date('2026-09-19T00:00:01Z'),
  });
  assert.equal(defaultEvidence.reasonCode, 'delivery_deadline_missed');
  assert.equal(defaultEvidence.protocol, 'iwantu.supplier-default.v0.1');
  assert.match(hashSupplierDefaultEvidence(defaultEvidence), /^[0-9a-f]{64}$/);

  const refundEvidence = buildFullRefundSettlementEvidence({
    contractId: 'contract-1',
    effectiveContractHash: 'contract-hash-1',
    supplierDefaultId: 'default-1',
    supplierDefaultHash: hashSupplierDefaultEvidence(defaultEvidence),
    buyerPrincipalId: 'buyer-principal-1',
    supplierPrincipalId: 'supplier-principal-1',
    supplierAgentIdentityId: 'supplier-agent-1',
    escrowId: 'escrow-1',
    amount: '25.50000000',
    currency: 'IWC',
    ledgerTransactionId: 'ledger-1',
    ledgerTransactionHash: 'ledger-hash-1',
  });
  assert.equal(refundEvidence.type, 'full_refund');
  assert.match(hashFullRefundSettlementEvidence(refundEvidence), /^[0-9a-f]{64}$/);
});

test('M6-01: Supplier Default fails closed before the contractual delivery deadline', async () => {
  const fixture = await createDefaultableContract('not-due');
  await assert.rejects(
    defaultAndRefundContract(prisma, {
      contractId: fixture.formed.contract.id,
      idempotencyKey: unique('m6-not-due'),
    }),
    (error) => error?.code === 'SUPPLIER_DEFAULT_NOT_DUE',
  );

  const defaults = await prisma.$queryRaw`
    SELECT "id" FROM "supplier_defaults"
    WHERE "contractId" = ${fixture.formed.contract.id}
  `;
  const settlements = await prisma.$queryRaw`
    SELECT "id" FROM "settlements"
    WHERE "contractId" = ${fixture.formed.contract.id}
  `;
  assert.equal(defaults.length, 0);
  assert.equal(settlements.length, 0);
  assert.equal(
    (await prisma.escrow.findUniqueOrThrow({ where: { id: fixture.formed.escrow.id } })).status,
    'locked',
  );
});

test('M6-01: missed delivery deadline atomically refunds Buyer and closes Contract exactly once', async () => {
  const fixture = await createDefaultableContract('atomic-refund');
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
  const beforeAvailable = await ledgerBalance(buyerAvailable.id);
  const beforeLocked = await ledgerBalance(buyerLocked.id);
  assert.equal(beforeAvailable, 74.5);
  assert.equal(beforeLocked, 25.5);

  await waitUntilDefaultDue(fixture);
  const idempotencyKey = unique('m6-refund');
  const result = await defaultAndRefundContract(prisma, {
    contractId: fixture.formed.contract.id,
    idempotencyKey,
  });

  assert.equal(result.replayed, false);
  assert.equal(result.supplierDefault.reasonCode, 'delivery_deadline_missed');
  assert.equal(result.settlement.type, 'full_refund');
  assert.equal(result.settlement.supplierDefaultId, result.supplierDefault.id);

  const [contractRows, escrow, defaults, settlements, refundPostings] = await Promise.all([
    prisma.$queryRaw`
      SELECT * FROM "contracts" WHERE "id" = ${fixture.formed.contract.id}
    `,
    prisma.escrow.findUniqueOrThrow({ where: { id: fixture.formed.escrow.id } }),
    prisma.$queryRaw`
      SELECT * FROM "supplier_defaults"
      WHERE "contractId" = ${fixture.formed.contract.id}
    `,
    prisma.$queryRaw`
      SELECT * FROM "settlements"
      WHERE "contractId" = ${fixture.formed.contract.id}
    `,
    prisma.$queryRaw`
      SELECT * FROM "ledger_transactions"
      WHERE "referenceType" = 'escrow_refund'
        AND "referenceId" = ${fixture.formed.contract.id}
    `,
  ]);

  assert.equal(contractRows[0].lifecycleState, 'closed');
  assert.ok(contractRows[0].closedAt);
  assert.equal(escrow.status, 'refunded');
  assert.equal(escrow.refundLedgerTransactionId, result.ledgerTransaction.id);
  assert.equal(defaults.length, 1);
  assert.equal(settlements.length, 1);
  assert.equal(refundPostings.length, 1);
  assert.equal(await ledgerBalance(buyerAvailable.id), 100);
  assert.equal(await ledgerBalance(buyerLocked.id), 0);

  const replay = await defaultAndRefundContract(prisma, {
    contractId: fixture.formed.contract.id,
    idempotencyKey,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.settlement.id, result.settlement.id);
});

test('M6-01: concurrent Supplier Default refunds converge to one terminal refund', async () => {
  const fixture = await createDefaultableContract('concurrent-refund');
  await waitUntilDefaultDue(fixture);
  const idempotencyKey = unique('m6-concurrent');

  const [left, right] = await Promise.all([
    defaultAndRefundContract(prisma, {
      contractId: fixture.formed.contract.id,
      idempotencyKey,
    }),
    defaultAndRefundContract(prisma, {
      contractId: fixture.formed.contract.id,
      idempotencyKey,
    }),
  ]);

  assert.equal(left.settlement.id, right.settlement.id);
  assert.equal([left.replayed, right.replayed].filter(Boolean).length, 1);

  const defaults = await prisma.$queryRaw`
    SELECT "id" FROM "supplier_defaults"
    WHERE "contractId" = ${fixture.formed.contract.id}
  `;
  const settlements = await prisma.$queryRaw`
    SELECT "id" FROM "settlements"
    WHERE "contractId" = ${fixture.formed.contract.id}
  `;
  const refunds = await prisma.$queryRaw`
    SELECT "id" FROM "ledger_transactions"
    WHERE "referenceType" = 'escrow_refund'
      AND "referenceId" = ${fixture.formed.contract.id}
  `;
  assert.equal(defaults.length, 1);
  assert.equal(settlements.length, 1);
  assert.equal(refunds.length, 1);
});

test('M6-01: database rejects direct Contract close or Escrow refund without terminal Settlement', async () => {
  const fixture = await createDefaultableContract('refund-bypass', 60);

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
      SET "status" = 'refunded'::"EscrowStatus",
          "refundedAt" = NOW()
      WHERE "id" = ${fixture.formed.escrow.id}
    `,
    /ESCROW_REFUND_REQUIRES_PROTOCOL_SETTLEMENT/,
  );

  const contractRows = await prisma.$queryRaw`
    SELECT "lifecycleState" FROM "contracts"
    WHERE "id" = ${fixture.formed.contract.id}
  `;
  assert.equal(contractRows[0].lifecycleState, 'active');
  assert.equal(
    (await prisma.escrow.findUniqueOrThrow({ where: { id: fixture.formed.escrow.id } })).status,
    'locked',
  );
});


test('M6-02: Contract without explicit delivery deadline cannot be classified as Supplier Default', async () => {
  const fixture = await createDefaultableContract('no-deadline', null);
  await assert.rejects(
    defaultAndRefundContract(prisma, {
      contractId: fixture.formed.contract.id,
      idempotencyKey: unique('m6-no-deadline'),
    }),
    (error) => error?.code === 'SUPPLIER_DEFAULT_REQUIRES_DELIVERY_DEADLINE',
  );
});

test('M6-02: protocol-valid Delivery prevents Supplier Default and full refund', async () => {
  const fixture = await createDefaultableContract('delivery-prevents-default', 2);
  const now = new Date();
  const delivery = signDelivery(fixture, now);
  const delivered = await submitSignedDelivery(
    prisma,
    fixture.supplier.authentication,
    delivery,
    { now },
  );
  assert.equal(delivered.contract.lifecycleState, 'acceptance_pending');

  await delay(2200);
  await assert.rejects(
    defaultAndRefundContract(prisma, {
      contractId: fixture.formed.contract.id,
      idempotencyKey: unique('m6-delivered-default'),
    }),
    (error) => error?.code === 'SUPPLIER_DEFAULT_REQUIRES_ACTIVE_CONTRACT',
  );

  const defaults = await prisma.$queryRaw`
    SELECT "id" FROM "supplier_defaults"
    WHERE "contractId" = ${fixture.formed.contract.id}
  `;
  const settlements = await prisma.$queryRaw`
    SELECT "id" FROM "settlements"
    WHERE "contractId" = ${fixture.formed.contract.id}
  `;
  assert.equal(defaults.length, 0);
  assert.equal(settlements.length, 0);
  assert.equal(
    (await prisma.escrow.findUniqueOrThrow({ where: { id: fixture.formed.escrow.id } })).status,
    'locked',
  );
});

test('M6-02: refund failure after Ledger posting rolls back SupplierDefault and all terminal state', async () => {
  const fixture = await createDefaultableContract('refund-rollback');
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
  await waitUntilDefaultDue(fixture);

  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION iwantu_test_fail_full_refund_settlement()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF NEW."type" = 'full_refund' THEN
        RAISE EXCEPTION 'IWANTU_TEST_FULL_REFUND_SETTLEMENT_FAILURE';
      END IF;
      RETURN NEW;
    END;
    $$;
  `);
  await prisma.$executeRawUnsafe(
    'DROP TRIGGER IF EXISTS iwantu_test_fail_full_refund_settlement_trigger ON settlements',
  );
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER iwantu_test_fail_full_refund_settlement_trigger
    BEFORE INSERT ON settlements
    FOR EACH ROW
    EXECUTE FUNCTION iwantu_test_fail_full_refund_settlement()
  `);

  try {
    await assert.rejects(
      defaultAndRefundContract(prisma, {
        contractId: fixture.formed.contract.id,
        idempotencyKey: unique('m6-refund-rollback'),
      }),
      /IWANTU_TEST_FULL_REFUND_SETTLEMENT_FAILURE/,
    );

    const [defaults, settlements, refundPostings, contractRows, escrow] = await Promise.all([
      prisma.$queryRaw`
        SELECT "id" FROM "supplier_defaults"
        WHERE "contractId" = ${fixture.formed.contract.id}
      `,
      prisma.$queryRaw`
        SELECT "id" FROM "settlements"
        WHERE "contractId" = ${fixture.formed.contract.id}
      `,
      prisma.$queryRaw`
        SELECT "id" FROM "ledger_transactions"
        WHERE "referenceType" = 'escrow_refund'
          AND "referenceId" = ${fixture.formed.contract.id}
      `,
      prisma.$queryRaw`
        SELECT * FROM "contracts"
        WHERE "id" = ${fixture.formed.contract.id}
      `,
      prisma.escrow.findUniqueOrThrow({ where: { id: fixture.formed.escrow.id } }),
    ]);

    assert.equal(defaults.length, 0);
    assert.equal(settlements.length, 0);
    assert.equal(refundPostings.length, 0);
    assert.equal(contractRows[0].lifecycleState, 'active');
    assert.equal(contractRows[0].closedAt, null);
    assert.equal(escrow.status, 'locked');
    assert.equal(escrow.refundLedgerTransactionId, null);
    assert.equal(await ledgerBalance(buyerAvailable.id), 74.5);
    assert.equal(await ledgerBalance(buyerLocked.id), 25.5);
  } finally {
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS iwantu_test_fail_full_refund_settlement_trigger ON settlements',
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS iwantu_test_fail_full_refund_settlement()',
    );
  }
});
