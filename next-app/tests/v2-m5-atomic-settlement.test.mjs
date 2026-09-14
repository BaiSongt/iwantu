import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSettlementEvidence,
  hashSettlementEvidence,
  settleAcceptedDelivery,
} from '../src/lib/atomic-settlement.mjs';

function settlementInput(overrides = {}) {
  return {
    contractId: 'contract-1',
    effectiveContractHash: 'contract-hash-1',
    deliveryId: 'delivery-1',
    deliveryHash: 'delivery-hash-1',
    acceptanceDecisionId: 'acceptance-1',
    acceptanceDecisionHash: 'acceptance-hash-1',
    acceptanceSource: 'buyer_signed',
    supplierPrincipalId: 'supplier-principal-1',
    supplierAgentIdentityId: 'supplier-agent-1',
    escrowId: 'escrow-1',
    amount: '25.50000000',
    currency: 'IWC',
    ledgerTransactionId: 'ledger-1',
    ledgerTransactionHash: 'ledger-hash-1',
    ...overrides,
  };
}

test('M5-03B: Settlement evidence binds Contract, latest Delivery, acceptance, Escrow and Ledger', () => {
  const evidence = buildSettlementEvidence(settlementInput());
  assert.equal(evidence.protocol, 'iwantu.settlement.v0.1');
  assert.equal(evidence.type, 'full_settlement');
  assert.equal(evidence.contractId, 'contract-1');
  assert.equal(evidence.deliveryId, 'delivery-1');
  assert.equal(evidence.acceptanceDecisionId, 'acceptance-1');
  assert.equal(evidence.acceptanceSource, 'buyer_signed');
  assert.equal(evidence.escrowId, 'escrow-1');
  assert.equal(evidence.ledgerTransactionId, 'ledger-1');
  assert.equal(evidence.amount, '25.50000000');
  assert.equal(evidence.currency, 'IWC');
});

test('M5-03B: Settlement hash changes for every terminal economic binding', () => {
  const baseline = hashSettlementEvidence(buildSettlementEvidence(settlementInput()));
  const changes = [
    { effectiveContractHash: 'contract-hash-2' },
    { deliveryHash: 'delivery-hash-2' },
    { acceptanceDecisionHash: 'acceptance-hash-2' },
    { acceptanceSource: 'auto_accept' },
    { escrowId: 'escrow-2' },
    { amount: '25.40000000' },
    { ledgerTransactionHash: 'ledger-hash-2' },
  ];
  for (const change of changes) {
    const changed = hashSettlementEvidence(buildSettlementEvidence(settlementInput(change)));
    assert.notEqual(baseline, changed);
  }
});

test('M5-03B: AUTO_ACCEPT and Buyer-signed ACCEPT share one terminal Settlement evidence shape', () => {
  const signed = buildSettlementEvidence(settlementInput({ acceptanceSource: 'buyer_signed' }));
  const automatic = buildSettlementEvidence(settlementInput({ acceptanceSource: 'auto_accept' }));
  assert.equal(signed.type, 'full_settlement');
  assert.equal(automatic.type, 'full_settlement');
  assert.notEqual(hashSettlementEvidence(signed), hashSettlementEvidence(automatic));
});

test('M5-03B: settlement entry point fails closed before touching persistence on malformed input', async () => {
  let persistenceTouched = false;
  const fakePrisma = {
    $queryRaw: async () => {
      persistenceTouched = true;
      return [];
    },
  };
  await assert.rejects(
    () => settleAcceptedDelivery(fakePrisma, { contractId: 'contract-1', idempotencyKey: '' }),
    (error) => error?.code === 'SETTLEMENT_INPUT_INVALID',
  );
  assert.equal(persistenceTouched, false);
});
