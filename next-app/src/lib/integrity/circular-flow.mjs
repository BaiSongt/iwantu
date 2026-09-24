import { Prisma } from '@prisma/client';

import {
  INTEGRITY_RULE_CODES,
  IntegritySignalError,
  emitIntegritySignal,
} from './integrity-signal.mjs';

export const CIRCULAR_FLOW_RULE_VERSION = 'iwantu.integrity-rule.r5/0.1';
export const CIRCULAR_FLOW_POLICY = Object.freeze({
  minEdgeSettlements: 1,
  minTotalSettlements: 3,
  minGrossAmount: '100.00000000',
  minEdgeShareBps: 2000,
});

const SCALE = 100000000n;

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IntegritySignalError('INTEGRITY_RULE_INPUT_INVALID', field + ' must be a non-empty string', { field });
  }
  return value.trim();
}

function count(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', field + ' must be a non-negative integer', { field });
  }
  return value;
}

function units(value, field) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(text)) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', field + ' must be a non-negative decimal with at most 8 fractional digits', { field });
  }
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
}

function amountText(value) {
  return `${value / SCALE}.${String(value % SCALE).padStart(8, '0')}`;
}

function canonicalCycle(principalIds) {
  if (!Array.isArray(principalIds) || principalIds.length !== 3) {
    throw new IntegritySignalError('INTEGRITY_RULE_INPUT_INVALID', 'R5 requires exactly three Principals');
  }
  const ids = principalIds.map((id, index) => nonEmpty(id, `principalIds[${index}]`));
  if (new Set(ids).size !== 3) {
    throw new IntegritySignalError('INTEGRITY_RULE_INPUT_INVALID', 'R5 requires three distinct Principals');
  }
  return [...ids].sort();
}

function normalizePolicy(policy = CIRCULAR_FLOW_POLICY) {
  const normalized = {
    minEdgeSettlements: count(policy?.minEdgeSettlements, 'minEdgeSettlements'),
    minTotalSettlements: count(policy?.minTotalSettlements, 'minTotalSettlements'),
    minGrossAmount: amountText(units(policy?.minGrossAmount, 'minGrossAmount')),
    minEdgeShareBps: count(policy?.minEdgeShareBps, 'minEdgeShareBps'),
  };
  if (normalized.minEdgeSettlements < 1 || normalized.minTotalSettlements < normalized.minEdgeSettlements * 3 || normalized.minEdgeShareBps < 1 || normalized.minEdgeShareBps > 3333) {
    throw new IntegritySignalError('INTEGRITY_RULE_POLICY_INVALID', 'R5 policy thresholds are inconsistent');
  }
  return normalized;
}

export function classifyCircularFlow(facts, policy = CIRCULAR_FLOW_POLICY) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', 'Circular-flow facts must be an object');
  }
  const principals = canonicalCycle([facts.principalAId, facts.principalBId, facts.principalCId]);
  const p = normalizePolicy(policy);
  const edges = [
    { from: facts.principalAId, to: facts.principalBId, settlementCount: count(facts.aToBSettlementCount, 'aToBSettlementCount'), amount: units(facts.aToBAmount, 'aToBAmount') },
    { from: facts.principalBId, to: facts.principalCId, settlementCount: count(facts.bToCSettlementCount, 'bToCSettlementCount'), amount: units(facts.bToCAmount, 'bToCAmount') },
    { from: facts.principalCId, to: facts.principalAId, settlementCount: count(facts.cToASettlementCount, 'cToASettlementCount'), amount: units(facts.cToAAmount, 'cToAAmount') },
  ];
  const totalSettlementCount = edges.reduce((sum, edge) => sum + edge.settlementCount, 0);
  const gross = edges.reduce((sum, edge) => sum + edge.amount, 0n);
  const minGross = units(p.minGrossAmount, 'minGrossAmount');
  if (edges.some((edge) => edge.settlementCount < p.minEdgeSettlements) || totalSettlementCount < p.minTotalSettlements || gross < minGross || gross === 0n) return null;
  if (edges.some((edge) => edge.amount * 10000n < gross * BigInt(p.minEdgeShareBps))) return null;
  return {
    ruleCode: INTEGRITY_RULE_CODES.CIRCULAR_FLOW,
    ruleVersion: CIRCULAR_FLOW_RULE_VERSION,
    scope: 'principal',
    signalClass: 'economic_flow',
    relationshipType: 'circular_credit_flow',
    principalIds: principals,
    edges: edges.map((edge) => ({ ...edge, amount: amountText(edge.amount) })),
    totalSettlementCount,
    grossAmount: amountText(gross),
    policy: p,
  };
}

async function circularFlowFacts(prisma, principalAId, principalBId, principalCId) {
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT
      ${principalAId}::text AS "principalAId", ${principalBId}::text AS "principalBId", ${principalCId}::text AS "principalCId",
      count(*) FILTER (WHERE "counterpartyPrincipalId" = ${principalAId} AND "subjectPrincipalId" = ${principalBId})::integer AS "aToBSettlementCount",
      count(*) FILTER (WHERE "counterpartyPrincipalId" = ${principalBId} AND "subjectPrincipalId" = ${principalCId})::integer AS "bToCSettlementCount",
      count(*) FILTER (WHERE "counterpartyPrincipalId" = ${principalCId} AND "subjectPrincipalId" = ${principalAId})::integer AS "cToASettlementCount",
      COALESCE(sum(CASE WHEN "counterpartyPrincipalId" = ${principalAId} AND "subjectPrincipalId" = ${principalBId} THEN NULLIF("evidence" ->> 'subjectReceivedAmount', '')::numeric ELSE 0 END), 0)::text AS "aToBAmount",
      COALESCE(sum(CASE WHEN "counterpartyPrincipalId" = ${principalBId} AND "subjectPrincipalId" = ${principalCId} THEN NULLIF("evidence" ->> 'subjectReceivedAmount', '')::numeric ELSE 0 END), 0)::text AS "bToCAmount",
      COALESCE(sum(CASE WHEN "counterpartyPrincipalId" = ${principalCId} AND "subjectPrincipalId" = ${principalAId} THEN NULLIF("evidence" ->> 'subjectReceivedAmount', '')::numeric ELSE 0 END), 0)::text AS "cToAAmount",
      min("occurredAt") AS "basisStart", max("occurredAt") AS "basisEnd"
    FROM "reputation_evidence"
    WHERE "evidenceClass" = 'economic' AND "subjectRole" = 'supplier'
      AND (("counterpartyPrincipalId" = ${principalAId} AND "subjectPrincipalId" = ${principalBId})
        OR ("counterpartyPrincipalId" = ${principalBId} AND "subjectPrincipalId" = ${principalCId})
        OR ("counterpartyPrincipalId" = ${principalCId} AND "subjectPrincipalId" = ${principalAId}))
  `);
  return rows[0] ?? null;
}

export async function evaluateCircularFlow(prisma, input, options = {}) {
  const principalAId = nonEmpty(input?.principalAId, 'principalAId');
  const principalBId = nonEmpty(input?.principalBId, 'principalBId');
  const principalCId = nonEmpty(input?.principalCId, 'principalCId');
  canonicalCycle([principalAId, principalBId, principalCId]);
  const facts = await circularFlowFacts(prisma, principalAId, principalBId, principalCId);
  if (!facts) throw new IntegritySignalError('INTEGRITY_RULE_FACTS_UNAVAILABLE', 'Circular-flow facts could not be derived');
  const classification = classifyCircularFlow(facts, options.policy);
  if (!classification) return { matched: false, ruleCode: INTEGRITY_RULE_CODES.CIRCULAR_FLOW, signals: [], facts };
  if (!(facts.basisStart instanceof Date) || !(facts.basisEnd instanceof Date)) throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', 'Matched circular flow requires a valid evidence time window');
  const metrics = {
    totalSettlementCount: classification.totalSettlementCount,
    grossAmount: classification.grossAmount,
    edges: classification.edges,
    minimumEdgeSettlements: classification.policy.minEdgeSettlements,
    minimumTotalSettlements: classification.policy.minTotalSettlements,
    minimumGrossAmount: classification.policy.minGrossAmount,
    minimumEdgeShareBps: classification.policy.minEdgeShareBps,
    automaticPunishmentApplied: false,
  };
  const signals = [];
  for (const subjectPrincipalId of classification.principalIds) {
    signals.push(await emitIntegritySignal(prisma, {
      subjectPrincipalId,
      subjectAgentIdentityId: null,
      scope: classification.scope,
      ruleCode: classification.ruleCode,
      ruleVersion: classification.ruleVersion,
      signalClass: classification.signalClass,
      evidence: { relationshipType: classification.relationshipType, sourceEvidenceClass: 'economic', sourceFactLayer: 'reputation_evidence', principalIds: classification.principalIds },
      metrics,
      basisStart: facts.basisStart,
      basisEnd: facts.basisEnd,
      observedAt: facts.basisEnd,
    }));
  }
  return { matched: true, ruleCode: classification.ruleCode, signals, facts };
}
