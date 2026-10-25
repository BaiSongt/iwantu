import { createHash, generateKeyPairSync, sign as signDigest } from 'node:crypto';
import { createAgentApiCredentialMaterial } from '../../src/lib/agent-auth-core.mjs';
import { createV2AgentAuthenticationContext } from '../../src/lib/agent-auth-context-core.mjs';
import { settleAcceptedDelivery } from '../../src/lib/atomic-settlement.mjs';
import { sha256Evidence } from '../../src/lib/authority/authority-snapshot.mjs';
import { issueGenesisCredit } from '../../src/lib/ledger/credit-foundation.mjs';
import { buildFirmOfferHash } from '../../src/lib/offer-protocol.mjs';
import { buildEconomicCommandEvidence, hashEconomicCommandEvidence, issueSignedFirmOffer } from '../../src/lib/signed-economic-command.mjs';
import { acceptSignedFirmOffer, buildOfferAcceptanceEvidence, hashOfferAcceptanceEvidence } from '../../src/lib/signed-offer-acceptance.mjs';
import { buildDeliveryEvidence, hashDeliveryEvidence, submitSignedDelivery } from '../../src/lib/signed-delivery.mjs';
import { buildDeliveryAcceptanceEvidence, decideSignedDelivery, hashDeliveryAcceptanceEvidence } from '../../src/lib/signed-delivery-acceptance.mjs';
import { createTask, openTask } from '../../src/lib/task-protocol.mjs';

export const unique = (label) => `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const hash = (value) => createHash('sha256').update(value).digest('hex');

export async function createActor(prisma, label, actionScopes, economicLimits = {
  singleContract: '1000.00000000', currency: 'IWC',
}) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({ data: { name: suffix, type: 'supplier' } });
  const principal = await prisma.principal.create({ data: { type: 'organization', organizationId: organization.id } });
  const agent = await prisma.agentIdentity.create({ data: { principalId: principal.id, name: suffix } });
  const material = createAgentApiCredentialMaterial();
  const apiCredential = await prisma.agentCredential.create({ data: {
    agentIdentityId: agent.id, kind: 'api', keyId: material.keyId,
    prefix: material.prefix, secretHash: material.secretHash,
  } });
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const publicKeyJwk = publicKey.export({ format: 'jwk' });
  const signingKeyId = unique('r8-signing-key');
  const signingCredential = await prisma.agentCredential.create({ data: {
    agentIdentityId: agent.id, kind: 'signing', keyId: signingKeyId, publicKeyJwk, algorithm: 'EdDSA',
  } });
  const mandate = await prisma.mandate.create({ data: {
    mandateFamilyId: unique('r8-family'), version: 1,
    issuerPrincipalId: principal.id, subjectAgentIdentityId: agent.id,
    actionScopes, capabilityScopes: ['*'], economicLimits, resourcePolicy: {},
    dataPolicy: { rawDataAccess: false }, counterpartyPolicy: {},
    validFrom: new Date(Date.now() - 60_000), validUntil: new Date(Date.now() + 86_400_000),
    delegationAllowed: false, maxDelegationDepth: 0,
    payloadHash: hash(suffix), signatureAlgorithm: 'EdDSA',
    signatureKeyId: unique('principal-key'), signature: unique('fixture-principal-signature'),
  } });
  const authentication = createV2AgentAuthenticationContext({
    principal: { id: principal.id, type: 'organization', status: 'active' },
    agent: { id: agent.id, name: agent.name, status: 'active' },
    credential: { id: apiCredential.id, keyId: apiCredential.keyId, kind: 'api', status: 'active' },
  });
  return { principal, agent, apiCredential, rawApiToken: material.rawToken,
    signingCredential, publicKeyJwk, privateKey, signingKeyId, mandate, authentication };
}

export function signCommand(actor, action, payload, overrides = {}) {
  const now = new Date();
  const commandEvidence = buildEconomicCommandEvidence({
    action, principalId: actor.principal.id, agentIdentityId: actor.agent.id,
    mandateId: actor.mandate.id, payloadHash: sha256Evidence(payload), nonce: unique('r8-nonce'),
    issuedAt: new Date(now.getTime() - 1000), expiresAt: new Date(now.getTime() + 5 * 60_000),
    signingKeyId: actor.signingKeyId, signatureAlgorithm: 'EdDSA', ...overrides,
  });
  const signature = signDigest(null, Buffer.from(hashEconomicCommandEvidence(commandEvidence), 'hex'), actor.privateKey)
    .toString('base64url');
  return { commandEvidence, signature };
}

function legacySignature(actor, action, payloadHash, nonce, now) {
  const commandIssuedAt = new Date(now.getTime() - 1000);
  const commandExpiresAt = new Date(now.getTime() + 5 * 60_000);
  const command = buildEconomicCommandEvidence({
    action, principalId: actor.principal.id, agentIdentityId: actor.agent.id,
    mandateId: actor.mandate.id, payloadHash, nonce, issuedAt: commandIssuedAt,
    expiresAt: commandExpiresAt, signingKeyId: actor.signingKeyId, signatureAlgorithm: 'EdDSA',
  });
  return {
    mandateId: actor.mandate.id, nonce, commandIssuedAt, commandExpiresAt,
    signatureAlgorithm: 'EdDSA', signatureKeyId: actor.signingKeyId,
    signature: signDigest(null, Buffer.from(hashEconomicCommandEvidence(command), 'hex'), actor.privateKey)
      .toString('base64url'),
  };
}

// Reuse the signed M3-M5 protocol boundary: no fabricated Settlement rows.
export async function createTerminalSettlement(prisma, label) {
  const buyer = await createActor(prisma, `r8-buyer-${label}`, ['offer.accept', 'delivery.accept']);
  const supplier = await createActor(prisma, `r8-supplier-${label}`, ['offer.issue', 'delivery.submit']);
  const task = await createTask(prisma, {
    issuerPrincipalId: buyer.principal.id, issuerAgentIdentityId: buyer.agent.id,
    protocolPayload: {
      objective: `R8 fixture ${label}`, inputs: [{ kind: 'asset_ref', ref: unique('asset') }],
      expectedOutputs: [{ kind: 'artifact', schema: 'urn:iwantu:r8:test:output' }],
    },
    workPayload: { constraints: { deterministic: true } },
    marketPayload: { budget: { currency: 'IWC', maxAmount: '500.00000000' } },
    trustPayload: { requiredReputation: { mode: 'insufficient_evidence_allowed' } },
    policyPayload: { acceptancePolicy: { mode: 'REQUESTER_ACCEPTANCE' } }, capabilityRequirements: [],
  });
  await openTask(prisma, { taskId: task.task.id });
  const now = new Date();
  const offerInput = {
    taskId: task.task.id, priceAmount: '25.50000000', currency: 'IWC',
    deliveryCommitmentSeconds: 3600, validUntil: new Date(now.getTime() + 60 * 60_000),
    termsPayload: { label, deliverables: [{ kind: 'artifact', format: 'json' }] }, nonce: unique('offer'),
  };
  const offerHash = buildFirmOfferHash({
    ...offerInput, supplierPrincipalId: supplier.principal.id, supplierAgentIdentityId: supplier.agent.id,
    taskRevision: task.revision.revision, taskHash: task.revision.contentHash, offerRevision: 1,
  }, now);
  const offerSignature = legacySignature(supplier, 'offer.issue', offerHash, offerInput.nonce, now);
  const issued = await issueSignedFirmOffer(prisma, supplier.authentication, {
    ...offerInput, ...offerSignature, supplierSignature: offerSignature.signature,
  }, { now });
  await issueGenesisCredit(prisma, {
    principalId: buyer.principal.id, allocationVersion: unique('r8-genesis'), amount: '100.00000000',
  });
  const acceptance = {
    formationIdempotencyKey: unique('r8-contract'), taskId: task.task.id,
    taskRevision: task.revision.revision, taskHash: task.revision.contentHash,
    offerId: issued.offer.id, offerRevision: issued.revision.revision, offerHash: issued.revision.offerHash,
    buyerPrincipalId: buyer.principal.id, buyerAgentIdentityId: buyer.agent.id,
    supplierPrincipalId: supplier.principal.id, priceAmount: issued.revision.priceAmount.toFixed(),
    currency: 'IWC', nonce: unique('acceptance'),
  };
  const acceptanceSignature = legacySignature(buyer, 'offer.accept',
    hashOfferAcceptanceEvidence(buildOfferAcceptanceEvidence(acceptance)), acceptance.nonce, now);
  const formed = await acceptSignedFirmOffer(prisma, buyer.authentication, {
    ...acceptance, ...acceptanceSignature, buyerSignature: acceptanceSignature.signature,
  }, { now });

  const delivery = {
    deliveryIdempotencyKey: unique('r8-delivery'), contractId: formed.contract.id,
    effectiveContractHash: formed.contract.effectiveContractHash,
    deliverables: [{ assetRef: unique('artifact'), mediaType: 'application/json', contentHash: hash(unique('content')) }],
    evidence: [{ kind: 'test', value: 'delivered' }], nonce: unique('delivery'),
  };
  const deliveryHash = hashDeliveryEvidence(buildDeliveryEvidence({
    ...delivery, acceptedOfferRevisionId: formed.contract.acceptedOfferRevisionId, sequence: 1,
    supplierPrincipalId: supplier.principal.id, supplierAgentIdentityId: supplier.agent.id,
  }));
  const deliverySignature = legacySignature(supplier, 'delivery.submit', deliveryHash, delivery.nonce, new Date());
  const delivered = await submitSignedDelivery(prisma, supplier.authentication, {
    ...delivery, ...deliverySignature, supplierSignature: deliverySignature.signature,
  });
  const decision = {
    decisionIdempotencyKey: unique('r8-decision'), contractId: formed.contract.id,
    effectiveContractHash: formed.contract.effectiveContractHash,
    deliveryId: delivered.delivery.id, deliveryHash: delivered.delivery.deliveryHash,
    decision: 'accept', buyerPrincipalId: buyer.principal.id, buyerAgentIdentityId: buyer.agent.id,
    nonce: unique('decision'),
  };
  const decisionSignature = legacySignature(buyer, 'delivery.accept',
    hashDeliveryAcceptanceEvidence(buildDeliveryAcceptanceEvidence(decision)), decision.nonce, new Date());
  await decideSignedDelivery(prisma, buyer.authentication, {
    ...decision, ...decisionSignature, buyerSignature: decisionSignature.signature,
  });
  const settled = await settleAcceptedDelivery(prisma, {
    contractId: formed.contract.id, idempotencyKey: unique('r8-terminal'),
  });
  return { buyer, supplier, contract: formed.contract, ...settled };
}
