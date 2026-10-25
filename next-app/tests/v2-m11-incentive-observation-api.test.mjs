import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { startIncentiveApiServer } from './helpers/incentive-api-server.mjs';
import { revocationInput } from './helpers/incentive-policy-revocation-fixtures.mjs';
import {
  assertObservation, observationState, prepareObservationFixture,
} from './helpers/incentive-observation-fixtures.mjs';
import { requireR8PostgresTestTarget } from './helpers/r8-postgres-test-target.mjs';

const prisma = new PrismaClient();
let connected = false;
let fixture;
let server;
let disabledServer;
before(async () => {
  requireR8PostgresTestTarget();
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required for production HTTP tests');
  await prisma.$connect();
  connected = true;
  fixture = await prepareObservationFixture(prisma);
  server = await startIncentiveApiServer(fixture.trustedPrograms);
  disabledServer = await startIncentiveApiServer({});
}, { timeout: 80_000 });
after(async () => {
  await Promise.all([server?.stop(), disabledServer?.stop()]);
  if (connected) await prisma.$disconnect();
}, { timeout: 20_000 });

function route(input = fixture.input) {
  return `/api/v2/incentives/programs/${input.programId}/observations?${new URLSearchParams({
    windowStart: input.windowStart, windowEnd: input.windowEnd,
  })}`;
}
async function request({ actor = fixture.governance, query, input, target = server, headers = {} } = {}) {
  const response = await fetch(new URL(query === undefined ? route(input) :
    `/api/v2/incentives/programs/${fixture.programId}/observations${query}`, target.origin), {
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
    /"(?:signature|secretHash|rawToken|rawApiToken|accessCredentialId|signingCredentialId|authoritySnapshotId|commandEvidence|publicKeyJwk|privateKey)"\s*:/);
  assert.doesNotMatch(result.text, /PrismaClient|SELECT |INSERT INTO|postgresql:\/\/|node_modules|BEGIN PRIVATE KEY/);
  for (const actor of [fixture.governance, fixture.executor, fixture.other.governance,
    fixture.terminal.supplier, fixture.terminal.buyer]) {
    assert.ok(!result.text.includes(actor.rawApiToken));
    assert.ok(!result.text.includes(actor.apiCredential.secretHash));
  }
}
function errorStatus(result, status, code) {
  assert.equal(result.response.status, status, result.text);
  safeDto(result);
  assert.equal(typeof result.data.error?.message, 'string');
  if (code) assert.equal(result.data.error?.code, code);
}

test('R8 observation HTTP: only live v2 governance/executor identities can read the private aggregate', async () => {
  const state = await observationState(prisma);
  errorStatus(await request({ actor: null }), 401);
  errorStatus(await request({ actor: null, headers: { authorization: 'Bearer invalid' } }), 401);
  errorStatus(await request({ actor: null, headers: { authorization: 'Bearer iwantu_legacy_admin' } }), 401);
  errorStatus(await request({ actor: fixture.other.governance }), 404, 'R8_PROGRAM_NOT_FOUND');
  errorStatus(await request({ actor: fixture.terminal.supplier }), 404, 'R8_PROGRAM_NOT_FOUND');
  errorStatus(await request({ actor: fixture.terminal.buyer }), 404, 'R8_PROGRAM_NOT_FOUND');
  const governance = await request();
  const executor = await request({ actor: fixture.executor });
  for (const result of [governance, executor]) {
    assert.equal(result.response.status, 200, result.text);
    safeDto(result);
    assertObservation(result.data, fixture);
  }
  assert.deepEqual(executor.data, governance.data);
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 observation HTTP: exact query schema rejects missing, duplicate, unknown and noncanonical windows', async () => {
  const start = encodeURIComponent(fixture.input.windowStart);
  const end = encodeURIComponent(fixture.input.windowEnd);
  const tooLate = encodeURIComponent(new Date(new Date(fixture.input.windowStart).getTime() + 31 * 86_400_000 + 1).toISOString());
  const malformed = ['', `?windowStart=${start}`, `?windowEnd=${end}`,
    `?windowStart=${start}&windowEnd=${end}&windowStart=${start}`,
    `?windowStart=${start}&windowEnd=${end}&windowEnd=${end}`,
    `?windowStart=${start}&windowEnd=${end}&limit=1`,
    `?windowStart=${start}&windowEnd=${end}&unknown=value`,
    `?windowStart=${start}&windowEnd=${start}`,
    `?windowStart=${end}&windowEnd=${start}`,
    `?windowStart=${start}&windowEnd=${tooLate}`,
    `?windowStart=2026-10-25T00%3A00%3A00Z&windowEnd=${end}`,
    `?windowStart=2026-10-25T00%3A00%3A00.000%2B08%3A00&windowEnd=${end}`,
    `?windowStart=not-a-date&windowEnd=${end}`];
  const state = await observationState(prisma);
  for (const query of malformed) errorStatus(await request({ query }), 400, 'R8_INPUT_INVALID');
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 observation HTTP: empty windows are explicit and the 31-day maximum is inclusive', async () => {
  const input = { ...fixture.input, windowStart: '2020-01-01T00:00:00.000Z', windowEnd: '2020-02-01T00:00:00.000Z' };
  const state = await observationState(prisma);
  const result = await request({ input });
  assert.equal(result.response.status, 200, result.text);
  safeDto(result);
  assert.deepEqual(result.data.records, []);
  assert.deepEqual(result.data.byBeneficiary, []);
  assert.deepEqual(result.data.metrics, { verifiedAwardCount: 0, distinctRewardedSettlementCount: 0,
    beneficiaryPrincipalCount: 0, totalAwardIwc: '0.00000000', totalRewardedSettlementGrossIwc: '0.00000000' });
  assert.deepEqual(result.data.attribution, { state: 'empty', verifiedAwardCount: 0,
    unboundPostedCandidateCount: 0, legacyAttribution: 'unavailable' });
  assert.equal(result.data.automaticPunishmentApplied, false);
  assert.equal(result.data.capitalLineageTraced, false);
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 observation HTTP: disabled current configuration still permits historical proofs and stable fingerprints', async () => {
  const state = await observationState(prisma);
  const first = await request();
  const repeat = await request();
  const disabled = await request({ target: disabledServer, actor: fixture.executor });
  for (const result of [first, repeat, disabled]) {
    assert.equal(result.response.status, 200, result.text);
    safeDto(result);
    assertObservation(result.data, fixture);
  }
  assert.deepEqual(repeat.data, first.data);
  assert.deepEqual(disabled.data, first.data);
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 observation HTTP: later policy/root key revocation and exact paid replays cannot rewrite the fixed historical report', async () => {
  const original = await request();
  assert.equal(original.response.status, 200, original.text);
  const revoked = await fixture.service.revokePolicy(prisma, fixture.governance.authentication, revocationInput(fixture));
  assert.ok(new Date(revoked.revocation.createdAt).getTime() >= new Date(fixture.input.windowEnd).getTime());
  await prisma.agentCredential.update({ where: { id: fixture.governance.signingCredential.id },
    data: { status: 'revoked', revokedAt: new Date() } });
  const state = await observationState(prisma);
  for (const { input } of fixture.awards) {
    const replay = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, input);
    assert.equal(replay.idempotent, true);
  }
  for (const target of [server, disabledServer]) {
    const result = await request({ target });
    assert.equal(result.response.status, 200, result.text);
    assert.deepEqual(result.data, original.data);
    safeDto(result);
  }
  const laterInput = { ...fixture.input, windowEnd: new Date(Date.now() + 1_000).toISOString() };
  const later = await request({ input: laterInput });
  assert.equal(later.response.status, 200, later.text);
  assert.deepEqual(later.data.metrics, original.data.metrics);
  for (const record of later.data.records) {
    assert.equal(record.policyRevokedAt, record.policyHash === fixture.candidate.policyHash
      ? new Date(revoked.revocation.createdAt).toISOString() : null);
  }
  assert.deepEqual(await observationState(prisma), state);
});
