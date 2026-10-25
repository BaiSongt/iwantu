import { createHash } from 'node:crypto';

// B1 仅对候选收据做结构校验与确定性哈希，不声称已经验证账本、政策或授权真实性。
export const INCENTIVE_TRIGGER_BINDING_DRAFT_VERSION = 'iwantu.incentive-trigger-binding/0.1';

export class IncentiveTriggerBindingDraftError extends Error {
  constructor(field, reason) {
    super(field + ': ' + reason);
    this.name = 'IncentiveTriggerBindingDraftError';
    this.code = 'INCENTIVE_TRIGGER_BINDING_DRAFT_INVALID';
    this.field = field;
  }
}

function deny(field, reason) { throw new IncentiveTriggerBindingDraftError(field, reason); }

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

function text(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    deny(field, 'must be a canonical text identifier');
  }
  return value;
}

function awardKey(value, field) {
  // 新协议的 programId/awardId 禁止分隔符歧义；历史奖励标识不做迁移或重解释。
  const result = text(value, field);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(result)) {
    deny(field, 'must be a separator-safe award key');
  }
  return result;
}

function hash(value, field) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    deny(field, 'must be a lowercase SHA-256 hex digest');
  }
  return value;
}

function canonicalAmount(value) {
  // ledger_entries.amount 是 Decimal(36,8)：整数部分最多 28 位，禁止浮点数及指数表示。
  if (typeof value !== 'string' || !/^(?:0|[1-9][0-9]{0,27})\.[0-9]{8}$/.test(value) ||
      /^0\.0{8}$/.test(value)) {
    deny('amountIwc', 'must be a positive canonical Decimal(36,8) string');
  }
  return value;
}

function utcTimestamp(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    deny('createdAt', 'must be a canonical UTC ISO timestamp with milliseconds');
  }
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

const EVIDENCE_FIELDS = Object.freeze([
  'protocol', 'awardLedgerTransactionId', 'awardTransactionHash', 'programId',
  'programPolicyVersion', 'programPolicyHash', 'awardId', 'beneficiaryPrincipalId',
  'amountIwc', 'currency', 'triggerType', 'settlementId', 'settlementHash',
  'triggerEvidenceHash', 'authorityEvidence', 'createdAt',
]);
const AUTHORITY_FIELDS = Object.freeze(['type', 'receiptId', 'receiptHash', 'beneficiaryPrincipalId', 'programPolicyHash']);

export function buildIncentiveTriggerBindingDraft(input) {
  exactFields(input, EVIDENCE_FIELDS, 'evidence');
  if (input.protocol !== INCENTIVE_TRIGGER_BINDING_DRAFT_VERSION) deny('protocol', 'unsupported version');
  if (input.currency !== 'IWC') deny('currency', 'only IWC is supported');
  if (input.triggerType !== 'terminal_settlement') deny('triggerType', 'unsupported trigger type');
  exactFields(input.authorityEvidence, AUTHORITY_FIELDS, 'authorityEvidence');
  if (input.authorityEvidence.type !== 'policy_authorization_reference') {
    deny('authorityEvidence.type', 'must refer to a policy authorization fact');
  }
  const evidence = {
    protocol: INCENTIVE_TRIGGER_BINDING_DRAFT_VERSION,
    awardLedgerTransactionId: text(input.awardLedgerTransactionId, 'awardLedgerTransactionId'),
    awardTransactionHash: hash(input.awardTransactionHash, 'awardTransactionHash'),
    programId: awardKey(input.programId, 'programId'),
    programPolicyVersion: text(input.programPolicyVersion, 'programPolicyVersion'),
    programPolicyHash: hash(input.programPolicyHash, 'programPolicyHash'),
    awardId: awardKey(input.awardId, 'awardId'),
    beneficiaryPrincipalId: text(input.beneficiaryPrincipalId, 'beneficiaryPrincipalId'),
    amountIwc: canonicalAmount(input.amountIwc),
    currency: 'IWC',
    triggerType: 'terminal_settlement',
    settlementId: text(input.settlementId, 'settlementId'),
    settlementHash: hash(input.settlementHash, 'settlementHash'),
    triggerEvidenceHash: hash(input.triggerEvidenceHash, 'triggerEvidenceHash'),
    authorityEvidence: {
      type: 'policy_authorization_reference',
      receiptId: text(input.authorityEvidence.receiptId, 'authorityEvidence.receiptId'),
      receiptHash: hash(input.authorityEvidence.receiptHash, 'authorityEvidence.receiptHash'),
      beneficiaryPrincipalId: text(input.authorityEvidence.beneficiaryPrincipalId, 'authorityEvidence.beneficiaryPrincipalId'),
      programPolicyHash: hash(input.authorityEvidence.programPolicyHash, 'authorityEvidence.programPolicyHash'),
    },
    createdAt: utcTimestamp(input.createdAt),
  };
  if (evidence.authorityEvidence.beneficiaryPrincipalId !== evidence.beneficiaryPrincipalId ||
      evidence.authorityEvidence.programPolicyHash !== evidence.programPolicyHash) {
    deny('authorityEvidence', 'Principal/Policy binding differs from award evidence');
  }
  const canonicalEvidence = canonicalize(evidence);
  const receiptHash = createHash('sha256').update(JSON.stringify(canonicalEvidence), 'utf8').digest('hex');
  return { evidence: canonicalEvidence, receiptHash };
}

// 这里只核对候选内容与哈希的一致性。B2/B3 必须用 PostgreSQL 原始事实独立复算再持久化。
export function validateIncentiveTriggerBindingDraft(receipt) {
  exactFields(receipt, ['evidence', 'receiptHash'], 'receipt');
  const expected = buildIncentiveTriggerBindingDraft(receipt.evidence);
  if (hash(receipt.receiptHash, 'receiptHash') !== expected.receiptHash) {
    deny('receiptHash', 'does not match canonical evidence');
  }
  return expected;
}
