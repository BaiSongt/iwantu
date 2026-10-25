// P1f 只对候选金额与外部声明的额度进行定点运算；额度来源及实时授权均未验证。
// 不得将本模块返回值用于批准奖励、保留预算、修改 Ledger 或执行 Integrity 处罚。
export const INCENTIVE_AMOUNT_PREFLIGHT_DRAFT_VERSION = 'iwantu.incentive-amount-preflight/0.1';

export class IncentiveAmountPreflightDraftError extends Error {
  constructor(field, reason) {
    super(field + ': ' + reason);
    this.name = 'IncentiveAmountPreflightDraftError';
    this.code = 'INCENTIVE_AMOUNT_PREFLIGHT_DRAFT_INVALID';
    this.field = field;
  }
}

const deny = (field, reason) => { throw new IncentiveAmountPreflightDraftError(field, reason); };
const SCALE = 100_000_000n;
const DECIMAL_36_8 = /^(0|[1-9][0-9]{0,27})\.([0-9]{8})$/;

function exactFields(value, expected, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== expected.length ||
      expected.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !expected.includes(key))) {
    deny(field, 'requires a plain object with exactly the declared fields');
  }
}

function minorUnits(value, field, allowZero) {
  // 字符串必须完全符合 Decimal(36,8)，不接受 Number、指数、空白或舍入。
  const match = typeof value === 'string' ? DECIMAL_36_8.exec(value) : null;
  if (!match) deny(field, 'requires canonical Decimal(36,8) string');
  const amount = BigInt(match[1]) * SCALE + BigInt(match[2]);
  if (!allowZero && amount === 0n) deny(field, 'reward amount must be positive');
  return amount;
}

export function inspectDeclaredIncentiveAmountDraft(input) {
  exactFields(input, ['rewardAmountIwc', 'declaredCaps'], 'input');
  exactFields(input.declaredCaps, [
    'currency', 'perAwardCapIwc', 'programRemainingIwc', 'poolAvailableIwc',
  ], 'declaredCaps');
  if (input.declaredCaps.currency !== 'IWC') deny('declaredCaps.currency', 'only IWC is supported');

  const reward = minorUnits(input.rewardAmountIwc, 'rewardAmountIwc', false);
  const checks = [
    ['perAwardCapIwc', minorUnits(input.declaredCaps.perAwardCapIwc, 'declaredCaps.perAwardCapIwc', true)],
    ['programRemainingIwc', minorUnits(input.declaredCaps.programRemainingIwc, 'declaredCaps.programRemainingIwc', true)],
    ['poolAvailableIwc', minorUnits(input.declaredCaps.poolAvailableIwc, 'declaredCaps.poolAvailableIwc', true)],
  ];
  for (const [field, cap] of checks) {
    if (reward > cap) deny('declaredCaps.' + field, 'reward exceeds declared limit');
  }

  // 本结果仅证明 BigInt 运算下不超过调用方声明的三个上限。
  // 不证明政策已冻结、Mandate 有额度权限、Program 预算真实或奖池余额新鲜。
  return {
    protocol: INCENTIVE_AMOUNT_PREFLIGHT_DRAFT_VERSION,
    currency: 'IWC',
    rewardAmountIwc: input.rewardAmountIwc,
    arithmeticStatus: 'within_unverified_declared_caps',
    evidenceSourceStatus: 'not_checked',
    mandateEconomicLimitStatus: 'not_checked',
    programBudgetStatus: 'not_checked',
    incentivePoolBalanceStatus: 'not_checked',
    authorizationStatus: 'incomplete',
    economicWritePermitted: false,
    r8RiskEvaluationEligible: false,
  };
}
