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
import { issueFirmOffer } from '../src/lib/offer-protocol.mjs';
import {
  buildEconomicCommandEvidence,
  hashEconomicCommandEvidence,
} from '../src/lib/signed-economic-command.mjs';
import {
  buildOfferWithdrawalEvidence,
  hashOfferWithdrawalEvidence,
  withdrawSignedFirmOffer,
} from '../src/lib/signed-offer-withdrawal.mjs';
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
    data: { name: `Withdrawal Org ${suffix}`, type: orgType },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `Withdrawal Agent ${suffix}` },
  });
  return { suffix, organization, principal, agent };
}

async function createSupplier(label) {
  const fixture = await createPrincipalAgent(label, 'supplier');
  const apiMaterial = createAgentApiCredentialMaterial();
  const apiCredential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: fixture.agent.id,
      kind: 'api',
      keyId: apiMaterial.keyId,
      prefix: apiMaterial.prefix,
      secretHash: apiMaterial.secretHash,
    },
  });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const signingKeyId = `withdraw-signing-${fixture.suffix}`;
  const signingCredential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: fixture.agent.id,
      kind: 'signing',
      keyId: signingKeyId,
      publicKeyJwk: publicKey.export({ format: 'jwk' }),
      algorithm: 'EdDSA',
    },
  });
  const mandatePayloadHash = sha256(`withdraw-mandate:${fixture.suffix}`);
  const mandate = await prisma.mandate.create({
    data: {
      mandateFamilyId: `withdraw-family-${fixture.suffix}`,
      version: 1,
      issuerPrincipalId: fixture.principal.id,
      subjectAgentIdentityId: fixture.agent.id,
      actionScopes: ['offer.withdraw'],
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
  const issueSnapshot = await prisma.authoritySnapshot.create({
    data: {
      principalId: fixture.principal.id,
      agentIdentityId: fixture.agent.id,
      credentialId: apiCredential.id,
      credentialKeyId: apiCredential.keyId,
      leafMandateId: mandate.id,
      mandateChain: [{ id: mandate.id, version: 1, payloadHash: mandatePayloadHash }],
      authorityChainHash: sha256(`withdraw-chain:${fixture.suffix}`),
      effectiveAuthority: { actionScopes: ['offer.withdraw'], capabilityScopes: ['*'] },
      requestEvidence: { action: 'offer.issue' },
      resolvedAction: 'offer.issue',
      resolvedAt: new Date(),
      evidenceHash: sha256(`withdraw-issue-snapshot:${fixture.suffix}`),
    },
  });
  const authentication = createV2AgentAuthenticationContext({
    principal: { id: fixture.principal.id, type: 'organization', status: 'active' },
    agent: { id: fixture.agent.id, name: fixture.agent.name, status: 'active' },
    credential: {
      id: apiCredential.id,
      keyId: apiCredential.keyId,
      kind: 'api',
      status: 'active',
    },
  });
  return {
    ...fixture,
    apiCredential,
    signingCredential,
    signingKeyId,
    privateKey,
    mandate,
    issueSnapshot,
    authentication,
  };
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
    capabilityRequirements: [],
  });
  await openTask(prisma, { taskId: created.task.id });
  return { buyer, task: created.task, revision: created.revision };
}

async function createActiveOffer(label, supplier) {
  const task = await createOpenTask(label);
  const issued = await issueFirmOffer(prisma, {
    taskId: task.task.id,
    supplierPrincipalId: supplier.principal.id,
    supplierAgentIdentityId: supplier.agent.id,
    priceAmount: '25.50000000',
    currency: 'IWC',
    deliveryCommitmentSeconds: 3600,
    validUntil: new Date(Date.now() + 3_600_000),
    termsPayload: { label },
    nonce: unique(`issue-${label}`),
    supplierAuthoritySnapshotId: supplier.issueSnapshot.id,
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: supplier.signingKeyId,
    supplierSignature: `historical-offer-signature-${supplier.suffix}`,
  });
  return { task, issued };
}

function signWithdrawal(supplier, issued, now = new Date(), overrides = {}) {
  const nonce = unique('withdraw-command');
  const base = {
    offerId: issued.offer.id,
    revision: issued.revision.revision,
    offerHash: issued.revision.offerHash,
    nonce,
    mandateId: supplier.mandate.id,
    commandIssuedAt: new Date(now.getTime() - 1000),
    commandExpiresAt: new Date(now.getTime() + 5 * 60_000),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: supplier.signingKeyId,
    ...overrides,
  };
  const withdrawalEvidence = buildOfferWithdrawalEvidence({
    offerId: base.offerId,
    revision: base.revision,
    offerHash: base.offerHash,
    supplierPrincipalId: supplier.principal.id,
    supplierAgentIdentityId: supplier.agent.id,
    nonce: base.nonce,
  });
  const withdrawalHash = hashOfferWithdrawalEvidence(withdrawalEvidence);
  const commandEvidence = buildEconomicCommandEvidence({
    action: 'offer.withdraw',
    principalId: supplier.principal.id,
    agentIdentityId: supplier.agent.id,
    mandateId: base.mandateId,
    payloadHash: withdrawalHash,
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
      supplierSignature: signDigest(
        null,
        Buffer.from(commandHash, 'hex'),
        supplier.privateKey,
      ).toString('base64url'),
    },
    withdrawalHash,
    commandHash,
  };
}

test('M3-06: signed withdrawal binds exact current Offer, live authority and immutable receipt', async () => {
  const supplier = await createSupplier('signed-withdraw');
  const { issued } = await createActiveOffer('signed-withdraw', supplier);
  const signed = signWithdrawal(supplier, issued);

  const result = await withdrawSignedFirmOffer(
    prisma,
    supplier.authentication,
    signed.input,
  );
  assert.equal(result.offer.status, 'withdrawn');
  assert.equal(result.commandHash, signed.commandHash);
  assert.equal(result.receipt.withdrawalHash, signed.withdrawalHash);
  assert.equal(result.receipt.offerHash, issued.revision.offerHash);
  assert.equal(result.authoritySnapshot.resolvedAction, 'offer.withdraw');
  assert.equal(result.authoritySnapshot.requestEvidence.payloadHash, signed.withdrawalHash);
  assert.equal(result.authoritySnapshot.requestEvidence.commandHash, signed.commandHash);

  const rows = await prisma.$queryRaw`
    SELECT * FROM "offer_withdrawal_receipts" WHERE "offerId" = ${issued.offer.id}
  `;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].receiptHash, result.receipt.receiptHash);
  assert.equal(rows[0].authoritySnapshotId, result.authoritySnapshot.id);

  const replay = await withdrawSignedFirmOffer(
    prisma,
    supplier.authentication,
    signed.input,
  );
  assert.equal(replay.offer.status, 'withdrawn');
  assert.equal(replay.receipt.receiptHash, result.receipt.receiptHash);

  await assert.rejects(
    prisma.$executeRaw`UPDATE "offer_withdrawal_receipts" SET "signingKeyId" = 'tampered' WHERE "id" = ${result.receipt.id}`,
  );
  await assert.rejects(
    prisma.$executeRaw`DELETE FROM "offer_withdrawal_receipts" WHERE "id" = ${result.receipt.id}`,
  );
});

test('M3-06: tampered withdrawal signature fails closed without changing Offer status', async () => {
  const supplier = await createSupplier('tampered-withdraw');
  const { issued } = await createActiveOffer('tampered-withdraw', supplier);
  const signed = signWithdrawal(supplier, issued);
  signed.input.supplierSignature = Buffer.from('forged-signature').toString('base64url');

  await assert.rejects(
    withdrawSignedFirmOffer(prisma, supplier.authentication, signed.input),
    (error) => {
      assert.equal(error.code, 'ECONOMIC_SIGNATURE_INVALID');
      return true;
    },
  );
  const offer = await prisma.offer.findUnique({ where: { id: issued.offer.id } });
  assert.equal(offer.status, 'active');
  const rows = await prisma.$queryRaw`
    SELECT "id" FROM "offer_withdrawal_receipts" WHERE "offerId" = ${issued.offer.id}
  `;
  assert.equal(rows.length, 0);
});

test('M3-06: withdrawal refuses stale revision/hash binding', async () => {
  const supplier = await createSupplier('stale-withdraw');
  const { issued } = await createActiveOffer('stale-withdraw', supplier);
  const signed = signWithdrawal(supplier, issued, new Date(), { revision: issued.revision.revision + 1 });

  await assert.rejects(
    withdrawSignedFirmOffer(prisma, supplier.authentication, signed.input),
    (error) => {
      assert.equal(error.code, 'OFFER_SUPERSEDED');
      return true;
    },
  );
});

test('M3-07: forged withdrawal receipt cannot unlock a direct Offer status transition', async () => {
  const supplier = await createSupplier('forged-receipt');
  const { issued } = await createActiveOffer('forged-receipt', supplier);
  const nonce = unique('forged-receipt-nonce');
  const withdrawalHash = sha256(unique('forged-withdrawal'));
  const commandHash = sha256(unique('forged-command'));
  const receiptHash = sha256(unique('forged-receipt-hash'));
  const receiptId = unique('forged-receipt-id');

  await assert.rejects(
    prisma.$executeRaw`
      INSERT INTO "offer_withdrawal_receipts" (
        "id", "offerId", "offerRevision", "offerHash", "withdrawalHash", "commandHash",
        "supplierPrincipalId", "supplierAgentIdentityId", "authoritySnapshotId", "nonce",
        "signatureAlgorithm", "signingKeyId", "supplierSignature", "receiptHash", "withdrawnAt"
      ) VALUES (
        ${receiptId}, ${issued.offer.id}, ${issued.revision.revision}, ${issued.revision.offerHash},
        ${withdrawalHash}, ${commandHash}, ${supplier.principal.id}, ${supplier.agent.id},
        ${supplier.issueSnapshot.id}, ${nonce}, 'EdDSA', ${supplier.signingKeyId},
        'forged-withdrawal-signature', ${receiptHash}, ${new Date()}
      )
    `,
  );

  const receipts = await prisma.$queryRaw`
    SELECT "id" FROM "offer_withdrawal_receipts" WHERE "offerId" = ${issued.offer.id}
  `;
  assert.equal(receipts.length, 0);

  await assert.rejects(
    prisma.offer.update({
      where: { id: issued.offer.id },
      data: { status: 'withdrawn' },
    }),
  );

  const offer = await prisma.offer.findUnique({ where: { id: issued.offer.id } });
  assert.equal(offer.status, 'active');
});
