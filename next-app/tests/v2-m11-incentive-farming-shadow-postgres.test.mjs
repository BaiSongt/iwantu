import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { sha256Evidence } from '../src/lib/authority/authority-snapshot.mjs';
import { readGovernedIncentiveAwardSources } from '../src/lib/integrity/governed-incentive-sources.mjs';
import { buildIncentiveObservation } from '../src/lib/integrity/incentive-observation.mjs';
import { evaluateIncentiveFarmingShadow } from '../src/lib/integrity/incentive-farming-shadow.mjs';
import { prepareShadowFixture } from './helpers/incentive-farming-shadow-fixtures.mjs';
import { observationState } from './helpers/incentive-observation-fixtures.mjs';
import { revocationInput } from './helpers/incentive-policy-revocation-fixtures.mjs';
import { requireR8PostgresTestTarget } from './helpers/r8-postgres-test-target.mjs';

const prisma = new PrismaClient();
let connected = false;
let candidate;
let control;
let short;
before(async () => {
  requireR8PostgresTestTarget();
  await prisma.$connect();
  connected = true;
  candidate = await prepareShadowFixture(prisma);
  control = await prepareShadowFixture(prisma, { rewardAmountIwc: '1.00000000' });
  short = await prepareShadowFixture(prisma, { settlementCount: 4 });
}, { timeout: 80_000 });
after(async () => { if (connected) await prisma.$disconnect(); });

async function observe(fixture, input = fixture.input) {
  return buildIncentiveObservation(input, await readGovernedIncentiveAwardSources(prisma, input));
}
async function evaluate(fixture, input = fixture.input, options) {
  return evaluateIncentiveFarmingShadow(await observe(fixture, input), options);
}
function shadowContract(report, fixture) {
  assert.equal(report.protocol, 'iwantu.incentive-farming-shadow/0.1');
  assert.equal(report.ruleCode, 'R8_INCENTIVE_FARMING');
  assert.equal(report.ruleVersion, 'iwantu.integrity-rule.r8/0.1-exp.1');
  assert.equal(report.mode, 'shadow');
  assert.equal(report.productionPolicyStatus, 'not_approved');
  assert.deepEqual(report.policy, { minIndependentSettlements: 5, highSubsidyRewardToGrossBps: 10000,
    minHighSubsidySettlementShareBps: 8000, minAggregateIndependentRewardToGrossBps: 10000 });
  assert.equal(report.programId, fixture.programId);
  assert.equal(report.policyHash, sha256Evidence(report.policy));
  assert.match(report.evaluationFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(report.interpretation, 'economic_pattern_only');
  assert.ok(Array.isArray(report.possibleLegitimateExplanations));
  assert.equal(report.signalEmitted, false);
  assert.equal(report.automaticPunishmentApplied, false);
  assert.equal(report.capitalLineageTraced, false);
}

test('R8 shadow PostgreSQL: five genuine independent subsidized settlements yield an auditable experimental candidate only', async () => {
  const state = await observationState(prisma);
  const observation = await observe(candidate);
  const report = evaluateIncentiveFarmingShadow(observation);
  shadowContract(report, candidate);
  assert.equal(report.state, 'evaluated');
  assert.equal(report.reason, null);
  assert.equal(report.candidatePrincipalCount, 1);
  assert.equal(report.sourceObservationFingerprint, observation.evidenceFingerprint);
  assert.deepEqual(report.observationWindow, observation.observationWindow);
  assert.equal(report.findings.length, 1);
  const [finding] = report.findings;
  assert.equal(finding.principalId, candidate.commonSupplier.principal.id);
  assert.equal(finding.state, 'candidate_match');
  assert.equal(finding.candidatePattern, 'repeated_reward_dominance');
  assert.equal(finding.metrics.independentSettlementCount, 5);
  assert.equal(finding.metrics.excludedSamePrincipalSettlementCount, 0);
  assert.equal(finding.metrics.independentCounterpartyPrincipalCount, 5);
  assert.equal(finding.metrics.highSubsidySettlementCount, 5);
  assert.equal(finding.metrics.highSubsidySettlementShare, '1.00000000');
  assert.equal(finding.metrics.totalIndependentRewardIwc, '150.00000000');
  assert.equal(finding.metrics.totalIndependentGrossIwc, '127.50000000');
  assert.equal(finding.metrics.aggregateIndependentRewardToGrossRatio, '1.17647058');
  assert.deepEqual(finding.settlementEvidence.map((record) => record.settlementId).sort(),
    candidate.terminals.map((terminal) => terminal.settlement.id).sort());
  for (const record of finding.settlementEvidence) {
    const terminal = candidate.terminals.find((value) => value.settlement.id === record.settlementId);
    const award = candidate.awards.find(({ result }) => result.binding.settlementId === record.settlementId);
    assert.equal(record.settlementHash, terminal.settlement.settlementHash);
    assert.equal(record.counterpartyPrincipalId, terminal.buyer.principal.id);
    assert.equal(record.independent, true);
    assert.equal(record.totalRewardIwc, '30.00000000');
    assert.equal(record.grossIwc, '25.50000000');
    assert.equal(record.highSubsidy, true);
    assert.deepEqual(record.awardIds, [award.result.binding.awardId]);
    assert.deepEqual(record.receiptHashes, [award.result.binding.receiptHash]);
    assert.deepEqual(record.ledgerTransactionHashes, [award.result.ledgerTransaction.transactionHash]);
  }
  assert.deepEqual(await observationState(prisma), state, 'shadow evaluation cannot emit signals or alter economic/reputation facts');
});

test('R8 shadow PostgreSQL: genuine low-reward control is clear and four independent settlements remain insufficient', async () => {
  const state = await observationState(prisma);
  const normal = await evaluate(control);
  shadowContract(normal, control);
  assert.equal(normal.state, 'evaluated');
  assert.equal(normal.candidatePrincipalCount, 0);
  assert.equal(normal.findings[0].state, 'clear');
  assert.equal(normal.findings[0].candidatePattern, null);
  assert.equal(normal.findings[0].metrics.highSubsidySettlementCount, 0);
  assert.equal(normal.findings[0].metrics.totalIndependentRewardIwc, '5.00000000');
  assert.equal(normal.findings[0].metrics.totalIndependentGrossIwc, '127.50000000');
  const small = await evaluate(short);
  shadowContract(small, short);
  assert.equal(small.state, 'insufficient_evidence');
  assert.equal(small.candidatePrincipalCount, 0);
  assert.equal(small.findings[0].state, 'insufficient_evidence');
  assert.equal(small.findings[0].metrics.independentSettlementCount, 4);
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 shadow PostgreSQL: open window is unavailable and a bounded source failure cannot yield a truncated evaluation', async () => {
  const state = await observationState(prisma);
  const open = { ...candidate.input, windowEnd: new Date(Date.now() + 60_000).toISOString() };
  const result = await evaluate(candidate, open);
  shadowContract(result, candidate);
  assert.equal(result.state, 'unavailable');
  assert.equal(result.reason, 'window_not_closed');
  assert.equal(result.candidatePrincipalCount, 0);
  await assert.rejects(() => readGovernedIncentiveAwardSources(prisma, { ...candidate.input, limit: 4 }),
    (error) => error.code === 'R8_OBSERVATION_LIMIT_EXCEEDED');
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 shadow PostgreSQL: award replay and later governance/policy revocation preserve a fixed historical evaluation', async () => {
  const originalObservation = await observe(candidate);
  const original = evaluateIncentiveFarmingShadow(originalObservation);
  await candidate.service.revokePolicy(prisma, candidate.governance.authentication, revocationInput(candidate));
  await prisma.agentCredential.update({ where: { id: candidate.governance.signingCredential.id },
    data: { status: 'revoked', revokedAt: new Date() } });
  const state = await observationState(prisma);
  for (const { input, result } of candidate.awards) {
    const replay = await candidate.service.awardForSettlement(prisma, candidate.executor.authentication, input);
    assert.equal(replay.idempotent, true);
    assert.deepEqual(replay.binding, result.binding);
  }
  assert.deepEqual(await observe(candidate), originalObservation);
  assert.deepEqual(await evaluate(candidate), original);
  assert.deepEqual(await evaluate(candidate, candidate.input, { now: new Date(Date.now() + 86_400_000) }), original);
  assert.deepEqual(await observationState(prisma), state);
});
