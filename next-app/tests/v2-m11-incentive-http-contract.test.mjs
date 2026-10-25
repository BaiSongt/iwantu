import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  INCENTIVE_BODY_LIMIT,
  IncentiveHttpError,
  incentiveErrorResponse,
  incentiveJson,
  readIncentiveJson,
  serializeIncentiveResult,
} from '../src/lib/incentives/http-contract.mjs';

const programId = 'governed-program';
const signature = Buffer.alloc(64, 1).toString('base64url');
const commandEvidence = (action) => ({
  protocolVersion: 'iwantu-economic-command/0.1', action,
  principalId: 'principal-1', agentIdentityId: 'agent-1', mandateId: 'mandate-1',
  payloadHash: 'a'.repeat(64), nonce: 'nonce-1',
  issuedAt: '2026-10-25T12:00:00.000Z', expiresAt: '2026-10-25T12:05:00.000Z',
  signingKeyId: 'key-1', signatureAlgorithm: 'EdDSA',
});
const register = () => ({
  registration: { protocol: 'iwantu.incentive-program-registration/0.1', programId, budgetIwc: '10.00000000' },
  commandEvidence: commandEvidence('incentive.program.register'), signature,
});
const policy = () => ({
  policy: {
    protocol: 'iwantu.incentive-program-policy/0.2', programId, policyVersion: 'v1',
    issuerPrincipalId: 'principal-1', triggerType: 'terminal_settlement',
    eligibleSettlementTypes: ['full_settlement'], beneficiaryRole: 'supplier',
    awardSlot: 'completion', rewardFormula: { kind: 'fixed_amount', amountIwc: '0.00000001' },
    effectiveFrom: '2026-10-25T12:00:00.000Z', effectiveUntil: '2026-11-25T12:00:00.000Z',
    deduplicationScope: 'program_settlement_role_slot',
  },
  commandEvidence: commandEvidence('incentive.policy.publish'), signature,
});
const award = () => ({
  programId, policyHash: 'b'.repeat(64), settlementId: 'settlement-1',
  commandEvidence: commandEvidence('incentive.award.issue'), signature,
});
function request(body, headers = {}) {
  return new Request('http://localhost/api/v2/incentives/programs', {
    method: 'POST', body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
    headers: { 'content-type': 'application/json', ...headers },
  });
}
async function rejection(body, kind = 'register', expectedStatus = 400, options) {
  await assert.rejects(() => readIncentiveJson(request(body), kind, options),
    (error) => error instanceof IncentiveHttpError && error.status === expectedStatus);
}

test('R8 HTTP: bounded strict registration, policy and award contracts preserve exact signed fields', async () => {
  for (const [kind, value] of [['register', register()], ['policy', policy()], ['award', award()]]) {
    assert.deepEqual(await readIncentiveJson(request(value, {
      'content-type': 'Application/JSON; charset=UTF-8',
    }), kind, { programId }), value);
  }
  assert.equal((await readIncentiveJson(request(policy()), 'policy')).policy.rewardFormula.amountIwc,
    '0.00000001', 'amounts must remain precise text');
});

test('R8 HTTP: policy and award paths must match the body Program', async () => {
  await rejection(policy(), 'policy', 400, { programId: 'another-program' });
  await rejection(award(), 'award', 400, { programId: 'another-program' });
});

test('R8 HTTP: request-supplied authentication, trust roots, recipients and amounts are rejected', async () => {
  await rejection({ ...register(), authentication: { principal: { id: 'admin' } } });
  await rejection({ ...register(), bodyTimeoutMs: 0 });
  await rejection({ ...register(), trustedPrograms: { [programId]: { authorized: true } } });
  await rejection({ ...register(), registration: { ...register().registration, governancePrincipalId: 'forged' } });
  await rejection({ ...award(), beneficiaryPrincipalId: 'forged' }, 'award');
  await rejection({ ...award(), amountIwc: '100.00000000' }, 'award');
  await rejection({ ...policy(), policy: { ...policy().policy, policyAuthorityVerified: true } }, 'policy');
});

test('R8 HTTP: the economic command is flat, bounded, canonical and action-specific', async () => {
  for (const patch of [
    { principalId: ['principal-1'] }, { nonce: 'x'.repeat(201) }, { agentIdentityId: ' agent' },
    { mandateId: '\u0000private' }, { payloadHash: 'A'.repeat(64) },
    { issuedAt: '2026-02-30T12:00:00.000Z' }, { expiresAt: '2026-10-25T12:05:00+00:00' },
    { signatureAlgorithm: 'none' }, { action: 'incentive.award.issue' },
    { authoritySnapshotId: 'caller-chosen' }, { payloadHash: { nested: { deeply: true } } },
  ]) await rejection({ ...register(), commandEvidence: { ...register().commandEvidence, ...patch } });
  await rejection({ ...register(), signature: 'not-a-signature' });
  await rejection({ ...register(), signature: '='.repeat(86) });
  await rejection({ ...register(), registration: { ...register().registration, budgetIwc: 10 } });
  await rejection({ ...register(), registration: { ...register().registration, programId: 'a:b' } });
});

test('R8 HTTP: legacy policy domains and oversized or repeated outcome collections are rejected', async () => {
  for (const patch of [
    { protocol: 'iwantu.incentive-program-policy/0.1' },
    { deduplicationScope: 'program_policy_settlement_role_slot' },
    { eligibleSettlementTypes: ['full_settlement', 'full_settlement'] },
    { eligibleSettlementTypes: Array(200).fill('full_settlement') },
    { rewardFormula: { kind: 'fixed_amount', amountIwc: '1e-8' } },
    { rewardFormula: { kind: 'fixed_amount', amountIwc: '0.00000000' } },
  ]) await rejection({ ...policy(), policy: { ...policy().policy, ...patch } }, 'policy');
});

test('R8 HTTP: non-JSON or encoded bodies are unsupported and invalid UTF-8/JSON is not accepted', async () => {
  for (const headers of [
    { 'content-type': 'text/plain' }, { 'content-type': '' },
    { 'content-type': 'application/json', 'content-encoding': 'gzip' },
  ]) await assert.rejects(() => readIncentiveJson(request(register(), headers), 'register'),
    (error) => error.status === 415);
  await rejection('{not json');
  await rejection(new Uint8Array([0x7b, 0xff, 0x7d]));
  await rejection(null);
  await rejection([]);
  await assert.rejects(() => readIncentiveJson(new Request('http://localhost/', {
    method: 'POST', headers: { 'content-type': 'application/json' },
  }), 'register'), (error) => error.status === 400);
});

test('R8 HTTP: Content-Length is checked before reading and invalid declared lengths fail closed', async () => {
  let reads = 0;
  let cancelled = false;
  const stream = new ReadableStream({
    pull() { reads += 1; },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  await assert.rejects(() => readIncentiveJson(new Request('http://localhost/', {
    method: 'POST', body: stream, duplex: 'half',
    headers: { 'content-type': 'application/json', 'content-length': String(INCENTIVE_BODY_LIMIT + 1) },
  }), 'register'), (error) => error.status === 413);
  assert.equal(reads, 0);
  assert.equal(cancelled, true);
  await assert.rejects(() => readIncentiveJson(request(register(), { 'content-length': 'bad' }), 'register'),
    (error) => error.status === 400);
});

test('R8 HTTP: chunked and falsely small Content-Length bodies cannot bypass the actual byte bound', async () => {
  for (const declared of [undefined, '1']) {
    let step = 0;
    let cancelled = false;
    const stream = new ReadableStream({
      pull(controller) {
        step += 1;
        controller.enqueue(new Uint8Array(INCENTIVE_BODY_LIMIT / 2 + 1));
      },
      cancel() { cancelled = true; },
    }, { highWaterMark: 0 });
    await assert.rejects(() => readIncentiveJson(new Request('http://localhost/', {
      method: 'POST', body: stream, duplex: 'half', headers: {
        'content-type': 'application/json', ...(declared ? { 'content-length': declared } : {}),
      },
    }), 'register'), (error) => error.status === 413);
    assert.equal(step, 2);
    assert.equal(cancelled, true);
  }
});

test('R8 HTTP: an exactly bounded valid JSON body succeeds and the next byte is rejected', async () => {
  const serialized = JSON.stringify(register());
  const padded = serialized + ' '.repeat(INCENTIVE_BODY_LIMIT - Buffer.byteLength(serialized));
  assert.equal(Buffer.byteLength(padded), INCENTIVE_BODY_LIMIT);
  assert.deepEqual(await readIncentiveJson(request(padded), 'register'), register());
  await rejection(padded + ' ', 'register', 413);
});

function observeReaderAndSignal(req) {
  const observation = { cancellations: 0, releases: 0, listeners: 0 };
  const originalGetReader = req.body.getReader.bind(req.body);
  req.body.getReader = () => {
    const reader = originalGetReader();
    return {
      read: () => reader.read(),
      cancel: () => { observation.cancellations += 1; return reader.cancel(); },
      releaseLock: () => { observation.releases += 1; reader.releaseLock(); },
    };
  };
  const add = req.signal.addEventListener.bind(req.signal);
  const remove = req.signal.removeEventListener.bind(req.signal);
  req.signal.addEventListener = (type, ...args) => {
    if (type === 'abort') observation.listeners += 1;
    return add(type, ...args);
  };
  req.signal.removeEventListener = (type, ...args) => {
    if (type === 'abort') observation.listeners -= 1;
    return remove(type, ...args);
  };
  return observation;
}

test('R8 HTTP: an unfinished body times out without waiting for stalled cancellation', { timeout: 2000 }, async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    pull() {},
    cancel() {
      cancelled = true;
      return new Promise(() => {});
    },
  }, { highWaterMark: 0 });
  const req = new Request('http://localhost/', {
    method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'application/json' },
  });
  const observed = observeReaderAndSignal(req);
  const started = Date.now();
  await assert.rejects(() => readIncentiveJson(req, 'register', { bodyTimeoutMs: 25 }),
    (error) => error.status === 408 && error.code === 'R8_BODY_TIMEOUT');
  assert.ok(Date.now() - started < 1000, 'read deadline must settle even when cancel never resolves');
  assert.equal(cancelled, true);
  assert.deepEqual(observed, { cancellations: 1, releases: 1, listeners: 0 });
  const response = incentiveErrorResponse(new IncentiveHttpError(408, 'R8_BODY_TIMEOUT', 'private transport state'));
  assert.equal(response.status, 408);
  assert.equal((await response.json()).error.code, 'R8_BODY_TIMEOUT');
});

test('R8 HTTP: the deadline is total and cannot be reset by trickled chunks', { timeout: 2000 }, async () => {
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream({
    start(controller) {
      chunks += 1;
      controller.enqueue(new Uint8Array([0x20]));
    },
    async pull(controller) {
      await delay(12);
      if (!cancelled) {
        chunks += 1;
        controller.enqueue(new Uint8Array([0x20]));
      }
    },
    cancel() { cancelled = true; },
  }, { highWaterMark: 0 });
  const req = new Request('http://localhost/', {
    method: 'POST', body: stream, duplex: 'half', headers: { 'content-type': 'application/json' },
  });
  await assert.rejects(() => readIncentiveJson(req, 'register', { bodyTimeoutMs: 45 }),
    (error) => error.status === 408);
  assert.ok(chunks >= 1 && chunks <= 5, 'timely chunks still cannot extend the overall deadline');
  assert.equal(cancelled, true);
});

test('R8 HTTP: successful and oversized bodies clean up timers and abort listeners', async () => {
  const complete = request(register());
  const normal = observeReaderAndSignal(complete);
  await readIncentiveJson(complete, 'register', { bodyTimeoutMs: 30 });
  await delay(50);
  assert.deepEqual(normal, { cancellations: 0, releases: 1, listeners: 0 });
  const oversized = request(' '.repeat(INCENTIVE_BODY_LIMIT + 1));
  const tooLarge = observeReaderAndSignal(oversized);
  await assert.rejects(() => readIncentiveJson(oversized, 'register', { bodyTimeoutMs: 30 }),
    (error) => error.status === 413);
  await delay(50);
  assert.deepEqual(tooLarge, { cancellations: 1, releases: 1, listeners: 0 });
});

test('R8 HTTP: request abort cancels an unfinished reader and removes its listener', { timeout: 2000 }, async () => {
  const controller = new AbortController();
  const stream = new ReadableStream({ pull() {}, cancel() {} }, { highWaterMark: 0 });
  const req = new Request('http://localhost/', {
    method: 'POST', body: stream, duplex: 'half', signal: controller.signal,
    headers: { 'content-type': 'application/json' },
  });
  const observed = observeReaderAndSignal(req);
  const reading = readIncentiveJson(req, 'register', { bodyTimeoutMs: 1000 });
  controller.abort();
  await assert.rejects(() => reading, (error) => error.status === 400);
  assert.deepEqual(observed, { cancellations: 1, releases: 1, listeners: 0 });
});

test('R8 HTTP: domain errors map to stable status codes without returning their private messages', async () => {
  const cases = [
    ['R8_CONFIG_DISABLED', 503], ['R8_AUTHENTICATION_UNAVAILABLE', 503],
    ['INCENTIVE_SIGNATURE_INVALID', 403], ['R8_TRUST_DENIED', 403],
    ['R8_POLICY_NOT_FOUND', 404], ['R8_COMMAND_REPLAY', 409],
    ['R8_PROGRAM_BUDGET_EXCEEDED', 409], ['LEDGER_ACCOUNT_OVERDRAFT', 409],
    ['R8_SETTLEMENT_INELIGIBLE', 422], ['INCENTIVE_GOVERNANCE_INPUT_INVALID', 400],
  ];
  for (const [code, status] of cases) {
    const response = incentiveErrorResponse(Object.assign(new Error('secret credential and SQL details'), { code }));
    assert.equal(response.status, status, code);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.doesNotMatch(JSON.stringify(body), /secret|credential and SQL/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
});

test('R8 HTTP: authority and Prisma diagnostics are redacted, including unrecognized error codes', async () => {
  const cases = [
    [{ name: 'AuthorityResolutionError', code: 'mandate_revoked', message: 'private mandate' }, 403, 'R8_ACCESS_DENIED'],
    [{ code: 'P2002', message: 'private table and key' }, 409, 'R8_STATE_CONFLICT'],
    [{ code: 'P2010', meta: { code: '23505', message: 'private constraint' } }, 409, 'R8_STATE_CONFLICT'],
    [{ code: 'P2010', meta: { code: 'P0001', message: 'R8_PROGRAM_BUDGET_EXCEEDED private SQL' } }, 409, 'R8_PROGRAM_BUDGET_EXCEEDED'],
    [{ code: 'P2010', meta: { code: 'P0001', message: 'R8_LEAK_PRIVATE_ROOT private SQL' } }, 500, 'R8_INTERNAL_ERROR'],
    [{ code: 'R8_NOT_WHITELISTED', message: 'private key' }, 500, 'R8_INTERNAL_ERROR'],
    [new Error('private SQL with R8_TRUST_DENIED text'), 500, 'R8_INTERNAL_ERROR'],
  ];
  for (const [error, status, code] of cases) {
    const response = incentiveErrorResponse(error);
    assert.equal(response.status, status);
    const body = await response.json();
    assert.equal(body.error.code, code);
    assert.doesNotMatch(JSON.stringify(body), /private|P2010|P0001|23505|R8_NOT_WHITELISTED|R8_LEAK/);
  }
});

test('R8 HTTP: all successful and failed JSON responses are private and omit permissive CORS', async () => {
  for (const response of [incentiveJson({ ok: true }, 201), incentiveErrorResponse(new Error('private'))]) {
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('access-control-allow-origin'), null);
    assert.match(response.headers.get('content-type'), /application\/json/);
  }
});

test('R8 HTTP: explicit success DTOs omit signatures, credential records and unknown private fields', () => {
  const createdAt = new Date('2026-10-25T12:00:00.000Z');
  const authorization = { commandHash: 'c'.repeat(64), signature: 'private-signature', accessCredentialId: 'private-access' };
  const registration = serializeIncentiveResult('register', {
    program: { programId, governancePrincipalId: 'gov', awardIssuerPrincipalId: 'issuer',
      budgetIwc: '10.00000000', configurationHash: 'd'.repeat(64), createdAt,
      registration: { private: 'private-registration' }, keyId: 'private-key-id' },
    authorization, idempotent: false,
  });
  assert.equal(registration.authorizationId, authorization.commandHash);
  assert.equal(registration.program.budgetIwc, '10.00000000');
  const publication = serializeIncentiveResult('policy', {
    policy: { policy: { ...policy().policy, private: 'private-policy', rewardFormula: {
      ...policy().policy.rewardFormula, private: 'private-formula',
    } }, policyHash: 'e'.repeat(64), createdAt, signature: 'private-signature' },
    authorization, idempotent: true,
  });
  assert.equal(publication.policy.rewardFormula.amountIwc, '0.00000001');
  assert.equal(publication.idempotent, true);
  const issued = serializeIncentiveResult('award', {
    binding: { awardId: 'f'.repeat(64), programId, policyHash: 'e'.repeat(64), settlementId: 'settlement-1',
      beneficiaryRole: 'supplier', awardSlot: 'completion', beneficiaryPrincipalId: 'supplier',
      amountIwc: '0.00000001', ledgerTransactionId: 'ledger-1', receiptHash: 'a'.repeat(64),
      authorizationId: authorization.commandHash, createdAt, receipt: { private: true } },
    ledgerTransaction: { transactionHash: 'b'.repeat(64), entries: ['private-entry'], metadata: 'private-metadata' },
    authorization, idempotent: false,
  });
  assert.equal(issued.award.ledgerTransactionHash, 'b'.repeat(64));
  assert.equal(issued.award.amountIwc, '0.00000001');
  assert.equal(issued.award.currency, 'IWC');
  for (const result of [registration, publication, issued]) {
    assert.doesNotMatch(JSON.stringify(result), /private|signature|accessCredential|entries|metadata/);
  }
});
