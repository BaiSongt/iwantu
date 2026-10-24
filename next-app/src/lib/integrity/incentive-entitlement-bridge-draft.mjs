import { sha256Evidence } from '../authority/authority-snapshot.mjs';
import { buildProgramEntitlementFingerprintDraft } from './incentive-program-entitlement-draft.mjs';

// P1h 只交叉核对 P1b v0.1 候选发奖意图与 P1g 跨版本权益键，不验证真实治理或允许经济写入。
export const INCENTIVE_ENTITLEMENT_BRIDGE_DRAFT_VERSION = 'iwantu.incentive-entitlement-bridge/0.1';
const LEGACY_DEDUP_PROTOCOL = 'iwantu.incentive-award-deduplication/0.1';
const AWARD_INTENT_PROTOCOL = 'iwantu.incentive-authorization-intent/0.1';
const AWARD_ACTION = 'incentive.award.issue';
const POLICY_SCOPE = 'program_policy_settlement_role_slot';
const INTENT_FIELDS = Object.freeze(['payload', 'payloadHash', 'deduplicationFingerprint']);
const PAYLOAD_FIELDS = Object.freeze([
  'protocol', 'action', 'programId', 'policyVersion', 'policyHash', 'issuerPrincipalId',
  'settlementId', 'settlementHash', 'settlementType', 'triggerEvidenceHash',
  'beneficiaryPrincipalId', 'beneficiaryRole', 'awardSlot', 'awardId',
  'rewardFormula', 'currency', 'deduplicationScope',
]);
const DIGEST = /^[0-9a-f]{64}$/;
const KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TEXT = (value) => typeof value === 'string' && value.length > 0 && value.length <= 200 &&
  value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value);

export class IncentiveEntitlementBridgeDraftError extends Error {
  constructor(field, reason) {
    super(`${field}: ${reason}`);
    this.name = 'IncentiveEntitlementBridgeDraftError';
    this.code = 'INCENTIVE_ENTITLEMENT_BRIDGE_DRAFT_INVALID';
    this.field = field;
  }
}

function deny(field, reason) { throw new IncentiveEntitlementBridgeDraftError(field, reason); }

function exactFields(value, fields, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== fields.length ||
      fields.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !fields.includes(key))) {
    deny(field, 'requires exactly the expected fields in a plain object');
  }
}

function digest(value, field) {
  if (typeof value !== 'string' || !DIGEST.test(value)) deny(field, 'requires SHA-256 lowercase hex');
  return value;
}

function key(value, field) {
  if (typeof value !== 'string' || !KEY.test(value)) deny(field, 'requires canonical separator-safe key');
  return value;
}

// P1b 旧哈希属于已定义的 policy-version 域，绝不在此函数中篡改或悄悄改为 Program 域。
export function inspectIncentiveEntitlementBridgeDraft(intent) {
  exactFields(intent, INTENT_FIELDS, 'intent');
  exactFields(intent.payload, PAYLOAD_FIELDS, 'payload');
  const p = intent.payload;
  if (p.protocol !== AWARD_INTENT_PROTOCOL || p.action !== AWARD_ACTION) {
    deny('payload.action', 'only P1b incentive award issue intent is supported');
  }
  if (p.currency !== 'IWC' || p.deduplicationScope !== POLICY_SCOPE) {
    deny('payload.deduplicationScope', 'expected existing P1b v0.1 policy-scoped semantics');
  }
  key(p.programId, 'payload.programId');
  key(p.policyVersion, 'payload.policyVersion');
  key(p.awardId, 'payload.awardId');
  key(p.awardSlot, 'payload.awardSlot');
  for (const field of ['issuerPrincipalId', 'settlementId', 'beneficiaryPrincipalId']) {
    if (!TEXT(p[field])) deny(`payload.${field}`, 'requires canonical identifier');
  }
  for (const field of ['policyHash', 'settlementHash', 'triggerEvidenceHash']) {
    digest(p[field], `payload.${field}`);
  }
  if (!['full_settlement', 'full_refund', 'mutual_split'].includes(p.settlementType)) {
    deny('payload.settlementType', 'requires terminal settlement type');
  }
  if (p.beneficiaryRole !== 'buyer' && p.beneficiaryRole !== 'supplier') {
    deny('payload.beneficiaryRole', 'requires buyer or supplier');
  }
  exactFields(p.rewardFormula, ['kind', 'amountIwc'], 'payload.rewardFormula');
  if (p.rewardFormula.kind !== 'fixed_amount' ||
      typeof p.rewardFormula.amountIwc !== 'string' ||
      !/^(?:0|[1-9][0-9]{0,27})\.[0-9]{8}$/.test(p.rewardFormula.amountIwc) ||
      p.rewardFormula.amountIwc === '0.00000000') {
    deny('payload.rewardFormula', 'requires positive canonical fixed IWC amount');
  }
  if (digest(intent.payloadHash, 'payloadHash') !== sha256Evidence(p)) {
    deny('payloadHash', 'does not match P1b candidate payload');
  }
  const policyScopedFingerprint = sha256Evidence({
    protocol: LEGACY_DEDUP_PROTOCOL,
    programId: p.programId,
    policyVersion: p.policyVersion,
    policyHash: p.policyHash,
    settlementId: p.settlementId,
    beneficiaryRole: p.beneficiaryRole,
    awardSlot: p.awardSlot,
  });
  if (digest(intent.deduplicationFingerprint, 'deduplicationFingerprint') !== policyScopedFingerprint) {
    deny('deduplicationFingerprint', 'does not match P1b policy-scoped fingerprint');
  }
  const stable = buildProgramEntitlementFingerprintDraft({
    programId: p.programId,
    settlementId: p.settlementId,
    beneficiaryRole: p.beneficiaryRole,
    awardSlot: p.awardSlot,
  });
  return {
    protocol: INCENTIVE_ENTITLEMENT_BRIDGE_DRAFT_VERSION,
    policyScopedFingerprint,
    programEntitlementFingerprint: stable.fingerprint,
    policyScopeCompatibility: 'legacy_scope_does_not_enforce_cross_version_uniqueness',
    governanceStatus: 'not_checked',
    policySnapshotStatus: 'not_verified',
    authorizationStatus: 'not_checked',
    databaseUniquenessStatus: 'not_checked',
    economicWritePermitted: false,
    r8RiskEvaluationEligible: false,
  };
}
