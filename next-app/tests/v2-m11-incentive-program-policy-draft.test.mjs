import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildIncentiveProgramPolicyDraft, validateIncentiveProgramPolicyDraft,
  INCENTIVE_PROGRAM_POLICY_DRAFT_VERSION, IncentiveProgramPolicyDraftError,
} from '../src/lib/integrity/incentive-program-policy-draft.mjs';

const fixture = () => ({
  protocol: INCENTIVE_PROGRAM_POLICY_DRAFT_VERSION,
  programId: 'settlement-incentive', policyVersion: 'v1', issuerPrincipalId: 'principal-governance',
  triggerType: 'terminal_settlement', eligibleSettlementTypes: ['mutual_split', 'full_settlement'],
  beneficiaryRole: 'supplier', awardSlot: 'completion',
  rewardFormula: { kind: 'fixed_amount', amountIwc: '12.00000000' },
  effectiveFrom: '2026-10-24T00:00:00.000Z', effectiveUntil: '2026-12-01T00:00:00.000Z',
  deduplicationScope: 'program_policy_settlement_role_slot',
});
const reject = (fn) => assert.throws(fn, IncentiveProgramPolicyDraftError);

test('P1a：字段顺序和终局类型顺序变化，不改变规范化政策与摘要', () => {
  const original = buildIncentiveProgramPolicyDraft(fixture());
  const shuffled = Object.fromEntries(Object.entries(fixture()).reverse());
  shuffled.eligibleSettlementTypes.reverse();
  shuffled.rewardFormula = { amountIwc: '12.00000000', kind: 'fixed_amount' };
  assert.deepEqual(buildIncentiveProgramPolicyDraft(shuffled), original);
  assert.deepEqual(validateIncentiveProgramPolicyDraft(original), original);
  assert.match(original.policyHash, /^[0-9a-f]{64}$/);
  assert.equal(original.policyHash, '63566eaefba6f45cc822e32c200f25852b6e31fa2e5362ed4ee09da52dfb03f3');
  assert.deepEqual(original.policy.eligibleSettlementTypes, ['full_settlement', 'mutual_split']);
});

test('P1a：政策身份、受益角色、金额、有效期和奖励槽位改变摘要', () => {
  const initial = buildIncentiveProgramPolicyDraft(fixture()).policyHash;
  for (const patch of [
    {programId: 'other-program'}, {policyVersion: 'v2'}, {issuerPrincipalId: 'principal-other'},
    {beneficiaryRole: 'buyer'}, {awardSlot: 'review'},
    {effectiveUntil: '2026-11-01T00:00:00.000Z'},
    {rewardFormula: {kind:'fixed_amount',amountIwc:'12.00000001'}},
    {eligibleSettlementTypes: ['full_refund']},
  ]) {
    assert.notEqual(buildIncentiveProgramPolicyDraft({...fixture(),...patch}).policyHash, initial);
  }
});

test('P1a：拒绝重复、未知、缺失终局结算类型', () => {
  for (const eligibleSettlementTypes of [[], ['full_settlement','full_settlement'], ['created'],
    ['full_settlement','mutual_split','full_refund','created'], 'full_settlement']) {
    reject(() => buildIncentiveProgramPolicyDraft({...fixture(),eligibleSettlementTypes}));
  }
});

test('P1a：拒绝歧义的 Program/Version/Slot 和非规范发布主体', () => {
  for (const field of ['programId','policyVersion','awardSlot']) {
    for (const value of ['', 'a:b', ' a', '中 文', 'a'.repeat(129)]) {
      reject(() => buildIncentiveProgramPolicyDraft({...fixture(),[field]:value}));
    }
  }
  for (const issuerPrincipalId of ['', ' issuer', 'issuer\nother', 'issuer '.repeat(50)]) {
    reject(() => buildIncentiveProgramPolicyDraft({...fixture(),issuerPrincipalId}));
  }
});

test('P1a：拒绝金额浮点/零/指数/超精度及时间反转、非UTC日期', () => {
  for (const amountIwc of ['0.00000000', '1', '01.00000000', '-1.00000000', '1e3',
    '0.000000001', 1.0, '1'.repeat(29)+'.00000000']) {
    reject(() => buildIncentiveProgramPolicyDraft({...fixture(), rewardFormula: {kind: 'fixed_amount',amountIwc}}));
  }
  for (const patch of [
    {effectiveUntil: '2026-10-24T00:00:00.000Z'},
    {effectiveUntil: '2026-10-23T00:00:00.000Z'},
    {effectiveFrom: '2026-02-30T00:00:00.000Z'},
    {effectiveUntil: '2026-12-01T08:00:00+08:00'},
  ]) reject(() => buildIncentiveProgramPolicyDraft({...fixture(),...patch}));
});

test('P1a：对象形状和协议版本必须严格一致，拒绝冒充授权', () => {
  for (const patch of [{isAuthorized: true}, {protocol: 'iwantu.incentive-program-policy/0.2'},
    {deduplicationScope:'settlement_only'}, {beneficiaryRole: 'any'}, {triggerType:'account_registration'}]) {
    reject(() => buildIncentiveProgramPolicyDraft({...fixture(),...patch}));
  }
  reject(() => buildIncentiveProgramPolicyDraft({...fixture(),rewardFormula:{...fixture().rewardFormula,verified:true}}));
  reject(() => buildIncentiveProgramPolicyDraft(Object.assign(Object.create(null),fixture())));
  const original = buildIncentiveProgramPolicyDraft(fixture());
  reject(() => validateIncentiveProgramPolicyDraft({...original,policyHash: 'f'.repeat(64)}));
  reject(() => validateIncentiveProgramPolicyDraft({...original,policy:{...original.policy,awardSlot:'forged'}}));
});

test('P1a：候选输出不得包含已授权、不可变存储、实际发奖或舞弊结论', () => {
  const candidate=buildIncentiveProgramPolicyDraft(fixture());
  assert.deepEqual(Object.keys(candidate),['policy','policyHash']);
  for (const field of ['verified','signed','authorized','immutable','ledgerTransaction','signals','punishment']) {
    assert.equal(Object.hasOwn(candidate,field),false);
  }
});
