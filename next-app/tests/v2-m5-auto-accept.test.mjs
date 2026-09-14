import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AutoAcceptProtocolError,
  buildAutoAcceptEvidence,
  calculateAutoAcceptDeadline,
  hashAutoAcceptEvidence,
  resolveAcceptanceTimeoutSeconds,
} from '../src/lib/auto-accept.mjs';

test('AUTO_ACCEPT defaults to the MVP 24 hour acceptance window', () => {
  assert.equal(resolveAcceptanceTimeoutSeconds({}), 86400);
  assert.equal(resolveAcceptanceTimeoutSeconds(null), 86400);

  const submittedAt = new Date('2026-09-14T00:00:00.000Z');
  assert.equal(
    calculateAutoAcceptDeadline(submittedAt, 86400).toISOString(),
    '2026-09-15T00:00:00.000Z',
  );
});

test('AUTO_ACCEPT uses the immutable Offer acceptance timeout when present', () => {
  const seconds = resolveAcceptanceTimeoutSeconds({ acceptanceTimeoutSeconds: 3600 });
  assert.equal(seconds, 3600);
  assert.equal(
    calculateAutoAcceptDeadline('2026-09-14T00:00:00.000Z', seconds).toISOString(),
    '2026-09-14T01:00:00.000Z',
  );
});

test('AUTO_ACCEPT rejects invalid or unbounded timeout policy', () => {
  for (const value of [0, 59, 604801, 1.5, 'not-a-number']) {
    assert.throws(
      () => resolveAcceptanceTimeoutSeconds({ acceptanceTimeoutSeconds: value }),
      (error) => error instanceof AutoAcceptProtocolError && error.code === 'AUTO_ACCEPT_POLICY_INVALID',
    );
  }
});

test('AUTO_ACCEPT evidence binds exact Contract, Delivery, Buyer and timeout deadline', () => {
  const evidence = buildAutoAcceptEvidence({
    contractId: 'ctr_1',
    effectiveContractHash: 'contract-hash',
    deliveryId: 'del_1',
    deliveryHash: 'delivery-hash',
    buyerPrincipalId: 'principal_buyer',
    buyerAgentIdentityId: 'agent_buyer',
    acceptanceTimeoutSeconds: 3600,
    autoAcceptDeadline: '2026-09-14T01:00:00.000Z',
  });

  assert.deepEqual(evidence, {
    protocolVersion: 'iwantu-auto-accept/0.1',
    contractId: 'ctr_1',
    effectiveContractHash: 'contract-hash',
    deliveryId: 'del_1',
    deliveryHash: 'delivery-hash',
    buyerPrincipalId: 'principal_buyer',
    buyerAgentIdentityId: 'agent_buyer',
    decision: 'accept',
    source: 'auto_accept',
    acceptanceTimeoutSeconds: 3600,
    autoAcceptDeadline: '2026-09-14T01:00:00.000Z',
  });

  const hash = hashAutoAcceptEvidence(evidence);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(
    hash,
    hashAutoAcceptEvidence({ ...evidence, deliveryHash: 'different-delivery-hash' }),
  );
  assert.notEqual(
    hash,
    hashAutoAcceptEvidence({ ...evidence, autoAcceptDeadline: '2026-09-14T02:00:00.000Z' }),
  );
});
