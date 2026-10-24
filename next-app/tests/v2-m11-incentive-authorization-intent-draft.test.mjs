import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIncentiveAwardIssueIntentDraft,
  buildIncentivePolicyPublicationIntentDraft,
  INCENTIVE_AUTHORIZATION_INTENT_DRAFT_VERSION,
  INCENTIVE_AWARD_ISSUE_ACTION_DRAFT,
  INCENTIVE_POLICY_PUBLISH_ACTION_DRAFT,
  IncentiveAuthorizationIntentDraftError,
} from '../src/lib/integrity/incentive-authorization-intent-draft.mjs';
import { buildIncentiveProgramPolicyDraft, INCENTIVE_PROGRAM_POLICY_DRAFT_VERSION } from '../src/lib/integrity/incentive-program-policy-draft.mjs';

const policy = () => buildIncentiveProgramPolicyDraft({
  protocol: INCENTIVE_PROGRAM_POLICY_DRAFT_VERSION,
  programId: 'settlement-incentive', policyVersion: 'v1', issuerPrincipalId: 'principal-governance',
  triggerType: 'terminal_settlement', eligibleSettlementTypes: ['mutual_split', 'full_settlement'],
  beneficiaryRole: 'supplier', awardSlot: 'completion',
  rewardFormula: { kind: 'fixed_amount', amountIwc: '12.00000000' },
  effectiveFrom: '2026-10-24T00:00:00.000Z', effectiveUntil: '2026-12-01T00:00:00.000Z',
  deduplicationScope: 'program_policy_settlement_role_slot',
});
const award = () => ({
  policyCandidate: policy(),
  trigger: { settlementId: 'settlement-1', settlementHash: 'a'.repeat(64),
    settlementType: 'full_settlement', triggerEvidenceHash: 'b'.repeat(64) },
  beneficiaryPrincipalId: 'supplier-principal', awardId: 'completion-1',
});
const deny = (fn) => assert.throws(fn, IncentiveAuthorizationIntentDraftError);

test('P1b：发布与发奖意图具有不同的签名动作及固定的协议域', () => {
  const publish = buildIncentivePolicyPublicationIntentDraft({ policyCandidate: policy() });
  const issue = buildIncentiveAwardIssueIntentDraft(award());
  assert.equal(publish.payload.protocol, INCENTIVE_AUTHORIZATION_INTENT_DRAFT_VERSION);
  assert.equal(publish.payload.action, INCENTIVE_POLICY_PUBLISH_ACTION_DRAFT);
  assert.equal(issue.payload.action, INCENTIVE_AWARD_ISSUE_ACTION_DRAFT);
  assert.notEqual(publish.payloadHash, issue.payloadHash);
  assert.equal(publish.payload.policyHash, issue.payload.policyHash);
  assert.match(issue.deduplicationFingerprint, /^[a-f0-9]{64}$/);
});

test('P1b：字段顺序、政策枚举顺序变化不影响待签意图', () => {
  const original = award();
  const shuffledPolicy = { ...original.policyCandidate.policy,
    eligibleSettlementTypes: [...original.policyCandidate.policy.eligibleSettlementTypes].reverse() };
  const shuffled = Object.fromEntries(Object.entries(original).reverse());
  shuffled.trigger = Object.fromEntries(Object.entries(original.trigger).reverse());
  shuffled.policyCandidate = buildIncentiveProgramPolicyDraft(shuffledPolicy);
  assert.deepEqual(buildIncentiveAwardIssueIntentDraft(shuffled), buildIncentiveAwardIssueIntentDraft(original));
});

test('P1b：签名载荷必须绑定精确政策、结算、奖励对象与金额', () => {
  const original = award();
  const baseline = buildIncentiveAwardIssueIntentDraft(original);
  for (const patch of [
    { beneficiaryPrincipalId: 'other-principal' }, { awardId: 'other-award' },
    { trigger: { ...original.trigger, settlementId: 'settlement-2' } },
    { trigger: { ...original.trigger, settlementHash: 'c'.repeat(64) } },
    { trigger: { ...original.trigger, triggerEvidenceHash: 'c'.repeat(64) } },
    { policyCandidate: buildIncentiveProgramPolicyDraft({ ...policy().policy,
      rewardFormula: { kind: 'fixed_amount', amountIwc: '13.00000000' } }) },
  ]) assert.notEqual(buildIncentiveAwardIssueIntentDraft({ ...original, ...patch }).payloadHash, baseline.payloadHash);
});

test('P1b：同一政策/结算/角色/奖励槽位跨 Principal 使用相同去重指纹', () => {
  const original = award();
  const first = buildIncentiveAwardIssueIntentDraft(original);
  const other = buildIncentiveAwardIssueIntentDraft({ ...original,
    beneficiaryPrincipalId: 'different-principal', awardId: 'different-award' });
  assert.equal(first.deduplicationFingerprint, other.deduplicationFingerprint);
  assert.notEqual(first.payloadHash, other.payloadHash);
});

test('P1b：拒绝没有政策资格的结算及无效哈希/歧义标识', () => {
  for (const settlementType of ['full_refund', 'pending', '', null]) {
    deny(() => buildIncentiveAwardIssueIntentDraft({ ...award(),
      trigger: { ...award().trigger, settlementType } }));
  }
  for (const patch of [
    { trigger: { ...award().trigger, settlementHash: 'A'.repeat(64) } },
    { trigger: { ...award().trigger, triggerEvidenceHash: 'bad' } },
    { awardId: 'a:b' }, { awardId: 'a\nb' }, { beneficiaryPrincipalId: ' a' },
    { trigger: { ...award().trigger, settlementId: '' } },
  ]) deny(() => buildIncentiveAwardIssueIntentDraft({ ...award(), ...patch }));
});

test('P1b：拒绝冒充已签名、已授权、历史 AgentVersion 或账本事实的字段', () => {
  for (const patch of [
    { authorized: true }, { authoritySnapshotId: 'fabricated' }, { signature: 'fake' },
    { executedAgentVersionId: 'current-version' }, { ledgerTransactionHash: 'f'.repeat(64) },
  ]) deny(() => buildIncentiveAwardIssueIntentDraft({ ...award(), ...patch }));
  deny(() => buildIncentivePolicyPublicationIntentDraft({ policyCandidate: policy(), verified: true }));
  deny(() => buildIncentiveAwardIssueIntentDraft({ ...award(), trigger: { ...award().trigger, verified: true } }));
  deny(() => buildIncentiveAwardIssueIntentDraft(Object.assign(Object.create(null), award())));
});

test('P1b：伪造候选政策哈希必须拒绝，返回对象不含可信状态', () => {
  assert.throws(() => buildIncentiveAwardIssueIntentDraft({ ...award(),
    policyCandidate: { ...policy(), policyHash: 'f'.repeat(64) } }));
  const result = buildIncentiveAwardIssueIntentDraft(award());
  assert.deepEqual(Object.keys(result).sort(), ['deduplicationFingerprint', 'payload', 'payloadHash']);
  for (const field of ['verified', 'authorized', 'signed', 'nonceConsumed', 'receiptPersisted', 'riskSignal']) {
    assert.equal(Object.hasOwn(result, field), false);
  }
});
