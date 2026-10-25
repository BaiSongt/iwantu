import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Evidence } from '../src/lib/authority/authority-snapshot.mjs';
import {
  buildIncentiveObservation,
  IncentiveObservationError,
  normalizeIncentiveObservationInput,
} from '../src/lib/integrity/incentive-observation.mjs';

const input = () => ({
  programId: 'program-1', windowStart: '2026-10-01T00:00:00.000Z', windowEnd: '2026-11-01T00:00:00.000Z',
});
const record = (index = 1, changes = {}) => ({
  awardId: sha256Evidence(['award', index]), programId: 'program-1',
  policyHash: 'a'.repeat(64), policyVersion: 'v1',
  settlementId: `settlement-${index}`, settlementHash: sha256Evidence(['settlement', index]),
  settlementType: 'full_settlement', settlementCreatedAt: '2026-09-30T23:00:00.000Z',
  beneficiaryRole: 'supplier', awardSlot: 'completion', beneficiaryPrincipalId: 'principal-b',
  counterpartyPrincipalId: 'principal-a', amountIwc: '0.00000001', settlementGrossIwc: '10.00000000',
  ledgerTransactionId: `ledger-${index}`, ledgerTransactionHash: sha256Evidence(['ledger', index]),
  receiptHash: sha256Evidence(['receipt', index]), authorizationId: sha256Evidence(['authorization', index]),
  postedAt: '2026-10-25T12:00:00.000Z', policyRevokedAt: null, ...changes,
});
const observe = (records = [], unboundPostedCandidateCount = 0, overrides = {}) =>
  buildIncentiveObservation({ ...input(), ...overrides }, { records, unboundPostedCandidateCount });
const rejects = (fn, code = 'R8_OBSERVATION_INVALID') => assert.throws(fn,
  (error) => error instanceof IncentiveObservationError && error.code === code);

test('R8 observation: explicit UTC windows are strict, half-open, cloned and bounded at 31 days', () => {
  const start = new Date(input().windowStart);
  const end = new Date(input().windowEnd);
  const normalized = normalizeIncentiveObservationInput({ ...input(), windowStart: start, windowEnd: end });
  assert.deepEqual(normalized, { programId: 'program-1', windowStart: start, windowEnd: end });
  assert.notEqual(normalized.windowStart, start);
  assert.notEqual(normalized.windowEnd, end);
  start.setUTCFullYear(2000);
  assert.equal(normalized.windowStart.toISOString(), input().windowStart);
  for (const patch of [
    { windowStart: undefined }, { windowEnd: undefined }, { windowStart: new Date('invalid') },
    { windowStart: '2026-10-01T00:00:00Z' }, { windowStart: '2026-10-01T00:00:00.000+00:00' },
    { windowStart: '2026-02-30T00:00:00.000Z' }, { windowStart: 0 }, { windowEnd: input().windowStart },
    { windowStart: input().windowEnd }, { windowEnd: '2026-11-01T00:00:00.001Z' },
    { programId: 'program:1' }, { programId: ' program-1' }, { limit: 500 }, { observedAt: input().windowEnd },
  ]) rejects(() => normalizeIncentiveObservationInput({ ...input(), ...patch }), 'R8_INPUT_INVALID');
  for (const value of [null, [], {}, Object.create(null)]) {
    rejects(() => normalizeIncentiveObservationInput(value), 'R8_INPUT_INVALID');
  }
  for (const field of Object.keys(input())) {
    const value = input();
    delete value[field];
    rejects(() => normalizeIncentiveObservationInput(value), 'R8_INPUT_INVALID');
  }
});

test('R8 observation: empty and partial results expose attribution separately from risk classification', () => {
  const empty = observe();
  assert.deepEqual(empty, {
    protocol: 'iwantu.incentive-observation/0.1', programId: 'program-1',
    observationWindow: { start: input().windowStart, endExclusive: input().windowEnd }, records: [],
    attribution: { state: 'empty', verifiedAwardCount: 0, unboundPostedCandidateCount: 0, legacyAttribution: 'unavailable' },
    metrics: { verifiedAwardCount: 0, distinctRewardedSettlementCount: 0, beneficiaryPrincipalCount: 0,
      totalAwardIwc: '0.00000000', totalRewardedSettlementGrossIwc: '0.00000000' },
    byBeneficiary: [], evidenceFingerprint: 'ec608f8b7a28418a0e9e7ead95ee8e19ce18a4a33f7428100800a4e7b76a8784',
    riskAssessment: { state: 'not_evaluated', reason: 'rule_thresholds_not_frozen' },
    automaticPunishmentApplied: false, capitalLineageTraced: false,
  });
  const partial = observe([], 2);
  assert.equal(partial.attribution.state, 'partial');
  assert.equal(partial.attribution.unboundPostedCandidateCount, 2);
  assert.deepEqual(partial.metrics, empty.metrics);
  assert.notEqual(partial.evidenceFingerprint, empty.evidenceFingerprint);
  assert.equal(observe([record()]).attribution.state, 'verified');
  assert.equal(observe([record()], 1).attribution.state, 'partial');
});

test('R8 observation: global and Principal settlement denominators survive roles, slots and policy versions', () => {
  const first = record(1, { amountIwc: '0.10000000' });
  const bonus = record(2, { ...first, awardId: record(2).awardId,
    ledgerTransactionId: 'ledger-2', ledgerTransactionHash: record(2).ledgerTransactionHash,
    receiptHash: record(2).receiptHash, authorizationId: record(2).authorizationId,
    amountIwc: '0.20000000', awardSlot: 'bonus', policyVersion: 'v2', policyHash: 'b'.repeat(64) });
  const buyer = record(3, { settlementId: first.settlementId, settlementHash: first.settlementHash,
    beneficiaryRole: 'buyer', beneficiaryPrincipalId: 'principal-a', counterpartyPrincipalId: 'principal-b',
    amountIwc: '0.40000000' });
  const second = record(4, { counterpartyPrincipalId: 'principal-c', amountIwc: '0.80000000',
    settlementGrossIwc: '20.00000000' });
  const selfSupplier = record(5, { counterpartyPrincipalId: 'principal-b', amountIwc: '1.60000000',
    settlementGrossIwc: '30.00000000' });
  const selfBuyer = record(6, { settlementId: selfSupplier.settlementId, settlementHash: selfSupplier.settlementHash,
    beneficiaryRole: 'buyer', counterpartyPrincipalId: 'principal-b', amountIwc: '3.20000000',
    settlementGrossIwc: '30.00000000' });
  const result = observe([selfBuyer, bonus, second, buyer, selfSupplier, first]);
  assert.deepEqual(result.metrics, {
    verifiedAwardCount: 6, distinctRewardedSettlementCount: 3, beneficiaryPrincipalCount: 2,
    totalAwardIwc: '6.30000000', totalRewardedSettlementGrossIwc: '60.00000000',
  });
  assert.deepEqual(result.byBeneficiary.map((row) => row.principalId), ['principal-a', 'principal-b']);
  const beneficiary = result.byBeneficiary[1];
  assert.deepEqual(beneficiary, {
    principalId: 'principal-b', verifiedAwardCount: 5, distinctRewardedSettlementCount: 3,
    totalAwardIwc: '5.90000000', samePrincipalRewardedSettlementCount: 1,
    independentCounterpartyPrincipalCount: 2, topCounterpartySettlementCount: 1,
    topCounterpartySettlementShare: '0.33333333', policyHashes: ['a'.repeat(64), 'b'.repeat(64)],
    roleSlotBreakdown: [
      { beneficiaryRole: 'buyer', awardSlot: 'completion', verifiedAwardCount: 1,
        distinctRewardedSettlementCount: 1, totalAwardIwc: '3.20000000' },
      { beneficiaryRole: 'supplier', awardSlot: 'bonus', verifiedAwardCount: 1,
        distinctRewardedSettlementCount: 1, totalAwardIwc: '0.20000000' },
      { beneficiaryRole: 'supplier', awardSlot: 'completion', verifiedAwardCount: 3,
        distinctRewardedSettlementCount: 3, totalAwardIwc: '2.50000000' },
    ],
  });
});

test('R8 observation: exact BigInt totals exceed individual Decimal storage safely and ratios never round up', () => {
  const maximum = '9999999999999999999999999999.99999999';
  const large = observe([record(1, { amountIwc: maximum, settlementGrossIwc: maximum }),
    record(2, { amountIwc: '0.00000001', settlementGrossIwc: '0.00000001' })]);
  assert.equal(large.metrics.totalAwardIwc, '10000000000000000000000000000.00000000');
  assert.equal(large.metrics.totalRewardedSettlementGrossIwc, '10000000000000000000000000000.00000000');
  const result = observe([record(1), record(2), record(3, { counterpartyPrincipalId: 'principal-c' })]);
  assert.equal(result.byBeneficiary[0].topCounterpartySettlementCount, 2);
  assert.equal(result.byBeneficiary[0].topCounterpartySettlementShare, '0.66666666');
  const self = observe([record(1, { counterpartyPrincipalId: 'principal-b' })]).byBeneficiary[0];
  assert.equal(self.independentCounterpartyPrincipalCount, 0);
  assert.equal(self.samePrincipalRewardedSettlementCount, 1);
  assert.equal(self.topCounterpartySettlementShare, '1.00000000');
});

test('R8 observation: source order and object order cannot change the safe output or evidence fingerprint', () => {
  const records = [record(2), record(1, { postedAt: '2026-10-25T11:59:59.999Z' }), record(3)];
  const original = structuredClone(records);
  const expected = observe(records, 2);
  const shuffled = records.toReversed().map((value) => Object.fromEntries(Object.entries(value).reverse()));
  assert.deepEqual(observe(shuffled, 2), expected);
  assert.deepEqual(records, original, 'aggregation must not mutate source facts');
  records[0].amountIwc = '9.00000000';
  assert.equal(expected.records.find((row) => row.awardId === record(2).awardId).amountIwc, '0.00000001');
  assert.notEqual(observe(records, 2).evidenceFingerprint, expected.evidenceFingerprint);
  assert.notEqual(observe(original, 1).evidenceFingerprint, expected.evidenceFingerprint);
  assert.notEqual(observe(original, 2, { windowStart: '2026-10-02T00:00:00.000Z' }).evidenceFingerprint,
    expected.evidenceFingerprint);
});

test('R8 observation: only historical as-of-end revocations annotate existing award facts', () => {
  const active = observe([record()]);
  const revoked = observe([record(1, { policyRevokedAt: '2026-10-26T00:00:00.000Z' })]);
  assert.deepEqual(revoked.metrics, active.metrics);
  assert.notEqual(revoked.evidenceFingerprint, active.evidenceFingerprint);
  assert.equal(revoked.records[0].policyRevokedAt, '2026-10-26T00:00:00.000Z');
  for (const policyRevokedAt of ['2026-10-25T11:59:59.999Z', input().windowEnd,
    '2026-11-02T00:00:00.000Z', undefined, new Date('2026-10-26T00:00:00.000Z')]) {
    rejects(() => observe([record(1, { policyRevokedAt })]));
  }
});

test('R8 observation: identity, entitlement and immutable Settlement contradictions fail closed', () => {
  const first = record();
  for (const patch of [
    { awardId: first.awardId }, { ledgerTransactionId: first.ledgerTransactionId },
    { ledgerTransactionHash: first.ledgerTransactionHash },
    { settlementId: first.settlementId, settlementHash: first.settlementHash, policyHash: 'b'.repeat(64), policyVersion: 'v2' },
  ]) rejects(() => observe([first, record(2, patch)]));
  for (const patch of [
    { settlementHash: 'b'.repeat(64) }, { settlementGrossIwc: '11.00000000' },
    { settlementType: 'full_refund' }, { settlementCreatedAt: '2026-09-30T23:01:00.000Z' },
    { counterpartyPrincipalId: 'principal-c' }, { beneficiaryPrincipalId: 'principal-c' },
  ]) rejects(() => observe([first, record(2, { settlementId: first.settlementId,
    settlementHash: first.settlementHash, awardSlot: 'bonus', ...patch })]));
});

test('R8 observation: strict safe records reject private fields, noncanonical money and invalid time/scope', () => {
  for (const patch of [
    { programId: 'another-program' }, { policyHash: 'A'.repeat(64) }, { awardId: 'not-a-hash' },
    { receiptHash: null }, { settlementType: 'in_progress' }, { beneficiaryRole: 'executor' },
    { policyVersion: 'v:1' }, { awardSlot: 'slot:1' }, { beneficiaryPrincipalId: ' principal-b' },
    { counterpartyPrincipalId: 'principal\u0000a' }, { ledgerTransactionId: '' },
    { amountIwc: 0.00000001 }, { amountIwc: '1e-8' }, { amountIwc: '0.00000000' },
    { amountIwc: '01.00000000' }, { amountIwc: '1.0' }, { settlementGrossIwc: '-1.00000000' },
    { settlementGrossIwc: '0.00000000' }, { postedAt: '2026-09-30T23:59:59.999Z' },
    { postedAt: input().windowEnd }, { postedAt: '2026-10-25T12:00:00Z' },
    { settlementCreatedAt: '2026-10-25T12:00:00.001Z' },
    { signature: 'private-signature' }, { publicKeyJwk: { private: true } },
    { authoritySnapshot: { private: true } }, { credentialId: 'private-id' }, { unknown: true },
  ]) rejects(() => observe([record(1, patch)]));
  for (const field of Object.keys(record())) {
    const value = record();
    delete value[field];
    rejects(() => observe([value]));
  }
  assert.equal(observe([record(1, { postedAt: input().windowStart })]).metrics.verifiedAwardCount, 1,
    'the lower boundary is inclusive and Settlement may predate the observation window');
});

test('R8 observation: verified and unbound candidates share one complete 500-record bound', () => {
  const records = Array.from({ length: 500 }, (_, index) => record(index + 1));
  assert.equal(observe(records).metrics.verifiedAwardCount, 500);
  assert.equal(observe([], 500).attribution.unboundPostedCandidateCount, 500);
  assert.equal(observe(records.slice(0, 499), 1).metrics.verifiedAwardCount, 499);
  rejects(() => observe(records, 1), 'R8_OBSERVATION_LIMIT_EXCEEDED');
  rejects(() => observe([], 501), 'R8_OBSERVATION_LIMIT_EXCEEDED');
  rejects(() => observe([...records, record(501)]), 'R8_OBSERVATION_LIMIT_EXCEEDED');
  for (const count of [-1, 1.5, '1', NaN, Number.MAX_SAFE_INTEGER + 1]) rejects(() => observe([], count));
  for (const sources of [null, [], { records: [] }, { records: null, unboundPostedCandidateCount: 0 },
    { records: Array(1), unboundPostedCandidateCount: 0 },
    { records: [], unboundPostedCandidateCount: 0, verified: true }]) {
    rejects(() => buildIncentiveObservation(input(), sources));
  }
});
