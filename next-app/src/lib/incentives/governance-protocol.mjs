import { createPublicKey, verify } from 'node:crypto';
import { sha256Evidence } from '../authority/authority-snapshot.mjs';
import {
  buildEconomicCommandEvidence,
  hashEconomicCommandEvidence,
} from '../signed-economic-command.mjs';
import {
  buildIncentiveProgramPolicyDraft,
  INCENTIVE_PROGRAM_POLICY_DRAFT_VERSION,
} from '../integrity/incentive-program-policy-draft.mjs';

export const INCENTIVE_REGISTRATION_PROTOCOL = 'iwantu.incentive-program-registration/0.1';
export const INCENTIVE_POLICY_PROTOCOL = 'iwantu.incentive-program-policy/0.2';
export const INCENTIVE_ENTITLEMENT_SCOPE = 'program_settlement_role_slot';

const SCALE = 100_000_000n;
const MAX_UNITS = 10n ** 36n - 1n;
const DIGEST = /^[0-9a-f]{64}$/;
const ACTIONS = new Set([
  'incentive.program.register', 'incentive.policy.publish', 'incentive.award.issue',
]);
const TRUST_FIELDS = [
  'governancePrincipalId', 'governanceSigningKeyId', 'governanceKeyHash',
  'awardIssuerPrincipalId', 'maximumBudgetIwc',
];
const POLICY_FIELDS = [
  'protocol', 'programId', 'policyVersion', 'issuerPrincipalId', 'triggerType',
  'eligibleSettlementTypes', 'beneficiaryRole', 'awardSlot', 'rewardFormula',
  'effectiveFrom', 'effectiveUntil', 'deduplicationScope',
];
const COMMAND_FIELDS = [
  'protocolVersion', 'action', 'principalId', 'agentIdentityId', 'mandateId',
  'payloadHash', 'nonce', 'issuedAt', 'expiresAt', 'signingKeyId', 'signatureAlgorithm',
];

export class IncentiveGovernanceError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IncentiveGovernanceError';
    this.code = code;
  }
}

function deny(field, reason, code = 'INCENTIVE_GOVERNANCE_INPUT_INVALID') {
  throw new IncentiveGovernanceError(code, `${field}: ${reason}`);
}

function plain(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    deny(field, 'requires a plain object');
  }
}

function exact(value, fields, field) {
  plain(value, field);
  if (Object.keys(value).length !== fields.length ||
      fields.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !fields.includes(key))) {
    deny(field, 'missing or unknown field');
  }
}

function key(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    deny(field, 'requires a separator-safe canonical identifier');
  }
  return value;
}

function identifier(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    deny(field, 'requires a canonical identifier');
  }
  return value;
}

function digest(value, field) {
  if (typeof value !== 'string' || !DIGEST.test(value)) deny(field, 'requires lowercase SHA-256');
  return value;
}

function freeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

export function amountUnits(value, allowZero = false) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,27})\.[0-9]{8}$/.test(value)) {
    deny('amountIwc', 'requires canonical Decimal(36,8) text');
  }
  const [whole, fraction] = value.split('.');
  const result = BigInt(whole) * SCALE + BigInt(fraction);
  if (!allowZero && result === 0n) deny('amountIwc', 'must be positive');
  return result;
}

export function formatUnits(value) {
  if (typeof value !== 'bigint' || value < 0n || value > MAX_UNITS) {
    deny('amountUnits', 'requires non-negative Decimal(36,8) minor units');
  }
  return `${value / SCALE}.${(value % SCALE).toString().padStart(8, '0')}`;
}

function trustedEntry(input) {
  exact(input, TRUST_FIELDS, 'trustedProgram');
  return {
    governancePrincipalId: identifier(input.governancePrincipalId, 'governancePrincipalId'),
    governanceSigningKeyId: identifier(input.governanceSigningKeyId, 'governanceSigningKeyId'),
    governanceKeyHash: digest(input.governanceKeyHash, 'governanceKeyHash'),
    awardIssuerPrincipalId: identifier(input.awardIssuerPrincipalId, 'awardIssuerPrincipalId'),
    maximumBudgetIwc: formatUnits(amountUnits(input.maximumBudgetIwc)),
  };
}

// Configuration is supplied by trusted server setup, never by an API request.
// No entries means no governed Program may be registered or written.
export function normalizeTrustedPrograms(config) {
  plain(config, 'trustedPrograms');
  return freeze(Object.fromEntries(Object.keys(config).sort().map((programId) => [
    key(programId, 'programId'), trustedEntry(config[programId]),
  ])));
}

export function normalizeRegistration(input, configuredProgram) {
  exact(input, ['protocol', 'programId', 'budgetIwc'], 'registration');
  if (input.protocol !== INCENTIVE_REGISTRATION_PROTOCOL) deny('protocol', 'unsupported registration protocol');
  const trusted = trustedEntry(configuredProgram);
  const budget = amountUnits(input.budgetIwc);
  if (budget > amountUnits(trusted.maximumBudgetIwc)) {
    deny('budgetIwc', 'exceeds the trusted Program cap', 'INCENTIVE_PROGRAM_BUDGET_EXCEEDED');
  }
  return freeze({
    protocol: INCENTIVE_REGISTRATION_PROTOCOL,
    programId: key(input.programId, 'programId'),
    budgetIwc: formatUnits(budget),
    ...trusted,
    configurationHash: sha256Evidence(trusted),
  });
}

export function normalizePolicy(input) {
  exact(input, POLICY_FIELDS, 'policy');
  if (input.protocol !== INCENTIVE_POLICY_PROTOCOL ||
      input.deduplicationScope !== INCENTIVE_ENTITLEMENT_SCOPE) {
    deny('protocol', 'requires policy v0.2 with Program-scoped stable entitlements');
  }
  // Reuse the existing static field rules through an explicit version mapping;
  // the original v0.1 function and its signed hashes remain unchanged.
  let validated;
  try {
    validated = buildIncentiveProgramPolicyDraft({
      ...input,
      protocol: INCENTIVE_PROGRAM_POLICY_DRAFT_VERSION,
      deduplicationScope: 'program_policy_settlement_role_slot',
    }).policy;
  } catch (error) {
    deny('policy', error.message);
  }
  const policy = {
    ...validated,
    protocol: INCENTIVE_POLICY_PROTOCOL,
    deduplicationScope: INCENTIVE_ENTITLEMENT_SCOPE,
  };
  return freeze({ policy, policyHash: sha256Evidence(policy) });
}

export function buildRegistrationPayload(registration) {
  exact(registration, [
    'protocol', 'programId', 'budgetIwc', ...TRUST_FIELDS, 'configurationHash',
  ], 'registration');
  const trusted = Object.fromEntries(TRUST_FIELDS.map((field) => [field, registration[field]]));
  const normalized = normalizeRegistration({
    protocol: registration.protocol, programId: registration.programId, budgetIwc: registration.budgetIwc,
  }, trusted);
  if (registration.configurationHash !== normalized.configurationHash) {
    deny('configurationHash', 'does not match trusted Program configuration');
  }
  return freeze({ action: 'incentive.program.register', registration: normalized });
}

export function buildPolicyPayload(candidate) {
  exact(candidate, ['policy', 'policyHash'], 'policyCandidate');
  const normalized = normalizePolicy(candidate.policy);
  if (digest(candidate.policyHash, 'policyHash') !== normalized.policyHash) {
    deny('policyHash', 'does not match the normalized policy');
  }
  return freeze({
    action: 'incentive.policy.publish',
    programId: normalized.policy.programId,
    policyHash: normalized.policyHash,
  });
}

export function buildAwardPayload(input) {
  exact(input, [
    'programId', 'policyHash', 'settlementId', 'settlementHash', 'beneficiaryPrincipalId',
    'beneficiaryRole', 'awardSlot', 'amountIwc',
  ], 'award');
  if (!['buyer', 'supplier'].includes(input.beneficiaryRole)) deny('beneficiaryRole', 'requires buyer or supplier');
  const stableIdentity = {
    protocol: 'iwantu.incentive-program-entitlement/0.1',
    programId: key(input.programId, 'programId'),
    settlementId: identifier(input.settlementId, 'settlementId'),
    beneficiaryRole: input.beneficiaryRole,
    awardSlot: key(input.awardSlot, 'awardSlot'),
  };
  return freeze({
    action: 'incentive.award.issue',
    programId: stableIdentity.programId,
    policyHash: digest(input.policyHash, 'policyHash'),
    settlementId: stableIdentity.settlementId,
    settlementHash: digest(input.settlementHash, 'settlementHash'),
    beneficiaryPrincipalId: identifier(input.beneficiaryPrincipalId, 'beneficiaryPrincipalId'),
    beneficiaryRole: stableIdentity.beneficiaryRole,
    awardSlot: stableIdentity.awardSlot,
    amountIwc: formatUnits(amountUnits(input.amountIwc)),
    currency: 'IWC',
    awardId: sha256Evidence(stableIdentity),
  });
}

function timestamp(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    deny(field, 'requires canonical millisecond UTC time');
  }
  return Date.parse(value);
}

function base64url(value, length, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) deny(field, 'requires unpadded base64url');
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) deny(field, 'non-canonical byte encoding');
  return bytes;
}

// Cryptographic command validation only. The service must independently verify
// stored credential ownership, live Mandate authority, Program governance and
// consume the nonce within its atomic database transaction.
export function validateSignedCommand(input) {
  exact(input, [
    'commandEvidence', 'signature', 'publicKeyJwk', 'expectedAction', 'payload', 'now',
  ], 'signedCommand');
  const { commandEvidence: evidence, expectedAction, payload, now } = input;
  exact(evidence, COMMAND_FIELDS, 'commandEvidence');
  plain(payload, 'payload');
  if (!ACTIONS.has(expectedAction) || evidence.action !== expectedAction || payload.action !== expectedAction) {
    deny('action', 'signed command and payload action must match');
  }
  if (evidence.protocolVersion !== 'iwantu-economic-command/0.1' || evidence.signatureAlgorithm !== 'EdDSA') {
    deny('protocolVersion', 'requires the existing EdDSA economic command protocol');
  }
  for (const field of ['principalId', 'agentIdentityId', 'mandateId', 'nonce', 'signingKeyId']) {
    identifier(evidence[field], field);
  }
  const payloadHash = sha256Evidence(payload);
  if (digest(evidence.payloadHash, 'payloadHash') !== payloadHash) deny('payloadHash', 'does not match the signed business payload');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) deny('now', 'requires a server-supplied Date');
  const issued = timestamp(evidence.issuedAt, 'issuedAt');
  const expires = timestamp(evidence.expiresAt, 'expiresAt');
  if (expires <= issued || expires - issued > 10 * 60_000 ||
      issued > now.getTime() + 60_000 || expires <= now.getTime()) {
    deny('window', 'invalid or expired command window', 'INCENTIVE_COMMAND_WINDOW_INVALID');
  }
  exact(input.publicKeyJwk, ['kty', 'crv', 'x'], 'publicKeyJwk');
  if (input.publicKeyJwk.kty !== 'OKP' || input.publicKeyJwk.crv !== 'Ed25519') {
    deny('publicKeyJwk', 'requires a public Ed25519 JWK');
  }
  base64url(input.publicKeyJwk.x, 32, 'publicKeyJwk.x');
  const signature = base64url(input.signature, 64, 'signature');
  const canonical = buildEconomicCommandEvidence(evidence);
  const commandHash = hashEconomicCommandEvidence(canonical);
  let valid = false;
  try {
    valid = verify(null, Buffer.from(commandHash, 'hex'),
      createPublicKey({ key: input.publicKeyJwk, format: 'jwk' }), signature);
  } catch {
    deny('signature', 'unusable signing key or signature', 'INCENTIVE_SIGNATURE_INVALID');
  }
  if (!valid) deny('signature', 'does not verify for this command', 'INCENTIVE_SIGNATURE_INVALID');
  return { commandHash, payloadHash };
}
