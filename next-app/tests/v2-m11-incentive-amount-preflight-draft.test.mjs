import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IncentiveAmountPreflightDraftError,
  inspectDeclaredIncentiveAmountDraft,
} from '../src/lib/integrity/incentive-amount-preflight-draft.mjs';

const INPUT = {
  rewardAmountIwc: '12.00000000',
  declaredCaps: {
    currency: 'IWC', perAwardCapIwc: '12.00000000',
    programRemainingIwc: '100.00000000', poolAvailableIwc: '250.00000000',
  },
};
const withCaps = (patch) => ({ ...INPUT, declaredCaps: { ...INPUT.declaredCaps, ...patch } });

test('P1f：逐分毫精确比较，额度相等可通过纯算术门禁', () => {
  const value = inspectDeclaredIncentiveAmountDraft(INPUT);
  assert.equal(value.protocol, 'iwantu.incentive-amount-preflight/0.1');
  assert.equal(value.arithmeticStatus, 'within_unverified_declared_caps');
  assert.equal(value.rewardAmountIwc, '12.00000000');
  assert.equal(value.authorizationStatus, 'incomplete');
  assert.equal(value.economicWritePermitted, false);
  assert.equal(value.r8RiskEvaluationEligible, false);
  assert.equal(Object.hasOwn(value, 'authorized'), false);
});

test('P1f：Decimal(36,8) 极值与最小单位均不会经过浮点数', () => {
  const max = '9999999999999999999999999999.99999999';
  const result = inspectDeclaredIncentiveAmountDraft({
    rewardAmountIwc: max,
    declaredCaps: { currency: 'IWC', perAwardCapIwc: max,
      programRemainingIwc: max, poolAvailableIwc: max },
  });
  assert.equal(result.rewardAmountIwc, max);
  const tiny = inspectDeclaredIncentiveAmountDraft({
    rewardAmountIwc: '0.00000001',
    declaredCaps: { currency: 'IWC', perAwardCapIwc: '0.00000001',
      programRemainingIwc: '0.00000001', poolAvailableIwc: '0.00000001' },
  });
  assert.equal(tiny.arithmeticStatus, 'within_unverified_declared_caps');
});

test('P1f：单笔额度不足必须 Fail-Closed', () => {
  assert.throws(() => inspectDeclaredIncentiveAmountDraft(withCaps({
    perAwardCapIwc: '11.99999999',
  })), { name: 'IncentiveAmountPreflightDraftError', field: 'declaredCaps.perAwardCapIwc' });
});

test('P1f：计划剩余额度和奖池余额分别不足必须 Fail-Closed', () => {
  for (const field of ['programRemainingIwc', 'poolAvailableIwc']) {
    assert.throws(() => inspectDeclaredIncentiveAmountDraft(withCaps({ [field]: '11.99999999' })),
      { name: 'IncentiveAmountPreflightDraftError', field: 'declaredCaps.' + field });
  }
});

test('P1f：零剩余预算合法表达但不得批准正金额奖励', () => {
  for (const field of ['perAwardCapIwc', 'programRemainingIwc', 'poolAvailableIwc']) {
    assert.throws(() => inspectDeclaredIncentiveAmountDraft(withCaps({ [field]: '0.00000000' })),
      IncentiveAmountPreflightDraftError);
  }
  assert.throws(() => inspectDeclaredIncentiveAmountDraft({ ...INPUT, rewardAmountIwc: '0.00000000' }),
    { field: 'rewardAmountIwc' });
});

test('P1f：拒绝 Number、科学计数、截断精度、负数及超出 Decimal(36,8) 的数字', () => {
  for (const amount of [12, 0.1, '1e1', '12', '12.0', '12.000000000',
    ' 12.00000000', '-12.00000000', '+12.00000000',
    '99999999999999999999999999999.00000000']) {
    assert.throws(() => inspectDeclaredIncentiveAmountDraft({ ...INPUT, rewardAmountIwc: amount }),
      IncentiveAmountPreflightDraftError);
  }
});

test('P1f：所有上限都必须存在、规范且只能是 IWC', () => {
  for (const bad of [
    { currency: 'USD' }, { perAwardCapIwc: 12 },
    { programRemainingIwc: '-1.00000000' }, { poolAvailableIwc: null },
  ]) {
    assert.throws(() => inspectDeclaredIncentiveAmountDraft(withCaps(bad)),
      IncentiveAmountPreflightDraftError);
  }
  const absent = { ...INPUT.declaredCaps };
  delete absent.perAwardCapIwc;
  assert.throws(() => inspectDeclaredIncentiveAmountDraft({ ...INPUT, declaredCaps: absent }),
    IncentiveAmountPreflightDraftError);
});

test('P1f：拒绝注入授权状态、未知字段、数组和非纯净原型', () => {
  for (const input of [
    { ...INPUT, authorized: true },
    { ...INPUT, declaredCaps: { ...INPUT.declaredCaps, trusted: true } },
    { ...INPUT, declaredCaps: [] },
    Object.assign(Object.create({ authorized: true }), INPUT),
  ]) {
    assert.throws(() => inspectDeclaredIncentiveAmountDraft(input), IncentiveAmountPreflightDraftError);
  }
});

test('P1f：相同输入重复运算结果确定一致且不变更调用方事实', () => {
  const original = structuredClone(INPUT);
  assert.deepEqual(inspectDeclaredIncentiveAmountDraft(INPUT), inspectDeclaredIncentiveAmountDraft(INPUT));
  assert.deepEqual(INPUT, original);
});
