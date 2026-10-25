import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { settleAcceptedDelivery } from '../../src/lib/atomic-settlement.mjs';
import { issueGenesisCredit } from '../../src/lib/ledger/credit-foundation.mjs';
import { buildFirmOfferHash } from '../../src/lib/offer-protocol.mjs';
import { issueSignedFirmOffer } from '../../src/lib/signed-economic-command.mjs';
import { acceptSignedFirmOffer, buildOfferAcceptanceEvidence, hashOfferAcceptanceEvidence } from '../../src/lib/signed-offer-acceptance.mjs';
import { buildDeliveryEvidence, hashDeliveryEvidence, submitSignedDelivery } from '../../src/lib/signed-delivery.mjs';
import { buildDeliveryAcceptanceEvidence, decideSignedDelivery, hashDeliveryAcceptanceEvidence } from '../../src/lib/signed-delivery-acceptance.mjs';
import { defaultAndRefundContract } from '../../src/lib/supplier-default-refund.mjs';
import { buildMutualSettlementAgreementEvidence, hashMutualSettlementAgreementEvidence, settleMutualSplit } from '../../src/lib/mutual-settlement.mjs';
import { createTask, openTask } from '../../src/lib/task-protocol.mjs';
import { createActor, signCommand, unique } from './incentive-governance-fixtures.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');

// Adapt the shared real Ed25519 signer to the earlier M3-M8 command envelope.
function protocolSignature(actor, action, payloadHash, nonce = unique('observation-terminal-nonce')) {
  const signed = signCommand(actor, action, {}, { payloadHash, nonce });
  const evidence = signed.commandEvidence;
  return {
    mandateId: evidence.mandateId, nonce: evidence.nonce,
    commandIssuedAt: new Date(evidence.issuedAt), commandExpiresAt: new Date(evidence.expiresAt),
    signatureAlgorithm: evidence.signatureAlgorithm, signatureKeyId: evidence.signingKeyId,
    signature: signed.signature,
  };
}

async function formContract(prisma, label, type, options) {
  const buyer = options.buyer ?? await createActor(prisma, `observation-buyer-${label}`,
    ['offer.accept', 'delivery.accept', 'delivery.reject', 'settlement.mutual']);
  const supplier = options.supplier ?? await createActor(prisma, `observation-supplier-${label}`,
    ['offer.issue', 'delivery.submit', 'settlement.mutual']);
  const task = await createTask(prisma, {
    issuerPrincipalId: buyer.principal.id, issuerAgentIdentityId: buyer.agent.id,
    protocolPayload: {
      objective: `Observation terminal ${label}`, inputs: [{ kind: 'asset_ref', ref: unique('observation-input') }],
      expectedOutputs: [{ kind: 'artifact', schema: 'urn:iwantu:r8:observation:output' }],
    },
    workPayload: { constraints: { deterministic: true } },
    marketPayload: { budget: { currency: 'IWC', maxAmount: '500.00000000' } },
    trustPayload: { requiredReputation: { mode: 'insufficient_evidence_allowed' } },
    policyPayload: { acceptancePolicy: { mode: 'REQUESTER_ACCEPTANCE' } }, capabilityRequirements: [],
  });
  await openTask(prisma, { taskId: task.task.id });
  const now = new Date();
  const offer = {
    taskId: task.task.id, priceAmount: '25.50000000', currency: 'IWC',
    deliveryCommitmentSeconds: type === 'full_refund' ? 1 : 3600,
    validUntil: new Date(now.getTime() + 60 * 60_000),
    termsPayload: { label, deliverables: [{ kind: 'artifact', format: 'json' }] }, nonce: unique('observation-offer'),
  };
  const offerHash = buildFirmOfferHash({
    ...offer, supplierPrincipalId: supplier.principal.id, supplierAgentIdentityId: supplier.agent.id,
    taskRevision: task.revision.revision, taskHash: task.revision.contentHash, offerRevision: 1,
  }, now);
  const signedOffer = protocolSignature(supplier, 'offer.issue', offerHash, offer.nonce);
  const issued = await issueSignedFirmOffer(prisma, supplier.authentication, {
    ...offer, ...signedOffer, supplierSignature: signedOffer.signature,
  }, { now });
  await issueGenesisCredit(prisma, {
    principalId: buyer.principal.id, allocationVersion: unique('observation-terminal-genesis'), amount: '100.00000000',
  });
  const acceptance = {
    formationIdempotencyKey: unique('observation-terminal-contract'), taskId: task.task.id,
    taskRevision: task.revision.revision, taskHash: task.revision.contentHash,
    offerId: issued.offer.id, offerRevision: issued.revision.revision, offerHash: issued.revision.offerHash,
    buyerPrincipalId: buyer.principal.id, buyerAgentIdentityId: buyer.agent.id,
    supplierPrincipalId: supplier.principal.id, priceAmount: issued.revision.priceAmount.toFixed(),
    currency: 'IWC', nonce: unique('observation-terminal-acceptance'),
  };
  const signedAcceptance = protocolSignature(buyer, 'offer.accept',
    hashOfferAcceptanceEvidence(buildOfferAcceptanceEvidence(acceptance)), acceptance.nonce);
  const formed = await acceptSignedFirmOffer(prisma, buyer.authentication, {
    ...acceptance, ...signedAcceptance, buyerSignature: signedAcceptance.signature,
  });
  return { buyer, supplier, task, issued, formed, contract: formed.contract };
}

async function decideDelivery(prisma, fixture, decisionType) {
  const { buyer, supplier, contract } = fixture;
  const delivery = {
    deliveryIdempotencyKey: unique('observation-terminal-delivery'), contractId: contract.id,
    effectiveContractHash: contract.effectiveContractHash,
    deliverables: [{ assetRef: unique('observation-output'), mediaType: 'application/json', contentHash: hash(unique('content')) }],
    evidence: [{ kind: 'test', value: 'delivered for terminal settlement' }], nonce: unique('observation-delivery'),
  };
  const deliveryHash = hashDeliveryEvidence(buildDeliveryEvidence({
    ...delivery, acceptedOfferRevisionId: contract.acceptedOfferRevisionId, sequence: 1,
    supplierPrincipalId: supplier.principal.id, supplierAgentIdentityId: supplier.agent.id,
  }));
  const signedDelivery = protocolSignature(supplier, 'delivery.submit', deliveryHash, delivery.nonce);
  const delivered = await submitSignedDelivery(prisma, supplier.authentication, {
    ...delivery, ...signedDelivery, supplierSignature: signedDelivery.signature,
  });
  const decision = {
    decisionIdempotencyKey: unique('observation-terminal-decision'), contractId: contract.id,
    effectiveContractHash: contract.effectiveContractHash,
    deliveryId: delivered.delivery.id, deliveryHash: delivered.delivery.deliveryHash,
    decision: decisionType,
    ...(decisionType === 'reject' ? { reasonCode: 'INCOMPLETE', reasonDetail: 'Observation bilateral settlement fixture' } : {}),
    buyerPrincipalId: buyer.principal.id, buyerAgentIdentityId: buyer.agent.id, nonce: unique('observation-rejection'),
  };
  const signedDecision = protocolSignature(buyer, `delivery.${decisionType}`,
    hashDeliveryAcceptanceEvidence(buildDeliveryAcceptanceEvidence(decision)), decision.nonce);
  const decided = await decideSignedDelivery(prisma, buyer.authentication, {
    ...decision, ...signedDecision, buyerSignature: signedDecision.signature,
  });
  assert.equal(decided.contract.lifecycleState, decisionType === 'reject' ? 'disputed' : 'acceptance_pending');
  if (decisionType === 'reject') assert.ok(decided.dispute);
  return { delivered, decision: decided };
}

// Every terminal fact crosses the actual M3-M8 writers and their SQL gates.
// No Settlement, terminal Ledger or M9 evidence is inserted by this fixture.
export async function createObservationTerminal(prisma, label, type, options = {}) {
  assert.ok(['full_settlement', 'full_refund', 'mutual_split'].includes(type), 'Unsupported observation terminal fixture type');
  const fixture = await formContract(prisma, label, type, options);
  if (type === 'full_refund') {
    const deadline = fixture.contract.activatedAt.getTime() + 1000;
    const waitMs = Math.max(0, deadline + 100 - Date.now());
    assert.ok(waitMs <= 1200, 'One-second fixture deadline must use the real clock');
    if (waitMs) await delay(waitMs);
    const refunded = await defaultAndRefundContract(prisma, {
      contractId: fixture.contract.id, idempotencyKey: unique('observation-terminal-refund'),
    });
    assert.equal(refunded.settlement.type, 'full_refund');
    return { ...fixture, ...refunded };
  }
  if (type === 'full_settlement') {
    const { delivered, decision: accepted } = await decideDelivery(prisma, fixture, 'accept');
    const settled = await settleAcceptedDelivery(prisma, {
      contractId: fixture.contract.id, idempotencyKey: unique('observation-terminal-settlement'),
    });
    assert.equal(settled.settlement.type, 'full_settlement');
    return { ...fixture, delivered, accepted, ...settled };
  }
  const { delivered, decision: rejected } = await decideDelivery(prisma, fixture, 'reject');
  const allocation = { grossAmount: '25.50000000', supplierAmount: '15.50000000', buyerRefundAmount: '10.00000000', currency: 'IWC' };
  const evidence = buildMutualSettlementAgreementEvidence({
    ...allocation, contractId: fixture.contract.id, effectiveContractHash: fixture.contract.effectiveContractHash,
    disputeId: rejected.dispute.id, disputeHash: rejected.dispute.disputeHash,
    buyerPrincipalId: fixture.buyer.principal.id, buyerAgentIdentityId: fixture.buyer.agent.id,
    supplierPrincipalId: fixture.supplier.principal.id, supplierAgentIdentityId: fixture.supplier.agent.id,
  });
  const agreementHash = hashMutualSettlementAgreementEvidence(evidence);
  const party = (actor, counterparty) => ({
    ...protocolSignature(actor, 'settlement.mutual', agreementHash),
    signingKeyId: actor.signingKeyId, counterpartyPrincipalId: counterparty.principal.id,
  });
  const settled = await settleMutualSplit(prisma, fixture.buyer.authentication, fixture.supplier.authentication, {
    contractId: fixture.contract.id, idempotencyKey: unique('observation-terminal-split'),
    supplierAmount: allocation.supplierAmount, buyerRefundAmount: allocation.buyerRefundAmount,
    buyer: party(fixture.buyer, fixture.supplier), supplier: party(fixture.supplier, fixture.buyer),
  });
  assert.equal(settled.settlement.type, 'mutual_split');
  return { ...fixture, delivered, rejected, ...settled };
}
