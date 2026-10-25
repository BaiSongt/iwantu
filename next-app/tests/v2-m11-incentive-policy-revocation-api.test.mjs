import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { createTerminalSettlement, unique } from './helpers/incentive-governance-fixtures.mjs';
import { startIncentiveApiServer } from './helpers/incentive-api-server.mjs';
import {
  actorWithMandate, prepareRevocationProgram, revocationAwardInput, revocationInput, revocationState,
} from './helpers/incentive-policy-revocation-fixtures.mjs';
import { requireR8PostgresTestTarget } from './helpers/r8-postgres-test-target.mjs';

const prisma = new PrismaClient();
const root = '/api/v2/incentives/programs';
let connected = false;
let server;
let disabledServer;
let main;
let errors;
let revokedRoot;
let fault;
let race;
let actors = [];

before(async () => {
  requireR8PostgresTestTarget();
  assert.ok(process.env.JWT_SECRET, 'JWT_SECRET is required for production HTTP integration tests');
  await prisma.$connect();
  connected = true;
  main = await prepareRevocationProgram(prisma, { versions: 2 });
  errors = await prepareRevocationProgram(prisma, { versions: 2 });
  revokedRoot = await prepareRevocationProgram(prisma, { versions: 2 });
  fault = await prepareRevocationProgram(prisma);
  race = await prepareRevocationProgram(prisma);
  main.revokeActor = await actorWithMandate(prisma, main.governance, ['incentive.policy.revoke']);
  actors = [main, errors, revokedRoot, fault, race].flatMap((fixture) => [fixture.governance, fixture.executor]);
  server = await startIncentiveApiServer(Object.assign({}, ...[main, errors, revokedRoot, fault, race]
    .map((fixture) => fixture.trustedPrograms)));
  disabledServer = await startIncentiveApiServer({});
}, { timeout: 80_000 });

after(async () => {
  await Promise.all([server?.stop(), disabledServer?.stop()]);
  if (connected) await prisma.$disconnect();
}, { timeout: 20_000 });

const path = (fixture, hash = fixture.candidate.policyHash) => `${root}/${fixture.programId}/policies/${hash}/revocations`;
async function request(route, { actor, body, target = server } = {}) {
  const response = await fetch(new URL(route, target.origin), {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(actor ? { authorization: `Bearer ${actor.rawApiToken}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
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
    /"(?:signature|secretHash|rawToken|rawApiToken|accessCredentialId|signingCredentialId|authoritySnapshotId|commandEvidence)"\s*:/);
  assert.doesNotMatch(result.text, /PrismaClient|SELECT |INSERT INTO|postgresql:\/\/|node_modules|PRIVATE_R8_HTTP_REVOCATION/);
  for (const actor of actors) {
    assert.ok(!result.text.includes(actor.rawApiToken));
    assert.ok(!result.text.includes(actor.apiCredential.secretHash));
  }
}
function errorStatus(result, status, code) {
  assert.equal(result.response.status, status, result.text);
  safeDto(result);
  assert.equal(typeof result.data.error?.code, 'string');
  assert.equal(typeof result.data.error?.message, 'string');
  if (code) assert.equal(result.data.error.code, code);
}
async function rejectedWithoutWrites(route, options, status, code) {
  const state = await revocationState(prisma);
  errorStatus(await request(route, options), status, code);
  assert.deepEqual(await revocationState(prisma), state);
}

test('R8 revocation HTTP: Bearer identity and enabled trusted configuration are required', async () => {
  const input = revocationInput(errors);
  await rejectedWithoutWrites(path(errors), { body: input }, 401);
  await rejectedWithoutWrites(path(errors), { actor: errors.executor, body: input }, 403);
  await rejectedWithoutWrites(path(errors), { actor: errors.governance, body: input, target: disabledServer },
    503, 'R8_CONFIG_DISABLED');
});

test('R8 revocation HTTP: strict path and body reject caller scheduling, unknown fields and identity injection', async () => {
  const input = revocationInput(errors);
  for (const changes of [{ effectiveAt: new Date().toISOString() }, { unknown: true }]) {
    await rejectedWithoutWrites(path(errors), { actor: errors.governance,
      body: { ...input, revocation: { ...input.revocation, ...changes } } }, 400);
  }
  for (const changes of [{ effectiveAt: new Date().toISOString() },
    { authentication: errors.governance.authentication }, { trustedPrograms: errors.trustedPrograms }]) {
    await rejectedWithoutWrites(path(errors), { actor: errors.governance, body: { ...input, ...changes } }, 400);
  }
  await rejectedWithoutWrites(path(errors, errors.candidates[1].policyHash),
    { actor: errors.governance, body: input }, 400);
  await rejectedWithoutWrites(path(errors, 'not-a-sha256'), { actor: errors.governance, body: input }, 400);
  await rejectedWithoutWrites(path(errors), { actor: errors.governance,
    body: { ...input, revocation: { ...input.revocation, programId: main.programId } } }, 400);
  await rejectedWithoutWrites(path(errors), { actor: errors.governance,
    body: { ...input, revocation: { ...input.revocation, reasonCode: 'unknown' } } }, 400);
});

test('R8 revocation HTTP: live exact action, pinned signing key, signature and cross-action nonce are enforced', async () => {
  for (const scopes of [['incentive.policy.publish'], ['*']]) {
    const actor = await actorWithMandate(prisma, errors.governance, scopes);
    await rejectedWithoutWrites(path(errors), { actor, body: revocationInput(errors, { actor }) }, 403);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signingKeyId = unique('http-unpinned-revoke');
  await prisma.agentCredential.create({ data: { agentIdentityId: errors.governance.agent.id,
    kind: 'signing', keyId: signingKeyId, publicKeyJwk: publicKey.export({ format: 'jwk' }), algorithm: 'EdDSA' } });
  const actor = { ...errors.governance, privateKey, signingKeyId };
  await rejectedWithoutWrites(path(errors), { actor, body: revocationInput(errors, { actor }) }, 403);
  await rejectedWithoutWrites(path(errors), { actor: errors.governance,
    body: { ...revocationInput(errors), signature: 'A'.repeat(86) } }, 403, 'INCENTIVE_SIGNATURE_INVALID');
  await rejectedWithoutWrites(path(errors), { actor: errors.governance,
    body: revocationInput(errors, { commandChanges: { nonce: errors.registrationInput.commandEvidence.nonce } }) },
  409, 'R8_COMMAND_REPLAY');
});

test('R8 revocation HTTP: concurrent nonmonetary revoke exposes one safe receipt and preserves old award proof', async () => {
  const paid = await createTerminalSettlement(prisma, 'http-revocation-paid');
  const fresh = await createTerminalSettlement(prisma, 'http-revocation-fresh');
  const awardInput = revocationAwardInput(main, paid);
  const awarded = await request(`${root}/${main.programId}/awards`, { actor: main.executor, body: awardInput });
  assert.equal(awarded.response.status, 201, awarded.text);
  safeDto(awarded);
  const proofPath = `${root}/${main.programId}/awards/${awarded.data.award.awardId}`;
  const proofBefore = await request(proofPath, { actor: main.executor });
  assert.equal(proofBefore.response.status, 200, proofBefore.text);
  const beforeRead = await request(`${root}/${main.programId}`, { actor: main.governance });
  assert.equal(beforeRead.response.status, 200, beforeRead.text);
  assert.ok(beforeRead.data.policies.every((policy) => policy.revocation === null));
  const state = await revocationState(prisma);
  const input = revocationInput(main, { actor: main.revokeActor });
  const results = await Promise.all([0, 1].map(() => request(path(main), { actor: main.revokeActor, body: input })));
  assert.deepEqual(results.map((result) => result.response.status).sort(), [200, 201], results.map((result) => result.text).join('\n'));
  for (const result of results) {
    safeDto(result);
    assert.deepEqual(Object.keys(result.data).sort(), ['idempotent', 'revocation']);
    assert.deepEqual(Object.keys(result.data.revocation).sort(),
      ['authorizationId', 'createdAt', 'id', 'policyHash', 'programId', 'reasonCode', 'revocationHash']);
  }
  assert.deepEqual(results[0].data.revocation, results[1].data.revocation);
  const after = await revocationState(prisma);
  for (const name of ['transactions', 'entries', 'bindings', 'reputationEvidence', 'reputationSnapshots']) {
    assert.equal(after[name], state[name], `${name} is unchanged by revocation`);
  }
  assert.equal(Number(after.authorizations) - Number(state.authorizations), 1);
  assert.equal(Number(after.revocations) - Number(state.revocations), 1);
  const read = await request(`${root}/${main.programId}`, { actor: main.executor });
  assert.equal(read.response.status, 200, read.text);
  safeDto(read);
  for (const candidate of main.candidates) {
    const policy = read.data.policies.find((row) => row.policyHash === candidate.policyHash);
    assert.deepEqual(policy.policy, candidate.policy, 'revocation metadata must not change immutable policy JSON');
    assert.deepEqual(policy.revocation, candidate === main.candidate ? results[0].data.revocation : null);
  }
  const proofAfter = await request(proofPath, { actor: main.executor });
  assert.deepEqual(proofAfter.data, proofBefore.data, 'historical GET proof remains identical');
  const replay = await request(`${root}/${main.programId}/awards`, { actor: main.executor, body: awardInput });
  assert.equal(replay.response.status, 200, replay.text);
  assert.equal(replay.data.idempotent, true);
  assert.deepEqual(replay.data.award, awarded.data.award);
  await rejectedWithoutWrites(path(main), { actor: main.revokeActor,
    body: revocationInput(main, { actor: main.revokeActor }) }, 409, 'R8_POLICY_ALREADY_REVOKED');
  await rejectedWithoutWrites(path(main), { actor: main.revokeActor,
    body: { ...input, signature: 'A'.repeat(86) } }, 409, 'R8_COMMAND_REPLAY');
  await rejectedWithoutWrites(`${root}/${main.programId}/awards`, { actor: main.executor,
    body: revocationAwardInput(main, fresh) }, 409, 'R8_POLICY_REVOKED');
  const other = await request(`${root}/${main.programId}/awards`, { actor: main.executor,
    body: revocationAwardInput(main, fresh, main.candidates[1]) });
  assert.equal(other.response.status, 201, other.text);
  safeDto(other);
  assert.equal(other.data.award.policyHash, main.candidates[1].policyHash);
});

test('R8 revocation HTTP: exact committed receipt remains readable after signing key revocation', async () => {
  const input = revocationInput(revokedRoot, { reasonCode: 'superseded' });
  const first = await request(path(revokedRoot), { actor: revokedRoot.governance, body: input });
  assert.equal(first.response.status, 201, first.text);
  await prisma.agentCredential.update({ where: { id: revokedRoot.governance.signingCredential.id },
    data: { status: 'revoked', revokedAt: new Date() } });
  const state = await revocationState(prisma);
  const replay = await request(path(revokedRoot), { actor: revokedRoot.governance, body: input });
  assert.equal(replay.response.status, 200, replay.text);
  assert.equal(replay.data.idempotent, true);
  assert.deepEqual(replay.data.revocation, first.data.revocation);
  safeDto(replay);
  assert.deepEqual(await revocationState(prisma), state);
  await rejectedWithoutWrites(path(revokedRoot, revokedRoot.candidates[1].policyHash), {
    actor: revokedRoot.governance, body: revocationInput(revokedRoot, { candidate: revokedRoot.candidates[1] }),
  }, 403, 'R8_GOVERNANCE_REVOKED');
});

test('R8 revocation HTTP: SQL insertion failure is sanitized and permits retry with the same signed nonce', async () => {
  const input = revocationInput(fault, { reasonCode: 'operational' });
  const name = `test_r8_http_revoke_failure_${Math.random().toString(16).slice(2)}`;
  const literal = `'${fault.programId.replaceAll("'", "''")}'`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN
    IF NEW."programId" = ${literal} THEN RAISE EXCEPTION 'PRIVATE_R8_HTTP_REVOCATION'; END IF;
    RETURN NEW; END; $$ LANGUAGE plpgsql`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON "r8_incentive_policy_revocations"
      FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    await rejectedWithoutWrites(path(fault), { actor: fault.governance, body: input }, 500, 'R8_INTERNAL_ERROR');
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "r8_incentive_policy_revocations"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
  }
  const result = await request(path(fault), { actor: fault.governance, body: input });
  assert.equal(result.response.status, 201, result.text);
  assert.equal(result.data.idempotent, false);
  safeDto(result);
});

test('R8 revocation HTTP: racing a fresh award against revoke allows only a committed earlier award or a closed policy', async () => {
  const terminal = await createTerminalSettlement(prisma, 'http-revocation-race');
  const input = revocationAwardInput(race, terminal);
  const awardsPath = `${root}/${race.programId}/awards`;
  const [award, revoke] = await Promise.all([
    request(awardsPath, { actor: race.executor, body: input }),
    request(path(race), { actor: race.governance, body: revocationInput(race) }),
  ]);
  assert.equal(revoke.response.status, 201, revoke.text);
  safeDto(revoke);
  const [count] = await prisma.$queryRaw`
    SELECT count(*)::text AS "count" FROM "r8_incentive_award_bindings" WHERE "programId" = ${race.programId}
  `;
  if (award.response.status === 201) {
    assert.equal(count.count, '1');
    const replay = await request(awardsPath, { actor: race.executor, body: input });
    assert.equal(replay.response.status, 200, replay.text);
    assert.deepEqual(replay.data.award, award.data.award);
    assert.equal(replay.data.idempotent, true);
  } else {
    errorStatus(award, 409, 'R8_POLICY_REVOKED');
    assert.equal(count.count, '0');
  }
});
