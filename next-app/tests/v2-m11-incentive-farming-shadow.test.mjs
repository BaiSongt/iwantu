import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Evidence } from '../src/lib/authority/authority-snapshot.mjs';
import { buildIncentiveObservation } from '../src/lib/integrity/incentive-observation.mjs';
import {
  evaluateIncentiveFarmingShadow,
  INCENTIVE_FARMING_SHADOW_POLICY,
  IncentiveFarmingShadowError,
} from '../src/lib/integrity/incentive-farming-shadow.mjs';

const NOW = '2026-11-01T00:00:00.000Z';
const WINDOW = { programId: 'program-1', windowStart: '2026-10-01T00:00:00.000Z', windowEnd: NOW };
const record = (index = 1, changes = {}) => ({
  awardId: sha256Evidence(['award', index]), programId: 'program-1',
  policyHash: sha256Evidence(['policy', index]), policyVersion: `v${index}`,
  settlementId: `settlement-${index}`, settlementHash: sha256Evidence(['settlement', index]),
  settlementType: 'full_settlement', settlementCreatedAt: '2026-10-24T00:00:00.000Z',
  beneficiaryRole: 'supplier', awardSlot: 'completion', beneficiaryPrincipalId: 'principal-z',
  counterpartyPrincipalId: `counterparty-${index}`, amountIwc: '2.00000000', settlementGrossIwc: '1.00000000',
  ledgerTransactionId: `ledger-${index}`, ledgerTransactionHash: sha256Evidence(['ledger', index]),
  receiptHash: sha256Evidence(['receipt', index]), authorizationId: sha256Evidence(['authorization', index]),
  postedAt: '2026-10-25T12:00:00.000Z', policyRevokedAt: null, ...changes,
});
const records = (amounts = Array(5).fill('2.00000000')) => amounts.map((amountIwc, index) => record(index + 1, { amountIwc }));
const observation = (values = records(), unboundPostedCandidateCount = 0) =>
  buildIncentiveObservation(WINDOW, { records: values, unboundPostedCandidateCount });
const evaluate = (values = records(), count = 0) => evaluateIncentiveFarmingShadow(observation(values, count), { now: NOW });
const reject = (fn, code = 'R8_OBSERVATION_INVALID') => assert.throws(fn,
  (error) => error instanceof IncentiveFarmingShadowError && error.code === code);

test('R8 shadow calibration: four independent high-subsidy Settlements remain insufficient', () => {
  const result = evaluate(records(Array(4).fill('2.00000000')));
  assert.equal(result.state, 'insufficient_evidence');
  assert.equal(result.reason, 'insufficient_independent_settlements');
  assert.equal(result.findings[0].state, 'insufficient_evidence');
  assert.equal(result.findings[0].candidatePattern, null);
  assert.equal(result.candidatePrincipalCount, 0);
});

test('R8 shadow calibration: exactly 80 percent high subsidy plus aggregate dominance matches the candidate pattern', () => {
  const result = evaluate(records(['2.00000000', '2.00000000', '2.00000000', '2.00000000', '0.10000000']));
  assert.equal(result.state, 'evaluated');
  assert.equal(result.reason, null);
  assert.equal(result.candidatePrincipalCount, 1);
  const finding = result.findings[0];
  assert.equal(finding.state, 'candidate_match');
  assert.equal(finding.candidatePattern, 'repeated_reward_dominance');
  assert.deepEqual(finding.metrics, {
    independentSettlementCount: 5, excludedSamePrincipalSettlementCount: 0,
    independentCounterpartyPrincipalCount: 5, highSubsidySettlementCount: 4,
    highSubsidySettlementShare: '0.80000000', totalIndependentRewardIwc: '8.10000000',
    totalIndependentGrossIwc: '5.00000000', aggregateIndependentRewardToGrossRatio: '1.62000000',
  });
});

test('R8 shadow calibration: an 80 percent count cannot bypass the aggregate economic condition', () => {
  const result = evaluate(records(['1.00000000', '1.00000000', '1.00000000', '1.00000000', '0.10000000']));
  assert.equal(result.findings[0].metrics.highSubsidySettlementShare, '0.80000000');
  assert.equal(result.findings[0].metrics.aggregateIndependentRewardToGrossRatio, '0.82000000');
  assert.equal(result.findings[0].state, 'clear');
  assert.equal(result.findings[0].candidatePattern, null);
});

test('R8 shadow calibration: aggregate dominance cannot bypass the 80 percent settlement condition', () => {
  const result = evaluate(records(['2.00000000', '2.00000000', '2.00000000', '0.10000000', '0.10000000']));
  assert.equal(result.findings[0].metrics.highSubsidySettlementShare, '0.60000000');
  assert.equal(result.findings[0].metrics.aggregateIndependentRewardToGrossRatio, '1.24000000');
  assert.equal(result.findings[0].state, 'clear');
});

test('R8 shadow calibration: five legitimate slots on one Settlement do not create five independent samples', () => {
  const values = Array.from({ length: 5 }, (_, index) => record(index + 1, {
    settlementId: 'settlement-1', settlementHash: record().settlementHash,
    counterpartyPrincipalId: 'counterparty-1', awardSlot: `slot-${index + 1}`,
  }));
  const finding = evaluate(values).findings[0];
  assert.equal(finding.state, 'insufficient_evidence');
  assert.equal(finding.metrics.independentSettlementCount, 1);
  assert.equal(finding.metrics.totalIndependentRewardIwc, '10.00000000');
  assert.equal(finding.metrics.totalIndependentGrossIwc, '1.00000000');
  assert.equal(finding.settlementEvidence.length, 1);
  assert.equal(finding.settlementEvidence[0].awardIds.length, 5);
});

test('R8 shadow calibration: same-Principal activity is visible but excluded from every economic denominator', () => {
  const finding = evaluate(records().map((value) => ({ ...value, counterpartyPrincipalId: 'principal-z' }))).findings[0];
  assert.equal(finding.state, 'insufficient_evidence');
  assert.deepEqual(finding.metrics, {
    independentSettlementCount: 0, excludedSamePrincipalSettlementCount: 5,
    independentCounterpartyPrincipalCount: 0, highSubsidySettlementCount: 0,
    highSubsidySettlementShare: '0.00000000', totalIndependentRewardIwc: '0.00000000',
    totalIndependentGrossIwc: '0.00000000', aggregateIndependentRewardToGrossRatio: '0.00000000',
  });
  assert.ok(finding.settlementEvidence.every((value) => value.independent === false && value.highSubsidy === true));
});

test('R8 shadow calibration: lawful high-frequency concentration with low subsidies remains clear', () => {
  const values = records(Array(100).fill('0.10000000')).map((value) => ({ ...value, counterpartyPrincipalId: 'one-counterparty' }));
  const finding = evaluate(values).findings[0];
  assert.equal(finding.metrics.independentSettlementCount, 100);
  assert.equal(finding.metrics.independentCounterpartyPrincipalCount, 1);
  assert.equal(finding.metrics.highSubsidySettlementCount, 0);
  assert.equal(finding.state, 'clear');
  const dominant = records().map((value) => ({ ...value, counterpartyPrincipalId: 'one-counterparty' }));
  assert.equal(evaluate(dominant).findings[0].state, 'candidate_match',
    'diversity is explanatory context rather than an alternative economic trigger');
});

test('R8 shadow calibration: a lawful broad high-subsidy promotion deliberately matches a pattern, never a fraud verdict', () => {
  const result = evaluate();
  assert.equal(result.findings[0].state, 'candidate_match');
  assert.equal(result.findings[0].metrics.independentCounterpartyPrincipalCount, 5);
  assert.equal(result.interpretation, 'economic_pattern_only');
  assert.equal(result.productionPolicyStatus, 'not_approved');
  assert.equal(result.mode, 'shadow');
  assert.ok(result.possibleLegitimateExplanations.includes('approved_promotional_subsidy'));
  assert.equal(result.signalEmitted, false);
  assert.equal(result.automaticPunishmentApplied, false);
  assert.equal(result.capitalLineageTraced, false);
  assert.doesNotMatch(JSON.stringify(result), /"(?:fraud|cheating|punishment|score|recommendedAction)"\s*:/);
});

test('R8 shadow calibration: unbound candidates invalidate whole-window eligibility instead of sampling a matching subset', () => {
  const result = evaluate(records(), 1);
  assert.equal(result.state, 'unavailable');
  assert.equal(result.reason, 'unbound_incentive_candidates');
  assert.deepEqual(result.findings, []);
  assert.equal(result.candidatePrincipalCount, 0);
});

test('R8 shadow: explicit empty and open-window states do not produce positive or clear findings', () => {
  const empty = evaluate([]);
  assert.equal(empty.state, 'insufficient_evidence');
  assert.equal(empty.reason, 'no_verified_awards');
  assert.deepEqual(empty.findings, []);
  const open = evaluateIncentiveFarmingShadow(observation(), { now: '2026-10-31T23:59:59.999Z' });
  assert.equal(open.state, 'unavailable');
  assert.equal(open.reason, 'window_not_closed');
  assert.deepEqual(open.findings, []);
  assert.notEqual(open.evaluationFingerprint, evaluate().evaluationFingerprint);
  assert.equal(evaluateIncentiveFarmingShadow(observation([], 1), { now: '2026-10-31T23:59:59.999Z' }).reason,
    'unbound_incentive_candidates', 'incomplete attribution takes precedence over an open window');
});

test('R8 shadow: fixed policy, protocol and fingerprints bind the exact experimental calculation', () => {
  assert.deepEqual(INCENTIVE_FARMING_SHADOW_POLICY, {
    minIndependentSettlements: 5, highSubsidyRewardToGrossBps: 10000,
    minHighSubsidySettlementShareBps: 8000, minAggregateIndependentRewardToGrossBps: 10000,
  });
  assert.equal(Object.isFrozen(INCENTIVE_FARMING_SHADOW_POLICY), true);
  assert.throws(() => { INCENTIVE_FARMING_SHADOW_POLICY.minIndependentSettlements = 1; }, TypeError);
  const result = evaluate([]);
  assert.equal(result.protocol, 'iwantu.incentive-farming-shadow/0.1');
  assert.equal(result.ruleCode, 'R8_INCENTIVE_FARMING');
  assert.equal(result.ruleVersion, 'iwantu.integrity-rule.r8/0.1-exp.1');
  assert.equal(result.policyHash, sha256Evidence(INCENTIVE_FARMING_SHADOW_POLICY));
  assert.equal(result.policyHash, '1d7817e5254ddb095e31f1970ce469864137acd24bdcba252b8ad55c35473c10');
  const { evaluationFingerprint, ...fingerprintEvidence } = result;
  assert.equal(evaluationFingerprint, sha256Evidence(fingerprintEvidence));
  assert.equal(evaluationFingerprint, 'b32041bba0e284fd2c7de05e152e71bb07c070ac987573590721a1cae063354c');
});

test('R8 shadow: one smallest unit remains material above Number precision and ratios are display floors', () => {
  const gross = '9007199254740993.00000001';
  const values = records(Array(5).fill(gross)).map((value) => ({ ...value, settlementGrossIwc: gross }));
  values[4].amountIwc = '9007199254740993.00000000';
  const below = evaluate(values).findings[0];
  assert.equal(below.metrics.highSubsidySettlementCount, 4);
  assert.equal(below.metrics.highSubsidySettlementShare, '0.80000000');
  assert.equal(below.metrics.aggregateIndependentRewardToGrossRatio, '0.99999999');
  assert.equal(below.state, 'clear');
  values[4].amountIwc = gross;
  const equal = evaluate(values).findings[0];
  assert.equal(equal.metrics.totalIndependentGrossIwc, '45035996273704965.00000005');
  assert.equal(equal.metrics.aggregateIndependentRewardToGrossRatio, '1.00000000');
  assert.equal(equal.state, 'candidate_match');
  const thirds = records(['1.00000000', '1.00000000', '0.10000000']);
  assert.equal(evaluate(thirds).findings[0].metrics.highSubsidySettlementShare, '0.66666666');
});

test('R8 shadow: all terminal outcomes, buyer/supplier roles and same-Principal exclusions preserve denominators', () => {
  const values = records().map((value, index) => ({ ...value,
    settlementType: ['full_settlement', 'full_refund', 'mutual_split'][index % 3],
    beneficiaryRole: index % 2 ? 'buyer' : 'supplier',
  }));
  values.push(record(6, { counterpartyPrincipalId: 'principal-z', amountIwc: '999.00000000' }));
  const result = evaluate(values);
  const finding = result.findings[0];
  assert.equal(finding.state, 'candidate_match');
  assert.equal(finding.metrics.independentSettlementCount, 5);
  assert.equal(finding.metrics.excludedSamePrincipalSettlementCount, 1);
  assert.equal(finding.metrics.totalIndependentRewardIwc, '10.00000000');
  assert.equal(finding.metrics.totalIndependentGrossIwc, '5.00000000');
  assert.deepEqual([...new Set(finding.settlementEvidence.map((value) => value.settlementType))].sort(),
    ['full_refund', 'full_settlement', 'mutual_split']);
});

test('R8 shadow: stable ordering, safe audit references and replay fingerprints omit volatile evaluation time', () => {
  const values = [...records(), ...records().map((value, index) => record(index + 6, {
    beneficiaryPrincipalId: 'principal-a', amountIwc: value.amountIwc,
  }))];
  const source = observation(values);
  const saved = structuredClone(source);
  const first = evaluateIncentiveFarmingShadow(source, { now: new Date(NOW) });
  const later = evaluateIncentiveFarmingShadow(source, { now: '2026-12-31T00:00:00.000Z' });
  assert.deepEqual(first, later);
  assert.deepEqual(source, saved, 'evaluation must not mutate an observation');
  assert.deepEqual(evaluateIncentiveFarmingShadow(observation(values.toReversed()), { now: NOW }), first);
  const reverseKeys = (value) => Array.isArray(value) ? value.map(reverseKeys)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseKeys(item)])) : value;
  assert.deepEqual(evaluateIncentiveFarmingShadow(reverseKeys(source), { now: NOW }), first);
  assert.deepEqual(first.findings.map((value) => value.principalId), ['principal-a', 'principal-z']);
  const evidence = first.findings[0].settlementEvidence;
  assert.deepEqual(evidence.map((value) => value.settlementId), evidence.map((value) => value.settlementId).sort());
  assert.deepEqual(Object.keys(evidence[0]), [
    'settlementId', 'settlementHash', 'settlementType', 'counterpartyPrincipalId', 'independent',
    'awardIds', 'policyHashes', 'ledgerTransactionHashes', 'receiptHashes', 'totalRewardIwc', 'grossIwc',
    'rewardToGrossRatio', 'highSubsidy',
  ]);
  assert.equal(first.sourceObservationFingerprint, source.evidenceFingerprint);
  assert.doesNotMatch(JSON.stringify(first), /"(?:signature|credentialId|publicKeyJwk|commandEvidence|authoritySnapshot|observedAt|now)"\s*:/);
});

test('R8 shadow: the entire canonical observation is rebuilt before its metrics or fingerprint can be trusted', () => {
  for (const mutate of [
    (value) => { value.metrics.totalAwardIwc = '999.00000000'; },
    (value) => { value.byBeneficiary[0].independentCounterpartyPrincipalCount = 0; },
    (value) => { value.evidenceFingerprint = '0'.repeat(64); },
    (value) => { value.records[0].amountIwc = '999.00000000'; },
    (value) => { value.records[0].signature = 'private'; },
    (value) => { value.attribution.state = 'partial'; },
    (value) => { value.riskAssessment.state = 'approved'; },
    (value) => { value.privateField = 'private'; },
    (value) => { value.privateField = undefined; },
    (value) => { value.metrics.unknown = undefined; },
    (value) => { value.records.reverse(); },
    (value) => { value.records.push(value.records[0]); },
    (value) => { value.automaticPunishmentApplied = true; },
    (value) => { value.capitalLineageTraced = true; },
    (value) => { value[Symbol('private')] = true; },
    (value) => { Object.defineProperty(value, 'length', { value: 1 }); },
    (value) => { Object.defineProperty(value.metrics, 'verifiedAwardCount', { get: () => 5 }); },
    (value) => { value.cycle = value; },
    (value) => { value.records[0].postedAt = new Date(value.records[0].postedAt); },
    (value) => { value.metrics.verifiedAwardCount = NaN; },
  ]) {
    const altered = observation();
    mutate(altered);
    reject(() => evaluateIncentiveFarmingShadow(altered, { now: NOW }));
  }
  for (const value of [null, [], {}, Object.create(null)]) {
    reject(() => evaluateIncentiveFarmingShadow(value, { now: NOW }));
  }
});

test('R8 shadow: callers cannot override fixed policy, promote signals or supply noncanonical evaluation options', () => {
  const source = observation();
  for (const options of [null, [], { now: null }, { now: new Date('invalid') }, { now: Date.now() },
    { now: '2026-11-01T00:00:00Z' }, { now: '2026-11-01T00:00:00.000+00:00' },
    { now: '2026-02-30T00:00:00.000Z' }, { now: NOW, policy: INCENTIVE_FARMING_SHADOW_POLICY },
    { now: NOW, thresholds: {} }, { now: NOW, signalEmitted: true }, { now: NOW, emit: true },
    { now: NOW, [Symbol('private')]: true }]) {
    reject(() => evaluateIncentiveFarmingShadow(source, options), 'R8_INPUT_INVALID');
  }
  const historicalEmpty = buildIncentiveObservation({ programId: 'program-1',
    windowStart: '2000-01-01T00:00:00.000Z', windowEnd: '2000-02-01T00:00:00.000Z',
  }, { records: [], unboundPostedCandidateCount: 0 });
  assert.equal(evaluateIncentiveFarmingShadow(historicalEmpty).state, 'insufficient_evidence');
});
