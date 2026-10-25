import { createHash } from 'node:crypto';

// P1g 仅生成跨政策版本的候选权益去重指纹；没有可信治理登记和数据库唯一约束，不得发奖。
export const INCENTIVE_PROGRAM_ENTITLEMENT_DRAFT_VERSION = 'iwantu.incentive-program-entitlement/0.1';

export class IncentiveProgramEntitlementDraftError extends Error {
  constructor(field, reason) {
    super(`${field}: ${reason}`);
    this.name = 'IncentiveProgramEntitlementDraftError';
    this.code = 'INCENTIVE_PROGRAM_ENTITLEMENT_DRAFT_INVALID';
    this.field = field;
  }
}

const deny = (field, reason) => { throw new IncentiveProgramEntitlementDraftError(field, reason); };

function exactFields(input) {
  const keys = ['programId', 'settlementId', 'beneficiaryRole', 'awardSlot'];
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).length !== keys.length ||
      keys.some((key) => !Object.hasOwn(input, key)) ||
      Object.keys(input).some((key) => !keys.includes(key))) {
    deny('input', 'requires exactly four fields in a plain object');
  }
}

function safeKey(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    deny(field, 'requires a separator-safe canonical identifier');
  }
  return value;
}

function settlementKey(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    deny('settlementId', 'requires a canonical Settlement identifier');
  }
  return value;
}

export function buildProgramEntitlementFingerprintDraft(input) {
  exactFields(input);
  if (input.beneficiaryRole !== 'buyer' && input.beneficiaryRole !== 'supplier') {
    deny('beneficiaryRole', 'requires buyer or supplier');
  }

  // 去重域故意不包含 policyVersion/policyHash、awardId、amount 或 beneficiaryPrincipalId。
  // 这只揭示同一 Program 跨政策修订可能重复发奖；是否允许额外权益应由签名治理政策决定。
  const identity = {
    protocol: INCENTIVE_PROGRAM_ENTITLEMENT_DRAFT_VERSION,
    programId: safeKey(input.programId, 'programId'),
    settlementId: settlementKey(input.settlementId),
    beneficiaryRole: input.beneficiaryRole,
    awardSlot: safeKey(input.awardSlot, 'awardSlot'),
  };
  const canonical = Object.fromEntries(Object.keys(identity).sort().map((key) => [key, identity[key]]));
  const fingerprint = createHash('sha256').update(JSON.stringify(canonical), 'utf8').digest('hex');
  return {
    protocol: INCENTIVE_PROGRAM_ENTITLEMENT_DRAFT_VERSION,
    fingerprint,
    proposedScope: 'program_settlement_role_slot',
    governanceStatus: 'not_checked',
    storageUniquenessStatus: 'not_checked',
    economicWritePermitted: false,
    r8RiskEvaluationEligible: false,
  };
}
