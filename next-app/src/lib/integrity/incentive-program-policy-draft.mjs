import { createHash } from 'node:crypto';

// P1a 只构造候选政策快照及确定性摘要，不验证治理授权，也不允许据此发奖。
export const INCENTIVE_PROGRAM_POLICY_DRAFT_VERSION = 'iwantu.incentive-program-policy/0.1';

export class IncentiveProgramPolicyDraftError extends Error {
  constructor(field, reason) {
    super(field + ': ' + reason);
    this.name = 'IncentiveProgramPolicyDraftError';
    this.code = 'INCENTIVE_PROGRAM_POLICY_DRAFT_INVALID';
    this.field = field;
  }
}

const deny = (field, reason) => { throw new IncentiveProgramPolicyDraftError(field, reason); };

function exactFields(value, fields, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    deny(field, 'must be a plain object');
  }
  const actual = Object.keys(value);
  if (actual.length !== fields.length || actual.some((key) => !fields.includes(key)) ||
      fields.some((key) => !Object.hasOwn(value, key))) {
    deny(field, 'missing or unknown field');
  }
}

function safeKey(value, field) {
  // 与 B1 一致：拒绝旧奖励 referenceId / 幂等键的冒号分隔符歧义。
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    deny(field, 'must be a separator-safe identifier');
  }
  return value;
}

function principalId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    deny('issuerPrincipalId', 'must be a canonical Principal identifier');
  }
  return value;
}

function utcTime(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    deny(field, 'must be a canonical UTC timestamp with milliseconds');
  }
  return value;
}

function amount(value) {
  // 与 M2 Decimal(36,8) 对齐，不接受 JS Number 的精度丢失和零金额。
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,27})\.[0-9]{8}$/.test(value) ||
      value === '0.00000000') {
    deny('rewardFormula.amountIwc', 'must be positive canonical Decimal(36,8)');
  }
  return value;
}

const POLICY_FIELDS = Object.freeze([
  'protocol', 'programId', 'policyVersion', 'issuerPrincipalId', 'triggerType',
  'eligibleSettlementTypes', 'beneficiaryRole', 'awardSlot', 'rewardFormula',
  'effectiveFrom', 'effectiveUntil', 'deduplicationScope',
]);
const TERMINAL_TYPES = new Set(['full_settlement', 'full_refund', 'mutual_split']);

export function buildIncentiveProgramPolicyDraft(input) {
  exactFields(input, POLICY_FIELDS, 'policy');
  exactFields(input.rewardFormula, ['kind', 'amountIwc'], 'rewardFormula');
  if (input.protocol !== INCENTIVE_PROGRAM_POLICY_DRAFT_VERSION) deny('protocol', 'unsupported version');
  if (input.triggerType !== 'terminal_settlement') deny('triggerType', 'unsupported trigger type');
  if (input.beneficiaryRole !== 'buyer' && input.beneficiaryRole !== 'supplier') {
    deny('beneficiaryRole', 'unsupported beneficiary role');
  }
  if (input.deduplicationScope !== 'program_policy_settlement_role_slot') {
    deny('deduplicationScope', 'unsupported scope');
  }
  if (input.rewardFormula.kind !== 'fixed_amount') deny('rewardFormula.kind', 'unsupported formula');
  if (!Array.isArray(input.eligibleSettlementTypes) || input.eligibleSettlementTypes.length < 1 ||
      input.eligibleSettlementTypes.length > TERMINAL_TYPES.size ||
      input.eligibleSettlementTypes.some((type) => !TERMINAL_TYPES.has(type)) ||
      new Set(input.eligibleSettlementTypes).size !== input.eligibleSettlementTypes.length) {
    deny('eligibleSettlementTypes', 'must contain distinct supported terminal outcomes');
  }

  const effectiveFrom = utcTime(input.effectiveFrom, 'effectiveFrom');
  const effectiveUntil = utcTime(input.effectiveUntil, 'effectiveUntil');
  if (effectiveFrom >= effectiveUntil) deny('effectiveUntil', 'must be after effectiveFrom');

  const policy = {
    protocol: INCENTIVE_PROGRAM_POLICY_DRAFT_VERSION,
    programId: safeKey(input.programId, 'programId'),
    policyVersion: safeKey(input.policyVersion, 'policyVersion'),
    issuerPrincipalId: principalId(input.issuerPrincipalId),
    triggerType: 'terminal_settlement',
    eligibleSettlementTypes: [...input.eligibleSettlementTypes].sort(),
    beneficiaryRole: input.beneficiaryRole,
    awardSlot: safeKey(input.awardSlot, 'awardSlot'),
    rewardFormula: { kind: 'fixed_amount', amountIwc: amount(input.rewardFormula.amountIwc) },
    effectiveFrom,
    effectiveUntil,
    deduplicationScope: 'program_policy_settlement_role_slot',
  };
  const canonicalPolicy = Object.fromEntries(Object.keys(policy).sort().map((key) => [key, policy[key]]));
  const policyHash = createHash('sha256').update(JSON.stringify(canonicalPolicy), 'utf8').digest('hex');
  return { policy: canonicalPolicy, policyHash };
}

// 仅验证候选内容和摘要的一致性。政策发布签名/实时授权须在后续独立验证。
export function validateIncentiveProgramPolicyDraft(candidate) {
  exactFields(candidate, ['policy', 'policyHash'], 'candidate');
  const expected = buildIncentiveProgramPolicyDraft(candidate.policy);
  if (typeof candidate.policyHash !== 'string' || !/^[0-9a-f]{64}$/.test(candidate.policyHash) ||
      candidate.policyHash !== expected.policyHash) {
    deny('policyHash', 'does not match canonical policy');
  }
  return expected;
}
