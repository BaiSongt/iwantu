import { createPublicKey, verify as verifyDigitalSignature } from 'node:crypto';
import { sha256Evidence } from '../authority/authority-snapshot.mjs';
import {
  buildIncentiveAwardIssueIntentDraft,
  buildIncentivePolicyPublicationIntentDraft,
  INCENTIVE_AWARD_ISSUE_ACTION_DRAFT,
  INCENTIVE_POLICY_PUBLISH_ACTION_DRAFT,
} from './incentive-authorization-intent-draft.mjs';

// 仅检查候选命令与所呈交公钥之间的密码学一致性，不能证明凭据受信、Mandate 有效或 Nonce 未使用。
export const INCENTIVE_SIGNATURE_PREFLIGHT_DRAFT_VERSION = 'iwantu.incentive-signature-preflight/0.1';
const ECONOMIC_COMMAND_VERSION = 'iwantu-economic-command/0.1';
const MAX_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const COMMAND_FIELDS = Object.freeze([
  'protocolVersion', 'action', 'principalId', 'agentIdentityId', 'mandateId',
  'payloadHash', 'nonce', 'issuedAt', 'expiresAt', 'signingKeyId', 'signatureAlgorithm',
]);

export class IncentiveSignaturePreflightDraftError extends Error {
  constructor(field, reason) {
    super(\`\${field}: \${reason}\`);
    this.name = 'IncentiveSignaturePreflightDraftError';
    this.code = 'INCENTIVE_SIGNATURE_PREFLIGHT_DRAFT_INVALID';
    this.field = field;
  }
}

const deny = (field, reason) => { throw new IncentiveSignaturePreflightDraftError(field, reason); };

function exactFields(value, keys, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !keys.includes(key))) {
    deny(field, 'missing, unexpected or unsafe field');
  }
}

function identifier(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    deny(field, 'must be a canonical identifier');
  }
  return value;
}

function canonicalTimestamp(value, field) {
  if (typeof value !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    deny(field, 'must be a canonical millisecond UTC timestamp');
  }
  return Date.parse(value);
}

function canonicalBase64url(value, expectedLength, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) {
    deny(field, 'must be unpadded base64url');
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length !== expectedLength || decoded.toString('base64url') !== value) {
    deny(field, 'must encode the expected canonical byte length');
  }
  return decoded;
}

function inspect(input, expectedAction, intentDraft) {
  const evidence = input.commandEvidence;
  exactFields(evidence, COMMAND_FIELDS, 'commandEvidence');
  if (evidence.protocolVersion !== ECONOMIC_COMMAND_VERSION) {
    deny('commandEvidence.protocolVersion', 'unsupported economic command version');
  }
  if (evidence.action !== expectedAction || evidence.action !== intentDraft.payload.action) {
    deny('commandEvidence.action', 'signed action does not match the candidate intent');
  }
  if (evidence.payloadHash !== intentDraft.payloadHash) {
    deny('commandEvidence.payloadHash', 'signed payload does not match the candidate intent');
  }
  for (const field of ['principalId', 'agentIdentityId', 'mandateId', 'nonce', 'signingKeyId']) {
    identifier(evidence[field], \`commandEvidence.\${field}\`);
  }
  if (expectedAction === INCENTIVE_POLICY_PUBLISH_ACTION_DRAFT &&
      evidence.principalId !== intentDraft.payload.issuerPrincipalId) {
    deny('commandEvidence.principalId', 'policy publication signer must match the candidate issuer');
  }
  if (evidence.signatureAlgorithm !== 'EdDSA') {
    deny('commandEvidence.signatureAlgorithm', 'only EdDSA is supported');
  }

  // 时间基准只可由调用侧服务端提供，本函数本身不提供认证或可信时间证明。
  if (!(input.now instanceof Date) || !Number.isFinite(input.now.getTime())) {
    deny('now', 'must be an explicit valid server-side Date');
  }
  const issued = canonicalTimestamp(evidence.issuedAt, 'commandEvidence.issuedAt');
  const expires = canonicalTimestamp(evidence.expiresAt, 'commandEvidence.expiresAt');
  if (expires <= issued || expires - issued > MAX_TTL_MS ||
      issued > input.now.getTime() + MAX_CLOCK_SKEW_MS ||
      expires <= input.now.getTime()) {
    deny('commandEvidence.window', 'invalid, expired or excessively future-dated signature window');
  }

  const jwk = input.presentedPublicKeyJwk;
  exactFields(jwk, ['kty', 'crv', 'x'], 'presentedPublicKeyJwk');
  if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519') {
    deny('presentedPublicKeyJwk', 'only public Ed25519 JWK is supported');
  }
  canonicalBase64url(jwk.x, 32, 'presentedPublicKeyJwk.x');
  const signatureBytes = canonicalBase64url(input.signature, 64, 'signature');
  const commandHash = sha256Evidence(evidence);
  let matched;
  try {
    const key = createPublicKey({ key: jwk, format: 'jwk' });
    matched = verifyDigitalSignature(null, Buffer.from(commandHash, 'hex'), key, signatureBytes);
  } catch {
    deny('signature', 'presented signature or key is unusable');
  }
  if (!matched) deny('signature', 'signature does not match this candidate command and key');

  // 不返回 authorized/verified 等容易被误认为完整授权的状态。
  return {
    protocol: INCENTIVE_SIGNATURE_PREFLIGHT_DRAFT_VERSION,
    intentPayloadHash: intentDraft.payloadHash,
    economicCommandHash: commandHash,
    signatureCheck: 'valid_for_presented_key_only',
    authorizationStatus: 'not_checked',
    nonceReplayStatus: 'not_checked',
    r8RiskEvaluationEligible: false,
  };
}

export function inspectIncentivePolicyPublicationSignatureDraft(input) {
  exactFields(input, [
    'policyCandidate', 'commandEvidence', 'signature', 'presentedPublicKeyJwk', 'now',
  ], 'publication');
  return inspect(input, INCENTIVE_POLICY_PUBLISH_ACTION_DRAFT,
    buildIncentivePolicyPublicationIntentDraft({ policyCandidate: input.policyCandidate }));
}

export function inspectIncentiveAwardIssueSignatureDraft(input) {
  exactFields(input, [
    'policyCandidate', 'trigger', 'beneficiaryPrincipalId', 'awardId',
    'commandEvidence', 'signature', 'presentedPublicKeyJwk', 'now',
  ], 'award');
  return inspect(input, INCENTIVE_AWARD_ISSUE_ACTION_DRAFT,
    buildIncentiveAwardIssueIntentDraft({
      policyCandidate: input.policyCandidate,
      trigger: input.trigger,
      beneficiaryPrincipalId: input.beneficiaryPrincipalId,
      awardId: input.awardId,
    }));
}
