import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { sha256Evidence } from '../src/lib/authority/authority-snapshot.mjs';
import { startIncentiveApiServer } from './helpers/incentive-api-server.mjs';
import { prepareShadowFixture } from './helpers/incentive-farming-shadow-fixtures.mjs';
import { observationState } from './helpers/incentive-observation-fixtures.mjs';
import { revocationInput } from './helpers/incentive-policy-revocation-fixtures.mjs';
import { requireR8PostgresTestTarget } from './helpers/r8-postgres-test-target.mjs';

const prisma = new PrismaClient();
let connected = false;
let candidate;
let control;
let server;
let disabledServer;
before(async () => {
  requireR8PostgresTestTarget();
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required for production HTTP tests');
  await prisma.$connect();
  connected = true;
  candidate = await prepareShadowFixture(prisma);
  control = await prepareShadowFixture(prisma, { rewardAmountIwc: '1.00000000' });
  server = await startIncentiveApiServer({ ...candidate.trustedPrograms, ...control.trustedPrograms });
  disabledServer = await startIncentiveApiServer({});
}, { timeout: 80_000 });
after(async () => {
  await Promise.all([server?.stop(), disabledServer?.stop()]);
  if (connected) await prisma.$disconnect();
}, { timeout: 20_000 });

async function request({ fixture = candidate, actor = fixture.governance, input = fixture.input,
  kind = 'evaluations', query, target = server, headers = {} } = {}) {
  const suffix = query ?? `?${new URLSearchParams({ windowStart: input.windowStart, windowEnd: input.windowEnd })}`;
  const response = await fetch(new URL(`/api/v2/incentives/programs/${fixture.programId}/${kind}${suffix}`, target.origin), {
    headers: { ...(actor ? { authorization: `Bearer ${actor.rawApiToken}` } : {}), ...headers },
    signal: AbortSignal.timeout(35_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { response, data, text };
}
function safeDto(result) {
  assert.match(result.response.headers.get('cache-control') ?? '', /no-store/i);
  assert.match(result.response.headers.get('content-type') ?? '', /application\/json/i);
  assert.ok(result.data && typeof result.data === 'object', result.text);
  assert.doesNotMatch(result.text,
    /"(?:signature|secretHash|rawToken|rawApiToken|accessCredentialId|signingCredentialId|authoritySnapshotId|commandEvidence|privateKey|publicKeyJwk)"\s*:/);
  assert.doesNotMatch(result.text, /PrismaClient|SELECT |INSERT INTO|postgresql:\/\/|node_modules|BEGIN PRIVATE KEY/);
  for (const actor of [candidate.governance, candidate.executor, candidate.commonSupplier,
    control.governance, control.executor, ...candidate.terminals.map((terminal) => terminal.buyer)]) {
    assert.ok(!result.text.includes(actor.rawApiToken));
    assert.ok(!result.text.includes(actor.apiCredential.secretHash));
  }
}
function errorStatus(result, status, code) {
  assert.equal(result.response.status, status, result.text);
  safeDto(result);
  if (code) assert.equal(result.data.error?.code, code);
  assert.equal(typeof result.data.error?.message, 'string');
}
function shadowContract(report) {
  assert.equal(report.protocol, 'iwantu.incentive-farming-shadow/0.1');
  assert.equal(report.ruleCode, 'R8_INCENTIVE_FARMING');
  assert.equal(report.ruleVersion, 'iwantu.integrity-rule.r8/0.1-exp.1');
  assert.equal(report.mode, 'shadow');
  assert.equal(report.productionPolicyStatus, 'not_approved');
  assert.deepEqual(report.policy, { minIndependentSettlements: 5, highSubsidyRewardToGrossBps: 10000,
    minHighSubsidySettlementShareBps: 8000, minAggregateIndependentRewardToGrossBps: 10000 });
  assert.equal(report.policyHash, sha256Evidence(report.policy));
  assert.match(report.evaluationFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(report.interpretation, 'economic_pattern_only');
  assert.ok(Array.isArray(report.possibleLegitimateExplanations));
  assert.equal(report.signalEmitted, false);
  assert.equal(report.automaticPunishmentApplied, false);
  assert.equal(report.capitalLineageTraced, false);
}

test('R8 shadow HTTP: private evaluation requires live v2 governance/executor identity', async () => {
  const state = await observationState(prisma);
  errorStatus(await request({ actor: null }), 401);
  errorStatus(await request({ actor: null, headers: { authorization: 'Bearer invalid' } }), 401);
  errorStatus(await request({ actor: null, headers: { authorization: 'Bearer iwantu_legacy_admin' } }), 401);
  for (const actor of [control.governance, candidate.commonSupplier, candidate.terminals[0].buyer]) {
    errorStatus(await request({ actor }), 404, 'R8_PROGRAM_NOT_FOUND');
  }
  const governance = await request();
  const executor = await request({ actor: candidate.executor });
  for (const result of [governance, executor]) {
    assert.equal(result.response.status, 200, result.text);
    safeDto(result);
    shadowContract(result.data);
  }
  assert.deepEqual(executor.data, governance.data);
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 shadow HTTP: strict fixed-policy query rejects threshold overrides, authority toggles and malformed windows', async () => {
  const start = encodeURIComponent(candidate.input.windowStart);
  const end = encodeURIComponent(candidate.input.windowEnd);
  const base = `?windowStart=${start}&windowEnd=${end}`;
  const queries = ['', `?windowStart=${start}`, `?windowEnd=${end}`,
    `${base}&windowStart=${start}`, `${base}&windowEnd=${end}`, `${base}&limit=1`,
    `${base}&minimumIndependentSettlements=1`, `${base}&threshold=0.01`,
    `${base}&policyHash=${'0'.repeat(64)}`, `${base}&productionPolicyStatus=approved`,
    `${base}&emitSignal=true`, `${base}&automaticPunishmentApplied=true`,
    `?windowStart=${start}&windowEnd=${start}`, `?windowStart=${end}&windowEnd=${start}`,
    `?windowStart=not-a-date&windowEnd=${end}`,
    `?windowStart=2026-10-25T00%3A00%3A00Z&windowEnd=${end}`,
    `?windowStart=${start}&windowEnd=${encodeURIComponent(new Date(new Date(candidate.input.windowStart).getTime() + 31 * 86_400_000 + 1).toISOString())}`];
  const state = await observationState(prisma);
  for (const query of queries) errorStatus(await request({ query }), 400, 'R8_INPUT_INVALID');
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 shadow HTTP: experimental candidate and normal control preserve the original observation contract', async () => {
  const state = await observationState(prisma);
  for (const [fixture, expected] of [[candidate, 'candidate_match'], [control, 'clear']]) {
    const observation = await request({ fixture, kind: 'observations' });
    const evaluation = await request({ fixture });
    assert.equal(observation.response.status, 200, observation.text);
    assert.equal(evaluation.response.status, 200, evaluation.text);
    safeDto(observation); safeDto(evaluation);
    shadowContract(evaluation.data);
    assert.deepEqual(observation.data.riskAssessment, { state: 'not_evaluated', reason: 'rule_thresholds_not_frozen' });
    assert.equal(evaluation.data.sourceObservationFingerprint, observation.data.evidenceFingerprint);
    assert.equal(evaluation.data.state, 'evaluated');
    assert.equal(evaluation.data.findings[0].principalId, fixture.commonSupplier.principal.id);
    assert.equal(evaluation.data.findings[0].state, expected);
    assert.equal(evaluation.data.candidatePrincipalCount, expected === 'candidate_match' ? 1 : 0);
    assert.equal(evaluation.data.findings[0].metrics.independentSettlementCount, 5);
  }
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 shadow HTTP: open windows are unavailable and empty closed windows are insufficient', async () => {
  const state = await observationState(prisma);
  const open = await request({ input: { ...candidate.input, windowEnd: new Date(Date.now() + 60_000).toISOString() } });
  assert.equal(open.response.status, 200, open.text);
  safeDto(open); shadowContract(open.data);
  assert.equal(open.data.state, 'unavailable');
  assert.equal(open.data.reason, 'window_not_closed');
  assert.equal(open.data.candidatePrincipalCount, 0);
  const empty = await request({ input: { ...candidate.input,
    windowStart: '2020-01-01T00:00:00.000Z', windowEnd: '2020-02-01T00:00:00.000Z' } });
  assert.equal(empty.response.status, 200, empty.text);
  safeDto(empty); shadowContract(empty.data);
  assert.equal(empty.data.state, 'insufficient_evidence');
  assert.equal(empty.data.reason, 'no_verified_awards');
  assert.equal(empty.data.candidatePrincipalCount, 0);
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 shadow HTTP: repeated evaluations and disabled current configuration keep the historical fingerprint stable', async () => {
  const state = await observationState(prisma);
  const first = await request();
  const repeat = await request({ actor: candidate.executor });
  const disabled = await request({ target: disabledServer });
  for (const result of [first, repeat, disabled]) {
    assert.equal(result.response.status, 200, result.text);
    safeDto(result); shadowContract(result.data);
  }
  assert.deepEqual(repeat.data, first.data);
  assert.deepEqual(disabled.data, first.data);
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 shadow HTTP: paid command replay and later root/policy revocation cannot rewrite a closed historical report', async () => {
  const original = await request();
  assert.equal(original.response.status, 200, original.text);
  const oldObservation = await request({ kind: 'observations' });
  await candidate.service.revokePolicy(prisma, candidate.governance.authentication, revocationInput(candidate));
  await prisma.agentCredential.update({ where: { id: candidate.governance.signingCredential.id },
    data: { status: 'revoked', revokedAt: new Date() } });
  const state = await observationState(prisma);
  for (const { input } of candidate.awards) {
    const replay = await candidate.service.awardForSettlement(prisma, candidate.executor.authentication, input);
    assert.equal(replay.idempotent, true);
  }
  for (const target of [server, disabledServer]) {
    const result = await request({ target });
    assert.equal(result.response.status, 200, result.text);
    safeDto(result);
    assert.deepEqual(result.data, original.data);
  }
  const observation = await request({ kind: 'observations' });
  assert.equal(observation.response.status, 200, observation.text);
  assert.deepEqual(observation.data, oldObservation.data);
  assert.deepEqual(await observationState(prisma), state);
});
