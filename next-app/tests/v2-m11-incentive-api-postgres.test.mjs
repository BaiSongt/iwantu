import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { SignJWT } from 'jose';
import { sha256Evidence } from '../src/lib/authority/authority-snapshot.mjs';
import {
  buildAwardPayload, buildPolicyPayload, buildRegistrationPayload, normalizePolicy, normalizeRegistration,
} from '../src/lib/incentives/governance-protocol.mjs';
import { fundProtocolIncentivePool } from '../src/lib/ledger/credit-foundation.mjs';
import { createActor, createTerminalSettlement, signCommand, unique } from './helpers/incentive-governance-fixtures.mjs';
import { startIncentiveApiServer } from './helpers/incentive-api-server.mjs';
import { requireR8PostgresTestTarget } from './helpers/r8-postgres-test-target.mjs';

const prisma = new PrismaClient();
const root = '/api/v2/incentives/programs';
let connected = false;
let server;
let disabledServer;
let governance;
let executor;
let outsider;
let rateActor;
let mainProgram;
let budgetProgram;

function programFixture(label, budget = '10.00000000', reward = '1.00000000') {
  const programId = unique(`r8-api-${label}`);
  const trustedEntry = {
    governancePrincipalId: governance.principal.id,
    governanceSigningKeyId: governance.signingKeyId,
    governanceKeyHash: sha256Evidence(governance.publicKeyJwk),
    awardIssuerPrincipalId: executor.principal.id, maximumBudgetIwc: budget,
  };
  const registration = { protocol: 'iwantu.incentive-program-registration/0.1', programId, budgetIwc: budget };
  const payload = buildRegistrationPayload(normalizeRegistration(registration, trustedEntry));
  return { programId, trustedEntry, reward,
    registrationInput: { registration, ...signCommand(governance, 'incentive.program.register', payload) } };
}

before(async () => {
  requireR8PostgresTestTarget();
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required for the local HTTP integration server');
  await prisma.$connect();
  connected = true;
  governance = await createActor(prisma, 'http-governance', ['incentive.program.register', 'incentive.policy.publish']);
  executor = await createActor(prisma, 'http-executor', ['incentive.award.issue']);
  outsider = await createActor(prisma, 'http-outsider', ['incentive.award.issue']);
  rateActor = await createActor(prisma, 'http-rate-limit', ['incentive.award.issue']);
  mainProgram = programFixture('main');
  budgetProgram = programFixture('budget', '1.00000000');
  await fundProtocolIncentivePool(prisma, { budgetRef: unique('r8-http-pool'), amount: '30.00000000' });
  server = await startIncentiveApiServer({
    [mainProgram.programId]: mainProgram.trustedEntry,
    [budgetProgram.programId]: budgetProgram.trustedEntry,
  });
  disabledServer = await startIncentiveApiServer({});
}, { timeout: 80_000 });

after(async () => {
  await Promise.all([server?.stop(), disabledServer?.stop()]);
  if (connected) await prisma.$disconnect();
}, { timeout: 20_000 });

async function request(route, { actor, body, method, headers = {}, target = server } = {}) {
  const response = await fetch(new URL(route, target.origin), {
    method: method ?? (body === undefined ? 'GET' : 'POST'), redirect: 'manual',
    headers: {
      ...(actor ? { authorization: `Bearer ${actor.rawApiToken}` } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    signal: AbortSignal.timeout(35_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  return { response, data, text };
}

function privateJson(result) {
  assert.match(result.response.headers.get('cache-control') ?? '', /no-store/i);
  assert.match(result.response.headers.get('content-type') ?? '', /application\/json/i);
  assert.ok(result.data && typeof result.data === 'object');
}

function safeDto(result) {
  privateJson(result);
  assert.doesNotMatch(result.text,
    /"(?:signature|secretHash|rawToken|rawApiToken|accessCredentialId|signingCredentialId|authoritySnapshotId|commandEvidence)"\s*:/);
  for (const actor of [governance, executor, outsider, rateActor]) {
    assert.ok(!result.text.includes(actor.rawApiToken), 'responses must never echo access credentials');
    assert.ok(!result.text.includes(actor.apiCredential.secretHash), 'responses must never expose stored credential hashes');
  }
  assert.doesNotMatch(result.text, /iwantu_ac_agk_[a-f0-9]{24}\./);
}

function errorStatus(result, status) {
  assert.equal(result.response.status, status, result.text);
  privateJson(result);
  assert.equal(typeof result.data.error?.code, 'string');
  assert.equal(typeof result.data.error?.message, 'string');
  assert.doesNotMatch(result.text, /PrismaClient|SELECT |INSERT INTO|postgresql:\/\/|node_modules|PRIVATE_R8_API_SQL_MARKER/);
}

async function economicState() {
  const [state] = await prisma.$queryRaw`
    SELECT
      (SELECT count(*)::text FROM "r8_incentive_programs") AS "programs",
      (SELECT count(*)::text FROM "r8_incentive_policies") AS "policies",
      (SELECT count(*)::text FROM "r8_incentive_authorizations") AS "authorizations",
      (SELECT count(*)::text FROM "r8_incentive_award_bindings") AS "bindings",
      (SELECT count(*)::text FROM "ledger_transactions") AS "transactions",
      (SELECT count(*)::text FROM "ledger_entries") AS "entries"
  `;
  return state;
}

async function registerAndPublish(fixture) {
  const registered = await request(root, { actor: governance, body: fixture.registrationInput });
  assert.equal(registered.response.status, 201, registered.text);
  safeDto(registered);
  fixture.registered = registered.data;
  fixture.candidate = normalizePolicy({
    protocol: 'iwantu.incentive-program-policy/0.2', programId: fixture.programId,
    policyVersion: 'v1', issuerPrincipalId: governance.principal.id,
    triggerType: 'terminal_settlement', eligibleSettlementTypes: ['full_settlement'],
    beneficiaryRole: 'supplier', awardSlot: 'completion',
    rewardFormula: { kind: 'fixed_amount', amountIwc: fixture.reward },
    effectiveFrom: registered.data.program.createdAt,
    effectiveUntil: new Date(Date.now() + 86_400_000).toISOString(),
    deduplicationScope: 'program_settlement_role_slot',
  });
  fixture.policyInput = { policy: fixture.candidate.policy,
    ...signCommand(governance, 'incentive.policy.publish', buildPolicyPayload(fixture.candidate)) };
  const published = await request(`${root}/${fixture.programId}/policies`, {
    actor: governance, body: fixture.policyInput,
  });
  assert.equal(published.response.status, 201, published.text);
  assert.equal(published.data.policyHash, fixture.candidate.policyHash);
  safeDto(published);
  return { registered, published };
}

function awardInput(fixture, terminal, changes = {}) {
  const payload = buildAwardPayload({
    programId: fixture.programId, policyHash: fixture.candidate.policyHash,
    settlementId: terminal.settlement.id, settlementHash: terminal.settlement.settlementHash,
    beneficiaryPrincipalId: terminal.supplier.principal.id, beneficiaryRole: 'supplier',
    awardSlot: 'completion', amountIwc: fixture.reward,
  });
  return { programId: fixture.programId, policyHash: fixture.candidate.policyHash,
    settlementId: terminal.settlement.id, ...signCommand(executor, 'incentive.award.issue', payload), ...changes };
}

test('R8 HTTP: missing, invalid, legacy, Cookie and forged identity authentication cannot write', async () => {
  const cookie = await new SignJWT({ userId: 'not-a-v2-agent', role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('5m')
    .sign(new TextEncoder().encode(process.env.JWT_SECRET));
  const before = await economicState();
  for (const headers of [
    {}, { authorization: 'Bearer invalid' }, { authorization: 'Bearer iwantu_legacy_admin' },
    { cookie: `iwantu_session=${cookie}` },
    { 'x-user-id': governance.principal.id, 'x-user-role': 'admin',
      'x-middleware-subrequest': 'src/proxy:src/proxy:src/proxy:src/proxy:src/proxy' },
  ]) {
    errorStatus(await request(root, { body: mainProgram.registrationInput, headers }), 401);
  }
  assert.deepEqual(await economicState(), before);
});

test('R8 HTTP: empty trusted configuration fails closed for an otherwise valid authenticated command', async () => {
  const before = await economicState();
  errorStatus(await request(root, {
    actor: governance, body: mainProgram.registrationInput, target: disabledServer,
  }), 503);
  assert.deepEqual(await economicState(), before);
});

test('R8 HTTP: authentication context and trusted root injection are rejected by strict request schemas', async () => {
  const before = await economicState();
  for (const extra of [{ authentication: governance.authentication },
    { trustedPrograms: { [mainProgram.programId]: mainProgram.trustedEntry } }, { authorized: true }]) {
    errorStatus(await request(root, { actor: governance, body: { ...mainProgram.registrationInput, ...extra } }), 400);
  }
  errorStatus(await request(root, { actor: executor, body: mainProgram.registrationInput }), 403);
  assert.deepEqual(await economicState(), before);
});

test('R8 HTTP: JSON content type, syntax and actual streamed body limits are enforced before writes', async () => {
  const before = await economicState();
  errorStatus(await request(root, { actor: governance, body: '{}', headers: { 'content-type': 'text/plain' } }), 415);
  errorStatus(await request(root, { actor: governance, body: '{' }), 400);
  errorStatus(await request(root, { actor: governance, body: { padding: 'x'.repeat(33_000) } }), 413);
  const oversized = JSON.stringify({ padding: 'x'.repeat(33_000) });
  const response = await fetch(new URL(root, server.origin), {
    method: 'POST', headers: { authorization: `Bearer ${governance.rawApiToken}`, 'content-type': 'application/json' },
    body: Readable.from([oversized.slice(0, 12_000), oversized.slice(12_000)]), duplex: 'half',
    signal: AbortSignal.timeout(10_000),
  });
  const text = await response.text();
  errorStatus({ response, text, data: JSON.parse(text) }, 413);
  assert.deepEqual(await economicState(), before);
});

test('R8 HTTP: signed Program registration and policy publication expose safe DTOs and exact replays', async () => {
  await registerAndPublish(mainProgram);
  const before = await economicState();
  const registered = await request(root, { actor: governance, body: mainProgram.registrationInput });
  assert.equal(registered.response.status, 200, registered.text);
  assert.equal(registered.data.idempotent, true);
  safeDto(registered);
  const published = await request(`${root}/${mainProgram.programId}/policies`, {
    actor: governance, body: mainProgram.policyInput,
  });
  assert.equal(published.response.status, 200, published.text);
  assert.equal(published.data.idempotent, true);
  safeDto(published);
  assert.deepEqual(await economicState(), before);
  const read = await request(`${root}/${mainProgram.programId}`, { actor: executor });
  assert.equal(read.response.status, 200, read.text);
  assert.equal(read.data.program.programId, mainProgram.programId);
  assert.equal(read.data.policies.length, 1);
  assert.equal(read.data.policies[0].policyHash, mainProgram.candidate.policyHash);
  assert.equal(read.data.hasMorePolicies, false);
  safeDto(read);
  errorStatus(await request(`${root}/${mainProgram.programId}`, { actor: outsider }), 404);
});

test('R8 HTTP: route/body mismatch, signature tampering and nonce conflicts cannot change protocol facts', async () => {
  const before = await economicState();
  errorStatus(await request(`${root}/${budgetProgram.programId}/policies`, {
    actor: governance, body: mainProgram.policyInput,
  }), 400);
  errorStatus(await request(`${root}/${mainProgram.programId}/policies`, {
    actor: governance, body: { ...mainProgram.policyInput, signature: 'A'.repeat(86) },
  }), 409);
  const next = normalizePolicy({ ...mainProgram.candidate.policy, policyVersion: 'v2' });
  errorStatus(await request(`${root}/${mainProgram.programId}/policies`, {
    actor: governance, body: { policy: next.policy,
      ...signCommand(governance, 'incentive.policy.publish', buildPolicyPayload(next)),
      signature: 'A'.repeat(86) },
  }), 403);
  errorStatus(await request(`${root}/${mainProgram.programId}/policies`, {
    actor: governance, body: { policy: next.policy,
      ...signCommand(governance, 'incentive.policy.publish', buildPolicyPayload(next), {
        nonce: mainProgram.registrationInput.commandEvidence.nonce,
      }) },
  }), 409);
  assert.deepEqual(await economicState(), before);
});

test('R8 HTTP: concurrent signed terminal awards converge and receipts enforce read privacy', async () => {
  // Publish both versions before the terminal fact, so both prospectively
  // qualify and the later conflict genuinely tests cross-version entitlement.
  mainProgram.secondCandidate = normalizePolicy({ ...mainProgram.candidate.policy, policyVersion: 'v2' });
  const secondPolicy = await request(`${root}/${mainProgram.programId}/policies`, {
    actor: governance, body: { policy: mainProgram.secondCandidate.policy,
      ...signCommand(governance, 'incentive.policy.publish', buildPolicyPayload(mainProgram.secondCandidate)) },
  });
  assert.equal(secondPolicy.response.status, 201, secondPolicy.text);
  const terminal = await createTerminalSettlement(prisma, 'http-positive');
  const input = awardInput(mainProgram, terminal);
  const path = `${root}/${mainProgram.programId}/awards`;
  const [left, right] = await Promise.all([
    request(path, { actor: executor, body: input }), request(path, { actor: executor, body: input }),
  ]);
  assert.deepEqual([left.response.status, right.response.status].sort(), [200, 201], `${left.text}\n${right.text}`);
  assert.equal(left.data.award.awardId, right.data.award.awardId);
  assert.equal(left.data.award.ledgerTransactionId, right.data.award.ledgerTransactionId);
  assert.equal(left.data.award.amountIwc, mainProgram.reward);
  assert.equal(left.data.award.beneficiaryPrincipalId, terminal.supplier.principal.id);
  safeDto(left); safeDto(right);
  const [count] = await prisma.$queryRaw`
    SELECT count(*)::text AS "count" FROM "r8_incentive_award_bindings"
    WHERE "programId" = ${mainProgram.programId} AND "settlementId" = ${terminal.settlement.id}
  `;
  assert.equal(count.count, '1');
  const before = await economicState();
  const replay = await request(path, { actor: executor, body: input });
  assert.equal(replay.response.status, 200, replay.text);
  assert.equal(replay.data.idempotent, true);
  const receiptPath = `${path}/${left.data.award.awardId}`;
  for (const actor of [governance, executor, terminal.supplier]) {
    const read = await request(receiptPath, { actor });
    assert.equal(read.response.status, 200, read.text);
    assert.equal(read.data.award.receiptHash, left.data.award.receiptHash);
    safeDto(read);
  }
  errorStatus(await request(receiptPath, { actor: outsider }), 404);
  errorStatus(await request(receiptPath, { actor: terminal.buyer }), 404);
  errorStatus(await request(`${path}/${'0'.repeat(64)}`, { actor: executor }), 404);
  errorStatus(await request(path, { actor: outsider, body: input }), 403);
  errorStatus(await request(path, { actor: outsider,
    body: { ...input, policyHash: '0'.repeat(64), settlementId: 'unknown-terminal-settlement' } }), 403);
  const unconfiguredProgram = unique('r8-api-unconfigured');
  errorStatus(await request(`${root}/${unconfiguredProgram}/awards`, { actor: outsider,
    body: { ...input, programId: unconfiguredProgram } }), 403);
  errorStatus(await request(path, { actor: executor, body: { ...input, beneficiaryPrincipalId: outsider.principal.id } }), 400);
  assert.deepEqual(await economicState(), before);
  mainProgram.terminal = terminal;
});

test('R8 HTTP: a new nonce or policy version cannot mint the same stable entitlement twice', async () => {
  const before = await economicState();
  for (const candidate of [mainProgram.candidate, mainProgram.secondCandidate]) {
    const input = awardInput({ ...mainProgram, candidate }, mainProgram.terminal);
    errorStatus(await request(`${root}/${mainProgram.programId}/awards`, { actor: executor, body: input }), 409);
  }
  assert.deepEqual(await economicState(), before);
});

test('R8 HTTP: finite shared Program budget rejects a second terminal award atomically', async () => {
  await registerAndPublish(budgetProgram);
  const first = await createTerminalSettlement(prisma, 'http-budget-one');
  const second = await createTerminalSettlement(prisma, 'http-budget-two');
  const path = `${root}/${budgetProgram.programId}/awards`;
  const posted = await request(path, { actor: executor, body: awardInput(budgetProgram, first) });
  assert.equal(posted.response.status, 201, posted.text);
  const before = await economicState();
  errorStatus(await request(path, { actor: executor, body: awardInput(budgetProgram, second) }), 409);
  assert.deepEqual(await economicState(), before);
});

test('R8 HTTP: unknown database failures are redacted and roll back Ledger, receipt and nonce together', async () => {
  const terminal = await createTerminalSettlement(prisma, 'http-receipt-failure');
  const input = awardInput(mainProgram, terminal);
  const before = await economicState();
  try {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "r8_api_test_fail_binding"() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'PRIVATE_R8_API_SQL_MARKER'; END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "r8_api_test_fail_binding" BEFORE INSERT ON "r8_incentive_award_bindings"
      FOR EACH ROW EXECUTE FUNCTION "r8_api_test_fail_binding"()
    `);
    const rejected = await request(`${root}/${mainProgram.programId}/awards`, { actor: executor, body: input });
    errorStatus(rejected, 500);
    assert.deepEqual(await economicState(), before);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "r8_api_test_fail_binding" ON "r8_incentive_award_bindings"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "r8_api_test_fail_binding"()');
  }
  const retry = await request(`${root}/${mainProgram.programId}/awards`, { actor: executor, body: input });
  assert.equal(retry.response.status, 201, retry.text);
  assert.equal(retry.data.idempotent, false, 'rollback must leave the signed nonce reusable');
  safeDto(retry);
});

test('R8 HTTP: stopped API credentials cannot reach state-changing handlers', async () => {
  const before = await economicState();
  await prisma.agentCredential.update({ where: { id: outsider.apiCredential.id },
    data: { status: 'revoked', revokedAt: new Date() } });
  errorStatus(await request(root, { actor: outsider, body: mainProgram.registrationInput }), 401);
  assert.deepEqual(await economicState(), before);
});

test('R8 HTTP: rate limiting is keyed by the authenticated credential and returns Retry-After', async () => {
  const before = await economicState();
  let limited;
  for (let count = 0; count < 70; count += 1) {
    const result = await request(root, { actor: rateActor, body: {} });
    if (result.response.status === 429) { limited = result; break; }
    errorStatus(result, 400);
  }
  assert.ok(limited, 'authenticated command traffic must hit the documented credential limit');
  errorStatus(limited, 429);
  assert.ok(Number(limited.response.headers.get('retry-after')) > 0);
  assert.deepEqual(await economicState(), before);
});
