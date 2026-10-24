import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildProgramEntitlementFingerprintDraft,
  INCENTIVE_PROGRAM_ENTITLEMENT_DRAFT_VERSION,
  IncentiveProgramEntitlementDraftError,
} from '../src/lib/integrity/incentive-program-entitlement-draft.mjs';

const identity = () => ({
  programId: 'settlement-incentive',
  settlementId: 'settlement-1',
  beneficiaryRole: 'supplier',
  awardSlot: 'completion',
});
const build = (input) => buildProgramEntitlementFingerprintDraft(input);
const reject = (input) => assert.throws(() => build(input), IncentiveProgramEntitlementDraftError);

test('P1g：稳定权益键不依赖字段顺序', () => {
  assert.deepEqual(build(identity()), build(Object.fromEntries(Object.entries(identity()).reverse())));
  assert.equal(build(identity()).protocol, INCENTIVE_PROGRAM_ENTITLEMENT_DRAFT_VERSION);
  assert.match(build(identity()).fingerprint, /^[0-9a-f]{64}$/);
});

test('P1g：政策版本、政策哈希、奖项编号、金额和收款主体不可绕过去重域', () => {
  const sameEntitlement = identity();
  const baseline = build(sameEntitlement).fingerprint;
  // 函数只接受稳定权益身份；新政策相关字段不得注入指纹以制造唯一性。
  for (const malicious of [
    {policyVersion: 'v2'}, {policyHash: 'a'.repeat(64)}, {awardId: 'award-new'},
    {rewardAmountIwc: '1000000.00000000'}, {beneficiaryPrincipalId: 'different'},
  ]) reject({...sameEntitlement, ...malicious});
  assert.equal(build({...sameEntitlement}).fingerprint, baseline);
});

test('P1g：不同 Program / Settlement / role / slot 分别产生独立候选权益', () => {
  const baseline = build(identity()).fingerprint;
  for (const patch of [
    {programId: 'other-program'}, {settlementId: 'settlement-2'},
    {beneficiaryRole: 'buyer'}, {awardSlot: 'review'},
  ]) assert.notEqual(build({...identity(), ...patch}).fingerprint, baseline);
});

test('P1g：字段缺失、未知字段与非普通对象均拒绝', () => {
  const {awardSlot, ...missing} = identity();
  reject(missing);
  reject({...identity(), isAuthorized: true});
  reject(null);
  reject([]);
  reject(Object.assign(Object.create(null), identity()));
});

test('P1g：歧义 Program、Slot 或非规范 Settlement 均拒绝', () => {
  for (const key of ['programId', 'awardSlot']) {
    for (const value of ['', 'a:b', ' a', 'a'.repeat(129)]) reject({...identity(), [key]: value});
  }
  for (const value of ['', ' s', 's\nother', 'a'.repeat(201)]) {
    reject({...identity(), settlementId: value});
  }
});

test('P1g：拒绝伪造受益角色和跨主体扩展字段', () => {
  for (const value of ['operator', 'any', '', null]) reject({...identity(), beneficiaryRole: value});
  reject({...identity(), executedAgentVersionId: 'latest'});
});

test('P1g：输出不表示经济授权、持久化或风险结论', () => {
  const result = build(identity());
  assert.equal(result.governanceStatus, 'not_checked');
  assert.equal(result.storageUniquenessStatus, 'not_checked');
  assert.equal(result.economicWritePermitted, false);
  assert.equal(result.r8RiskEvaluationEligible, false);
  for (const field of ['authorized', 'signed', 'receiptPersisted', 'riskSignal', 'punishment']) {
    assert.equal(Object.hasOwn(result, field), false);
  }
});
