import { sha256Evidence } from '../authority/authority-snapshot.mjs';

export const INCENTIVE_OBSERVATION_PROTOCOL = 'iwantu.incentive-observation/0.1';
export const MAX_INCENTIVE_OBSERVATION_RECORDS = 500;

const MAX_WINDOW_MS = 31 * 24 * 60 * 60 * 1000;
const SCALE = 100_000_000n;
const RECORD_FIELDS = [
  'awardId', 'programId', 'policyHash', 'policyVersion', 'settlementId', 'settlementHash',
  'settlementType', 'settlementCreatedAt', 'beneficiaryRole', 'awardSlot',
  'beneficiaryPrincipalId', 'counterpartyPrincipalId', 'amountIwc', 'settlementGrossIwc',
  'ledgerTransactionId', 'ledgerTransactionHash', 'receiptHash', 'authorizationId',
  'postedAt', 'policyRevokedAt',
];

export class IncentiveObservationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'IncentiveObservationError';
    this.code = code;
  }
}

function invalid(field, reason, code = 'R8_OBSERVATION_INVALID') {
  throw new IncentiveObservationError(code, `${field}: ${reason}`);
}

function exact(value, fields, field, code) {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== fields.length || fields.some((name) => !Object.hasOwn(value, name))) {
    invalid(field, 'requires the exact object fields', code);
  }
}

function identifier(value, field) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 200 ||
      value !== value.trim() || /[\u0000-\u001f\u007f]/.test(value)) {
    invalid(field, 'requires a canonical identifier');
  }
  return value;
}

function safeKey(value, field, code) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    invalid(field, 'requires a separator-safe identifier', code);
  }
  return value;
}

function digest(value, field) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) {
    invalid(field, 'requires lowercase SHA-256');
  }
  return value;
}

function dateValue(value, field, code, allowDate = false) {
  const canonical = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value);
  if (!canonical && !(allowDate && value instanceof Date)) {
    invalid(field, 'requires canonical millisecond UTC time', code);
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (!Number.isFinite(date.getTime()) || (canonical && date.toISOString() !== value) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(date.toISOString())) {
    invalid(field, 'requires a valid millisecond UTC time', code);
  }
  return date;
}

function amountUnits(value, field) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,27})\.[0-9]{8}$/.test(value)) {
    invalid(field, 'requires canonical Decimal(36,8) text');
  }
  const [whole, fraction] = value.split('.');
  const units = BigInt(whole) * SCALE + BigInt(fraction);
  if (units === 0n) invalid(field, 'must be positive');
  return units;
}

// Aggregated totals can exceed the storage limit of one Decimal(36,8) row.
function amountText(units) {
  return `${units / SCALE}.${String(units % SCALE).padStart(8, '0')}`;
}

function compare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function normalizeIncentiveObservationInput(input) {
  const code = 'R8_INPUT_INVALID';
  exact(input, ['programId', 'windowStart', 'windowEnd'], 'input', code);
  const programId = safeKey(input.programId, 'programId', code);
  const windowStart = dateValue(input.windowStart, 'windowStart', code, true);
  const windowEnd = dateValue(input.windowEnd, 'windowEnd', code, true);
  if (windowStart >= windowEnd || windowEnd.getTime() - windowStart.getTime() > MAX_WINDOW_MS) {
    invalid('window', 'requires an ordered half-open window of at most 31 days', code);
  }
  return { programId, windowStart, windowEnd };
}

function safeRecord(record, input) {
  exact(record, RECORD_FIELDS, 'record');
  if (safeKey(record.programId, 'programId') !== input.programId) {
    invalid('programId', 'record is outside the requested Program');
  }
  if (!['full_settlement', 'full_refund', 'mutual_split'].includes(record.settlementType)) {
    invalid('settlementType', 'requires a terminal outcome');
  }
  if (!['buyer', 'supplier'].includes(record.beneficiaryRole)) {
    invalid('beneficiaryRole', 'requires buyer or supplier');
  }
  const postedAt = dateValue(record.postedAt, 'postedAt');
  const settlementCreatedAt = dateValue(record.settlementCreatedAt, 'settlementCreatedAt');
  if (postedAt < input.windowStart || postedAt >= input.windowEnd || settlementCreatedAt > postedAt) {
    invalid('recordTime', 'award is outside the window or precedes its Settlement');
  }
  let policyRevokedAt = null;
  if (record.policyRevokedAt !== null) {
    const revoked = dateValue(record.policyRevokedAt, 'policyRevokedAt');
    if (revoked < postedAt || revoked >= input.windowEnd) {
      invalid('policyRevokedAt', 'requires a subsequent revocation before the window end');
    }
    policyRevokedAt = revoked.toISOString();
  }
  amountUnits(record.amountIwc, 'amountIwc');
  amountUnits(record.settlementGrossIwc, 'settlementGrossIwc');
  return {
    awardId: digest(record.awardId, 'awardId'),
    programId: input.programId,
    policyHash: digest(record.policyHash, 'policyHash'),
    policyVersion: safeKey(record.policyVersion, 'policyVersion'),
    settlementId: identifier(record.settlementId, 'settlementId'),
    settlementHash: digest(record.settlementHash, 'settlementHash'),
    settlementType: record.settlementType,
    settlementCreatedAt: settlementCreatedAt.toISOString(),
    beneficiaryRole: record.beneficiaryRole,
    awardSlot: safeKey(record.awardSlot, 'awardSlot'),
    beneficiaryPrincipalId: identifier(record.beneficiaryPrincipalId, 'beneficiaryPrincipalId'),
    counterpartyPrincipalId: identifier(record.counterpartyPrincipalId, 'counterpartyPrincipalId'),
    amountIwc: record.amountIwc,
    settlementGrossIwc: record.settlementGrossIwc,
    ledgerTransactionId: identifier(record.ledgerTransactionId, 'ledgerTransactionId'),
    ledgerTransactionHash: digest(record.ledgerTransactionHash, 'ledgerTransactionHash'),
    receiptHash: digest(record.receiptHash, 'receiptHash'),
    authorizationId: digest(record.authorizationId, 'authorizationId'),
    postedAt: postedAt.toISOString(),
    policyRevokedAt,
  };
}

function addUnique(values, value, field) {
  if (values.has(value)) invalid(field, 'duplicate source identity');
  values.add(value);
}

function validateRecordSet(records) {
  const awardIds = new Set();
  const ledgerIds = new Set();
  const ledgerHashes = new Set();
  const entitlements = new Set();
  const settlements = new Map();
  for (const record of records) {
    addUnique(awardIds, record.awardId, 'awardId');
    addUnique(ledgerIds, record.ledgerTransactionId, 'ledgerTransactionId');
    addUnique(ledgerHashes, record.ledgerTransactionHash, 'ledgerTransactionHash');
    addUnique(entitlements, JSON.stringify([
      record.programId, record.settlementId, record.beneficiaryRole, record.awardSlot,
    ]), 'entitlement');
    const buyerPrincipalId = record.beneficiaryRole === 'buyer'
      ? record.beneficiaryPrincipalId : record.counterpartyPrincipalId;
    const supplierPrincipalId = record.beneficiaryRole === 'supplier'
      ? record.beneficiaryPrincipalId : record.counterpartyPrincipalId;
    const identity = JSON.stringify([
      record.settlementHash, record.settlementGrossIwc, record.settlementType,
      record.settlementCreatedAt, buyerPrincipalId, supplierPrincipalId,
    ]);
    if (settlements.has(record.settlementId) && settlements.get(record.settlementId) !== identity) {
      invalid('settlementId', 'inconsistent immutable Settlement facts');
    }
    settlements.set(record.settlementId, identity);
  }
}

function beneficiaryMetrics(principalId, records) {
  const settlements = new Map();
  const policyHashes = new Set();
  const slots = new Map();
  let totalUnits = 0n;
  for (const record of records) {
    const units = amountUnits(record.amountIwc, 'amountIwc');
    totalUnits += units;
    settlements.set(record.settlementId, record.counterpartyPrincipalId);
    policyHashes.add(record.policyHash);
    const slotKey = JSON.stringify([record.beneficiaryRole, record.awardSlot]);
    if (!slots.has(slotKey)) slots.set(slotKey, {
      beneficiaryRole: record.beneficiaryRole, awardSlot: record.awardSlot,
      count: 0, totalUnits: 0n, settlements: new Set(),
    });
    const slot = slots.get(slotKey);
    slot.count += 1;
    slot.totalUnits += units;
    slot.settlements.add(record.settlementId);
  }
  const counterpartyCounts = new Map();
  let samePrincipalRewardedSettlementCount = 0;
  for (const counterparty of settlements.values()) {
    counterpartyCounts.set(counterparty, (counterpartyCounts.get(counterparty) ?? 0) + 1);
    if (counterparty === principalId) samePrincipalRewardedSettlementCount += 1;
  }
  const topCounterpartySettlementCount = Math.max(0, ...counterpartyCounts.values());
  return {
    principalId,
    verifiedAwardCount: records.length,
    distinctRewardedSettlementCount: settlements.size,
    totalAwardIwc: amountText(totalUnits),
    samePrincipalRewardedSettlementCount,
    independentCounterpartyPrincipalCount: [...counterpartyCounts.keys()].filter((id) => id !== principalId).length,
    topCounterpartySettlementCount,
    topCounterpartySettlementShare: amountText(settlements.size === 0 ? 0n
      : BigInt(topCounterpartySettlementCount) * SCALE / BigInt(settlements.size)),
    policyHashes: [...policyHashes].sort(compare),
    roleSlotBreakdown: [...slots.values()].sort((left, right) =>
      compare(left.beneficiaryRole, right.beneficiaryRole) || compare(left.awardSlot, right.awardSlot)).map((slot) => ({
      beneficiaryRole: slot.beneficiaryRole, awardSlot: slot.awardSlot,
      verifiedAwardCount: slot.count, distinctRewardedSettlementCount: slot.settlements.size,
      totalAwardIwc: amountText(slot.totalUnits),
    })),
  };
}

// Sources must already have passed historical signature, policy, receipt,
// Settlement/M9 and Ledger verification. This pure aggregation never resolves
// live authority, infers missing attribution or classifies farming risk.
export function buildIncentiveObservation(input, sources) {
  const normalized = normalizeIncentiveObservationInput(input);
  exact(sources, ['records', 'unboundPostedCandidateCount'], 'sources');
  if (!Array.isArray(sources.records) || !Number.isSafeInteger(sources.unboundPostedCandidateCount) ||
      sources.unboundPostedCandidateCount < 0) {
    invalid('sources', 'requires records and a non-negative safe integer unbound count');
  }
  if (sources.records.length > MAX_INCENTIVE_OBSERVATION_RECORDS ||
      sources.unboundPostedCandidateCount > MAX_INCENTIVE_OBSERVATION_RECORDS - sources.records.length) {
    invalid('sources', 'exceeds the complete observation limit', 'R8_OBSERVATION_LIMIT_EXCEEDED');
  }
  const records = Array.from(sources.records, (record) => safeRecord(record, normalized)).sort((left, right) =>
    compare(left.postedAt, right.postedAt) || compare(left.awardId, right.awardId));
  validateRecordSet(records);
  const principals = new Map();
  const settlements = new Map();
  let totalUnits = 0n;
  for (const record of records) {
    totalUnits += amountUnits(record.amountIwc, 'amountIwc');
    settlements.set(record.settlementId, amountUnits(record.settlementGrossIwc, 'settlementGrossIwc'));
    if (!principals.has(record.beneficiaryPrincipalId)) principals.set(record.beneficiaryPrincipalId, []);
    principals.get(record.beneficiaryPrincipalId).push(record);
  }
  const protocol = INCENTIVE_OBSERVATION_PROTOCOL;
  const programId = normalized.programId;
  const observationWindow = {
    start: normalized.windowStart.toISOString(), endExclusive: normalized.windowEnd.toISOString(),
  };
  const { unboundPostedCandidateCount } = sources;
  return {
    protocol, programId, observationWindow, records,
    attribution: {
      state: unboundPostedCandidateCount > 0 ? 'partial' : records.length > 0 ? 'verified' : 'empty',
      verifiedAwardCount: records.length, unboundPostedCandidateCount, legacyAttribution: 'unavailable',
    },
    metrics: {
      verifiedAwardCount: records.length, distinctRewardedSettlementCount: settlements.size,
      beneficiaryPrincipalCount: principals.size, totalAwardIwc: amountText(totalUnits),
      totalRewardedSettlementGrossIwc: amountText([...settlements.values()].reduce((sum, amount) => sum + amount, 0n)),
    },
    byBeneficiary: [...principals.keys()].sort(compare).map((id) => beneficiaryMetrics(id, principals.get(id))),
    evidenceFingerprint: sha256Evidence({ protocol, programId, observationWindow, records, unboundPostedCandidateCount }),
    riskAssessment: { state: 'not_evaluated', reason: 'rule_thresholds_not_frozen' },
    automaticPunishmentApplied: false,
    capitalLineageTraced: false,
  };
}
