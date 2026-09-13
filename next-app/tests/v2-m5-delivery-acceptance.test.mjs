import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeliveryAcceptanceEvidence,
  hashDeliveryAcceptanceEvidence,
} from '../src/lib/signed-delivery-acceptance.mjs';

function baseInput(overrides = {}) {
  return {
    decisionIdempotencyKey: 'decision-idem-1',
    contractId: 'contract-1',
    effectiveContractHash: 'contract-hash-1',
    deliveryId: 'delivery-1',
    deliveryHash: 'delivery-hash-1',
    decision: 'accept',
    buyerPrincipalId: 'buyer-principal-1',
    buyerAgentIdentityId: 'buyer-agent-1',
    nonce: 'nonce-1',
    ...overrides,
  };
}

test('M5-02: acceptance evidence binds exact Contract, Delivery, Buyer and decision', () => {
  const evidence = buildDeliveryAcceptanceEvidence(baseInput());
  assert.equal(evidence.protocolVersion, 'iwantu-delivery-acceptance/0.1');
  assert.equal(evidence.contractId, 'contract-1');
  assert.equal(evidence.effectiveContractHash, 'contract-hash-1');
  assert.equal(evidence.deliveryId, 'delivery-1');
  assert.equal(evidence.deliveryHash, 'delivery-hash-1');
  assert.equal(evidence.decision, 'accept');
  assert.equal(evidence.reasonCode, null);
  assert.equal(evidence.reasonDetail, null);
  assert.equal(evidence.buyerPrincipalId, 'buyer-principal-1');
  assert.equal(evidence.buyerAgentIdentityId, 'buyer-agent-1');
});

test('M5-02: acceptance hash changes when immutable Delivery binding changes', () => {
  const baseline = hashDeliveryAcceptanceEvidence(baseInput());
  const changedDelivery = hashDeliveryAcceptanceEvidence(baseInput({ deliveryHash: 'delivery-hash-2' }));
  const changedDecision = hashDeliveryAcceptanceEvidence(baseInput({ decision: 'reject', reasonCode: 'INCOMPLETE' }));
  assert.notEqual(baseline, changedDelivery);
  assert.notEqual(baseline, changedDecision);
});

test('M5-02: rejection requires a structured baseline reason code', () => {
  const rejection = buildDeliveryAcceptanceEvidence(baseInput({
    decision: 'reject',
    reasonCode: 'CONSTRAINT_NOT_MET',
    reasonDetail: 'Output does not satisfy the declared schema constraint.',
  }));
  assert.equal(rejection.decision, 'reject');
  assert.equal(rejection.reasonCode, 'CONSTRAINT_NOT_MET');

  assert.throws(
    () => buildDeliveryAcceptanceEvidence(baseInput({ decision: 'reject' })),
    (error) => error?.code === 'ACCEPTANCE_INPUT_INVALID',
  );
  assert.throws(
    () => buildDeliveryAcceptanceEvidence(baseInput({ decision: 'reject', reasonCode: 'QUALITY_BAD' })),
    (error) => error?.code === 'ACCEPTANCE_REASON_INVALID',
  );
});

test('M5-02: accept cannot smuggle a rejection reason into signed evidence', () => {
  assert.throws(
    () => buildDeliveryAcceptanceEvidence(baseInput({ reasonCode: 'OTHER' })),
    (error) => error?.code === 'ACCEPTANCE_REASON_INVALID',
  );
});
