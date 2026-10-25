import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { sha256Evidence } from '../src/lib/authority/authority-snapshot.mjs';
import { buildEconomicCommandEvidence, hashEconomicCommandEvidence } from '../src/lib/signed-economic-command.mjs';
import {
  amountUnits, buildAwardPayload, buildPolicyPayload, buildRegistrationPayload,
  formatUnits, INCENTIVE_ENTITLEMENT_SCOPE, INCENTIVE_POLICY_PROTOCOL,
  INCENTIVE_REGISTRATION_PROTOCOL, IncentiveGovernanceError, normalizePolicy,
  normalizeRegistration, normalizeTrustedPrograms, validateSignedCommand,
} from '../src/lib/incentives/governance-protocol.mjs';

const NOW = new Date('2026-10-25T12:00:00.000Z');
const trusted = () => ({
  governancePrincipalId: 'governance-principal', governanceSigningKeyId: 'governance-key',
  governanceKeyHash: 'a'.repeat(64), awardIssuerPrincipalId: 'award-issuer',
  maximumBudgetIwc: '100.00000000',
});
const registration = () => ({ protocol: INCENTIVE_REGISTRATION_PROTOCOL, programId: 'program-1', budgetIwc: '10.00000000' });
const policy = () => ({
  protocol: INCENTIVE_POLICY_PROTOCOL, programId: 'program-1', policyVersion: 'v1',
  issuerPrincipalId: 'governance-principal', triggerType: 'terminal_settlement',
  eligibleSettlementTypes: ['mutual_split', 'full_settlement'], beneficiaryRole: 'supplier',
  awardSlot: 'completion', rewardFormula: { kind: 'fixed_amount', amountIwc: '0.00000001' },
  effectiveFrom: '2026-10-25T00:00:00.000Z', effectiveUntil: '2026-11-01T00:00:00.000Z',
  deduplicationScope: INCENTIVE_ENTITLEMENT_SCOPE,
});
const award = () => ({
  programId: 'program-1', policyHash: normalizePolicy(policy()).policyHash,
  settlementId: 'settlement-1', settlementHash: 'b'.repeat(64),
  beneficiaryPrincipalId: 'supplier-principal', beneficiaryRole: 'supplier',
  awardSlot: 'completion', amountIwc: '0.00000001',
});
const reject = (fn) => assert.throws(fn, IncentiveGovernanceError);

function signed(payload = buildAwardPayload(award())) {
  const keys = generateKeyPairSync('ed25519');
  const commandEvidence = buildEconomicCommandEvidence({
    action: payload.action, principalId: 'award-issuer', agentIdentityId: 'issuer-agent',
    mandateId: 'issuer-mandate', payloadHash: sha256Evidence(payload), nonce: 'nonce-1',
    issuedAt: '2026-10-25T11:59:00.000Z', expiresAt: '2026-10-25T12:04:00.000Z',
    signingKeyId: 'signing-key', signatureAlgorithm: 'EdDSA',
  });
  return {
    commandEvidence,
    signature: sign(null, Buffer.from(hashEconomicCommandEvidence(commandEvidence), 'hex'), keys.privateKey).toString('base64url'),
    publicKeyJwk: keys.publicKey.export({ format: 'jwk' }),
    expectedAction: payload.action, payload, now: NOW,
  };
}

test('R8 governance: trusted Program configuration is explicit, copied and recursively immutable', () => {
  assert.deepEqual(normalizeTrustedPrograms({}), {});
  const entry = trusted();
  const normalized = normalizeTrustedPrograms({ 'program-1': entry });
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized['program-1']), true);
  entry.maximumBudgetIwc = '999.00000000';
  assert.equal(normalized['program-1'].maximumBudgetIwc, '100.00000000');
  reject(() => normalizeTrustedPrograms({ '*': trusted() }));
  reject(() => normalizeTrustedPrograms({ 'program:ambiguous': trusted() }));
  reject(() => normalizeTrustedPrograms({ 'program-1': { ...trusted(), admin: true } }));
  reject(() => normalizeTrustedPrograms({ 'program-1': { ...trusted(), governanceKeyHash: 'A'.repeat(64) } }));
  reject(() => normalizeTrustedPrograms({ 'program-1': { ...trusted(), maximumBudgetIwc: '0.00000000' } }));
  reject(() => normalizeTrustedPrograms(Object.create(null)));
  reject(() => normalizeTrustedPrograms(null));
});

test('R8 governance: registration binds the trusted identities and shared maximum budget', () => {
  const normalized = normalizeRegistration(registration(), trusted());
  assert.equal(normalized.configurationHash, sha256Evidence(trusted()));
  assert.equal(normalized.governancePrincipalId, 'governance-principal');
  assert.equal(normalized.awardIssuerPrincipalId, 'award-issuer');
  assert.deepEqual(buildRegistrationPayload(normalized), { action: 'incentive.program.register', registration: normalized });
  assert.notEqual(sha256Evidence(buildRegistrationPayload(normalized)), sha256Evidence(buildRegistrationPayload(
    normalizeRegistration({ ...registration(), budgetIwc: '10.00000001' }, trusted()),
  )));
  assert.throws(() => normalizeRegistration({ ...registration(), budgetIwc: '100.00000001' }, trusted()),
    (error) => error.code === 'INCENTIVE_PROGRAM_BUDGET_EXCEEDED');
  reject(() => normalizeRegistration(registration(), undefined));
  reject(() => normalizeRegistration({ ...registration(), governancePrincipalId: 'self-appointed-root' }, trusted()));
  reject(() => buildRegistrationPayload({ ...normalized, configurationHash: 'c'.repeat(64) }));
});

test('R8 governance: Decimal(36,8) arithmetic preserves every smallest unit without Number conversion', () => {
  assert.equal(amountUnits('0.00000001'), 1n);
  assert.equal(formatUnits(amountUnits('9999999999999999999999999999.99999999')),
    '9999999999999999999999999999.99999999');
  assert.equal(amountUnits('0.00000000', true), 0n);
  assert.equal(formatUnits(0n), '0.00000000');
  for (const value of ['0.00000000', '1', '01.00000000', '1e-8', '-1.00000000', '0.000000001',
    '10000000000000000000000000000.00000000', 0.00000001, null]) reject(() => amountUnits(value));
  reject(() => formatUnits(-1n));
  reject(() => formatUnits(10n ** 36n));
  reject(() => formatUnits(1));
});

test('R8 governance: policy v0.2 explicitly changes the signed domain without rewriting legacy v0.1', () => {
  const expected = normalizePolicy(policy());
  const shuffled = Object.fromEntries(Object.entries(policy()).reverse());
  shuffled.eligibleSettlementTypes.reverse();
  assert.deepEqual(normalizePolicy(shuffled), expected);
  assert.equal(expected.policyHash, sha256Evidence(expected.policy));
  assert.equal(expected.policy.deduplicationScope, 'program_settlement_role_slot');
  assert.deepEqual(buildPolicyPayload(expected), {
    action: 'incentive.policy.publish', programId: 'program-1', policyHash: expected.policyHash,
  });
  reject(() => normalizePolicy({ ...policy(), protocol: 'iwantu.incentive-program-policy/0.1' }));
  reject(() => normalizePolicy({ ...policy(), deduplicationScope: 'program_policy_settlement_role_slot' }));
  reject(() => normalizePolicy({ ...policy(), eligibleSettlementTypes: ['created'] }));
  reject(() => normalizePolicy({ ...policy(), rewardFormula: { kind: 'fixed_amount', amountIwc: 1 } }));
  reject(() => normalizePolicy({ ...policy(), effectiveFrom: '2026-02-30T00:00:00.000Z' }));
  reject(() => buildPolicyPayload({ ...expected, policyHash: 'f'.repeat(64) }));
});

test('R8 governance: stable entitlement cannot be bypassed by changing policy, amount or claimed beneficiary', () => {
  const expected = buildAwardPayload(award());
  // Preserve the independently frozen P1g stable-entitlement golden vector.
  assert.equal(buildAwardPayload({ ...award(), programId: 'settlement-incentive' }).awardId,
    'dce69de6b567d537525635b7507cad6a987893fe3218bade1548601a2c03f138');
  for (const patch of [
    { policyHash: 'c'.repeat(64) }, { amountIwc: '1.00000000' }, { beneficiaryPrincipalId: 'different' },
  ]) {
    const changed = buildAwardPayload({ ...award(), ...patch });
    assert.equal(changed.awardId, expected.awardId);
    assert.notEqual(sha256Evidence(changed), sha256Evidence(expected));
  }
  for (const patch of [{ programId: 'program-2' }, { settlementId: 'settlement-2' },
    { beneficiaryRole: 'buyer' }, { awardSlot: 'different-slot' }]) {
    assert.notEqual(buildAwardPayload({ ...award(), ...patch }).awardId, expected.awardId);
  }
  reject(() => buildAwardPayload({ ...award(), awardId: 'bypass' }));
  reject(() => buildAwardPayload({ ...award(), beneficiaryRole: 'admin' }));
});

test('R8 governance: signed commands use the existing canonical economic-command digest', () => {
  const input = signed();
  assert.deepEqual(validateSignedCommand(input), {
    commandHash: hashEconomicCommandEvidence(input.commandEvidence), payloadHash: sha256Evidence(input.payload),
  });
  const shuffled = { ...input, commandEvidence: Object.fromEntries(Object.entries(input.commandEvidence).reverse()) };
  assert.deepEqual(validateSignedCommand(shuffled), validateSignedCommand(input));
  assert.deepEqual(validateSignedCommand(signed(buildRegistrationPayload(normalizeRegistration(registration(), trusted())))).payloadHash,
    sha256Evidence(buildRegistrationPayload(normalizeRegistration(registration(), trusted()))));
  const publication = buildPolicyPayload(normalizePolicy(policy()));
  assert.equal(validateSignedCommand(signed(publication)).payloadHash, sha256Evidence(publication));
});

test('R8 governance: altered payloads, cross-action replay and untrusted signatures fail closed', () => {
  const input = signed();
  reject(() => validateSignedCommand({ ...input, payload: { ...input.payload, amountIwc: '1.00000000' } }));
  reject(() => validateSignedCommand({ ...input, expectedAction: 'incentive.policy.publish' }));
  reject(() => validateSignedCommand({ ...input, signature: Buffer.alloc(64).toString('base64url') }));
  reject(() => validateSignedCommand({ ...input, signature: input.signature + '=' }));
  reject(() => validateSignedCommand({ ...input, publicKeyJwk: generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }) }));
  reject(() => validateSignedCommand({ ...input, publicKeyJwk: { ...input.publicKeyJwk, d: 'private-key' } }));
  reject(() => validateSignedCommand({ ...input, commandEvidence: { ...input.commandEvidence, authorized: true } }));
  reject(() => validateSignedCommand({ ...input, commandEvidence: { ...input.commandEvidence, nonce: ' nonce-1' } }));
});

test('R8 governance: command TTL, UTC precision, expiry and future skew are enforced', () => {
  const input = signed();
  for (const patch of [
    { expiresAt: NOW.toISOString() },
    { expiresAt: '2026-10-25T12:10:00.000Z' },
    { issuedAt: '2026-10-25T12:01:00.001Z' },
    { issuedAt: '2026-10-25T11:59:00Z' },
    { issuedAt: '2026-10-25T19:59:00.000+08:00' },
  ]) {
    assert.throws(() => validateSignedCommand({ ...input, commandEvidence: { ...input.commandEvidence, ...patch } }),
      IncentiveGovernanceError);
  }
  reject(() => validateSignedCommand({ ...input, now: NOW.toISOString() }));
});
