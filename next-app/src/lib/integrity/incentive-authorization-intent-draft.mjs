import { sha256Evidence } from '../authority/authority-snapshot.mjs';
import { validateIncentiveProgramPolicyDraft } from './incentive-program-policy-draft.mjs';

// P1b 只冻结待签名的业务意图；签名、实时授权、Nonce 消费与账本入账均不在本模块实现。
export const INCENTIVE_AUTHORIZATION_INTENT_DRAFT_VERSION = 'iwantu.incentive-authorization-intent/0.1';
export const INCENTIVE_POLICY_PUBLISH_ACTION_DRAFT = 'incentive.policy.publish';
export const INCENTIVE_AWARD_ISSUE_ACTION_DRAFT = 'incentive.award.issue';

export class IncentiveAuthorizationIntentDraftError extends Error {
  constructor(field, reason) {
    super(field + ': ' + reason);
    this.name = 'IncentiveAuthorizationIntentDraftError';
    this.code = 'INCENTIVE_AUTHORIZATION_INTENT_DRAFT_INVALID';
    this.field = field;
  }
}

const deny = (field, reason) => { throw new IncentiveAuthorizationIntentDraftError(field, reason); };

function exactFields(value, fields, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== fields.length ||
      fields.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !fields.includes(key))) {
    deny(field, 'missing, unexpected or unsafe field');
  }
}

function textId(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    deny(field, 'must be a canonical identifier');
  }
  return value;
}

function awardId(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    deny('awardId', 'must be a separator-safe award identifier');
  }
  return value;
}

function hash(value, field) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    deny(field, 'must be a lowercase SHA-256 digest');
  }
  return value;
}

function policyCandidate(value) {
  // 候选 policyHash 必须从规范化政策重新计算，不能相信调用方传入的摘要。
  return validateIncentiveProgramPolicyDraft(value);
}

function wrapIntent(payload) {
  return { payload, payloadHash: sha256Evidence(payload) };
}

// 对接 M3 economic-command/0.1 时，payloadHash 应作为签名命令的 payloadHash。
// action 名称目前是评审候选，不代表现有 Mandate 已授予相应权限。
export function buildIncentivePolicyPublicationIntentDraft(input) {
  exactFields(input, ['policyCandidate'], 'publication');
  const { policy, policyHash } = policyCandidate(input.policyCandidate);
  return wrapIntent({
    protocol: INCENTIVE_AUTHORIZATION_INTENT_DRAFT_VERSION,
    action: INCENTIVE_POLICY_PUBLISH_ACTION_DRAFT,
    programId: policy.programId,
    policyVersion: policy.policyVersion,
    policyHash,
    issuerPrincipalId: policy.issuerPrincipalId,
  });
}

export function buildIncentiveAwardIssueIntentDraft(input) {
  exactFields(input, ['policyCandidate', 'trigger', 'beneficiaryPrincipalId', 'awardId'], 'award');
  exactFields(input.trigger, ['settlementId', 'settlementHash', 'settlementType', 'triggerEvidenceHash'], 'trigger');
  const { policy, policyHash } = policyCandidate(input.policyCandidate);
  const settlementId = textId(input.trigger.settlementId, 'trigger.settlementId');
  const settlementHash = hash(input.trigger.settlementHash, 'trigger.settlementHash');
  const triggerEvidenceHash = hash(input.trigger.triggerEvidenceHash, 'trigger.triggerEvidenceHash');
  const settlementType = input.trigger.settlementType;
  if (!policy.eligibleSettlementTypes.includes(settlementType)) {
    deny('trigger.settlementType', 'not eligible under this candidate policy');
  }
  const beneficiaryPrincipalId = textId(input.beneficiaryPrincipalId, 'beneficiaryPrincipalId');
  const normalizedAwardId = awardId(input.awardId);

  // 去重作用域不包含受益 Principal：跨主体重放同一结算/角色/槽位必须在数据库层冲突。
  // 此处只计算候选指纹，未执行 UNIQUE 约束或历史事实查询。
  const deduplicationFingerprint = sha256Evidence({
    protocol: 'iwantu.incentive-award-deduplication/0.1',
    programId: policy.programId,
    policyVersion: policy.policyVersion,
    policyHash,
    settlementId,
    beneficiaryRole: policy.beneficiaryRole,
    awardSlot: policy.awardSlot,
  });
  return {
    ...wrapIntent({
      protocol: INCENTIVE_AUTHORIZATION_INTENT_DRAFT_VERSION,
      action: INCENTIVE_AWARD_ISSUE_ACTION_DRAFT,
      programId: policy.programId,
      policyVersion: policy.policyVersion,
      policyHash,
      issuerPrincipalId: policy.issuerPrincipalId,
      settlementId,
      settlementHash,
      settlementType,
      triggerEvidenceHash,
      beneficiaryPrincipalId,
      beneficiaryRole: policy.beneficiaryRole,
      awardSlot: policy.awardSlot,
      awardId: normalizedAwardId,
      rewardFormula: policy.rewardFormula,
      currency: 'IWC',
      deduplicationScope: policy.deduplicationScope,
    }),
    deduplicationFingerprint,
  };
}
