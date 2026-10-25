import { sha256Evidence } from '../authority/authority-snapshot.mjs';
import { buildIncentiveObservation } from './incentive-observation.mjs';

export const INCENTIVE_FARMING_SHADOW_PROTOCOL = 'iwantu.incentive-farming-shadow/0.1';
export const INCENTIVE_FARMING_SHADOW_RULE_VERSION = 'iwantu.integrity-rule.r8/0.1-exp.1';
export const INCENTIVE_FARMING_SHADOW_POLICY = Object.freeze({
  minIndependentSettlements: 5,
  highSubsidyRewardToGrossBps: 10000,
  minHighSubsidySettlementShareBps: 8000,
  minAggregateIndependentRewardToGrossBps: 10000,
});

const SCALE = 100_000_000n;
const POLICY_HASH = sha256Evidence(INCENTIVE_FARMING_SHADOW_POLICY);
const POSSIBLE_LEGITIMATE_EXPLANATIONS = [
  'approved_promotional_subsidy', 'multiple_legitimate_award_slots', 'small_value_settlement_campaign',
];

export class IncentiveFarmingShadowError extends Error {
  constructor(code) {
    super(code === 'R8_INPUT_INVALID' ? 'Invalid incentive shadow evaluation options'
      : 'Incentive observation could not be verified for shadow evaluation');
    this.name = 'IncentiveFarmingShadowError';
    this.code = code;
  }
}

const deny = (code = 'R8_OBSERVATION_INVALID') => { throw new IncentiveFarmingShadowError(code); };

function plainObject(value) {
  return value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype;
}

function evaluationTime(options) {
  if (!plainObject(options) || Reflect.ownKeys(options).some((key) => key !== 'now')) deny('R8_INPUT_INVALID');
  const value = options.now === undefined ? new Date() : options.now;
  const iso = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
  if (!(value instanceof Date) && !iso) deny('R8_INPUT_INVALID');
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime()) || (iso && date.toISOString() !== value) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date.toISOString())) deny('R8_INPUT_INVALID');
  return date;
}

// Canonical JSON hashing intentionally omits undefined values. Reject values
// outside plain JSON first, so extra/private fields cannot hide from equality.
function requirePlainJson(value, seen = new Set(), depth = 0) {
  if (depth > 32) deny();
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) deny();
    return;
  }
  const array = Array.isArray(value);
  if ((!array && !plainObject(value)) || seen.has(value)) deny();
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== 'string' ||
      ((!array || key !== 'length') && !Object.getOwnPropertyDescriptor(value, key)?.enumerable) ||
      Object.getOwnPropertyDescriptor(value, key)?.get || Object.getOwnPropertyDescriptor(value, key)?.set)) deny();
  if (array && (Object.keys(value).length !== value.length ||
      keys.some((key) => key !== 'length' && !/^(0|[1-9][0-9]*)$/.test(key)))) deny();
  seen.add(value);
  for (const item of Object.values(value)) requirePlainJson(item, seen, depth + 1);
  seen.delete(value);
}

function verifiedObservation(observation) {
  try {
    requirePlainJson(observation);
    if (!plainObject(observation)) deny();
    const rebuilt = buildIncentiveObservation({
      programId: observation.programId,
      windowStart: observation.observationWindow?.start,
      windowEnd: observation.observationWindow?.endExclusive,
    }, {
      records: observation.records,
      unboundPostedCandidateCount: observation.attribution?.unboundPostedCandidateCount,
    });
    if (sha256Evidence(observation) !== sha256Evidence(rebuilt)) deny();
    return rebuilt;
  } catch {
    deny();
  }
}

function units(amount) {
  const [whole, fraction] = amount.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction);
}

function decimal(value) {
  return `${value / SCALE}.${String(value % SCALE).padStart(8, '0')}`;
}

function ratio(numerator, denominator) {
  return decimal(denominator === 0n ? 0n : numerator * SCALE / denominator);
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function settlementGroups(records) {
  const settlements = new Map();
  for (const record of records) {
    if (!settlements.has(record.settlementId)) settlements.set(record.settlementId, []);
    settlements.get(record.settlementId).push(record);
  }
  return [...settlements.keys()].sort(compare).map((id) => {
    const awards = settlements.get(id);
    const first = awards[0];
    const reward = awards.reduce((sum, award) => sum + units(award.amountIwc), 0n);
    const gross = units(first.settlementGrossIwc);
    const unique = (field) => [...new Set(awards.map((award) => award[field]))].sort(compare);
    return {
      reward, gross,
      evidence: {
        settlementId: id, settlementHash: first.settlementHash, settlementType: first.settlementType,
        counterpartyPrincipalId: first.counterpartyPrincipalId,
        independent: first.beneficiaryPrincipalId !== first.counterpartyPrincipalId,
        awardIds: unique('awardId'), policyHashes: unique('policyHash'),
        ledgerTransactionHashes: unique('ledgerTransactionHash'), receiptHashes: unique('receiptHash'),
        totalRewardIwc: decimal(reward), grossIwc: decimal(gross), rewardToGrossRatio: ratio(reward, gross),
        highSubsidy: reward * 10000n >= gross * BigInt(INCENTIVE_FARMING_SHADOW_POLICY.highSubsidyRewardToGrossBps),
      },
    };
  });
}

function finding(principalId, records) {
  const groups = settlementGroups(records);
  const independent = groups.filter((group) => group.evidence.independent);
  const highSubsidy = independent.filter((group) => group.evidence.highSubsidy);
  const reward = independent.reduce((sum, group) => sum + group.reward, 0n);
  const gross = independent.reduce((sum, group) => sum + group.gross, 0n);
  const enough = independent.length >= INCENTIVE_FARMING_SHADOW_POLICY.minIndependentSettlements;
  const matched = enough &&
    BigInt(highSubsidy.length) * 10000n >= BigInt(independent.length) * BigInt(INCENTIVE_FARMING_SHADOW_POLICY.minHighSubsidySettlementShareBps) &&
    reward * 10000n >= gross * BigInt(INCENTIVE_FARMING_SHADOW_POLICY.minAggregateIndependentRewardToGrossBps);
  return {
    principalId,
    state: !enough ? 'insufficient_evidence' : matched ? 'candidate_match' : 'clear',
    candidatePattern: matched ? 'repeated_reward_dominance' : null,
    metrics: {
      independentSettlementCount: independent.length,
      excludedSamePrincipalSettlementCount: groups.length - independent.length,
      independentCounterpartyPrincipalCount: new Set(independent.map((group) => group.evidence.counterpartyPrincipalId)).size,
      highSubsidySettlementCount: highSubsidy.length,
      highSubsidySettlementShare: ratio(BigInt(highSubsidy.length), BigInt(independent.length)),
      totalIndependentRewardIwc: decimal(reward), totalIndependentGrossIwc: decimal(gross),
      aggregateIndependentRewardToGrossRatio: ratio(reward, gross),
    },
    settlementEvidence: groups.map((group) => group.evidence),
  };
}

// Real historical observations feed this experimental statistical report.
// A match describes an economic pattern, including lawful promotional cases;
// this module never emits IntegritySignals or changes any economic state.
export function evaluateIncentiveFarmingShadow(observation, options = {}) {
  const now = evaluationTime(options);
  const source = verifiedObservation(observation);
  let state;
  let reason = null;
  let findings = [];
  if (source.attribution.unboundPostedCandidateCount > 0) {
    state = 'unavailable';
    reason = 'unbound_incentive_candidates';
  } else if (new Date(source.observationWindow.endExclusive) > now) {
    state = 'unavailable';
    reason = 'window_not_closed';
  } else if (source.records.length === 0) {
    state = 'insufficient_evidence';
    reason = 'no_verified_awards';
  } else {
    const principals = new Map();
    for (const record of source.records) {
      if (!principals.has(record.beneficiaryPrincipalId)) principals.set(record.beneficiaryPrincipalId, []);
      principals.get(record.beneficiaryPrincipalId).push(record);
    }
    findings = [...principals.keys()].sort(compare).map((id) => finding(id, principals.get(id)));
    const allInsufficient = findings.every((result) => result.state === 'insufficient_evidence');
    state = allInsufficient ? 'insufficient_evidence' : 'evaluated';
    if (allInsufficient) reason = 'insufficient_independent_settlements';
  }
  const result = {
    protocol: INCENTIVE_FARMING_SHADOW_PROTOCOL, ruleCode: 'R8_INCENTIVE_FARMING',
    ruleVersion: INCENTIVE_FARMING_SHADOW_RULE_VERSION, mode: 'shadow', productionPolicyStatus: 'not_approved',
    policy: INCENTIVE_FARMING_SHADOW_POLICY, policyHash: POLICY_HASH,
    programId: source.programId, observationWindow: { ...source.observationWindow },
    sourceObservationFingerprint: source.evidenceFingerprint, state, reason, findings,
    candidatePrincipalCount: findings.filter((result) => result.state === 'candidate_match').length,
    interpretation: 'economic_pattern_only',
    possibleLegitimateExplanations: [...POSSIBLE_LEGITIMATE_EXPLANATIONS],
    signalEmitted: false, automaticPunishmentApplied: false, capitalLineageTraced: false,
  };
  return { ...result, evaluationFingerprint: sha256Evidence(result) };
}
