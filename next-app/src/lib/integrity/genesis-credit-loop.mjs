import { Prisma } from '@prisma/client';

import {
  INTEGRITY_RULE_CODES,
  IntegritySignalError,
  emitIntegritySignal,
} from './integrity-signal.mjs';

export const GENESIS_CREDIT_LOOP_RULE_VERSION = 'iwantu.integrity-rule.r7/0.1';

export const GENESIS_CREDIT_LOOP_POLICY = Object.freeze({
  minEdgeSettlements: 1,
  minTotalSettlements: 3,
  minGrossAmount: '100.00000000',
  minGenesisOriginRatioBps: 5000,
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

function canonicalPrincipals(values) {
  if (!Array.isArray(values) || values.length !== 3) {
    throw new IntegritySignalError('INTEGRITY_RULE_INPUT_INVALID', 'R7 requires exactly three Principals');
  }
  const ids = values.map((id, index) => nonEmpty(id, 'principalIds[' + index + ']'));
  if (new Set(ids).size !== 3) {
    throw new IntegritySignalError('INTEGRITY_RULE_INPUT_INVALID', 'R7 requires three distinct Principals');
  }
  return [...ids].sort();
}

function normalizePolicy(policy = GENESIS_CREDIT_LOOP_POLICY) {
  const normalized = {
    minEdgeSettlements: count(policy?.minEdgeSettlements, 'minEdgeSettlements'),
    minTotalSettlements: count(policy?.minTotalSettlements, 'minTotalSettlements'),
    minGrossAmount: amountText(units(policy?.minGrossAmount, 'minGrossAmount')),
    minGenesisOriginRatioBps: count(policy?.minGenesisOriginRatioBps, 'minGenesisOriginRatioBps'),
  };
  if (
    normalized.minEdgeSettlements < 1 ||
    normalized.minTotalSettlements < normalized.minEdgeSettlements * 3 ||
    normalized.minGenesisOriginRatioBps < 1 ||
    normalized.minGenesisOriginRatioBps > 10000
  ) {
    throw new IntegritySignalError('INTEGRITY_RULE_POLICY_INVALID', 'R7 policy thresholds are inconsistent');
  }
  return normalized;
}

export function classifyGenesisCreditLoop(facts, policy = GENESIS_CREDIT_LOOP_POLICY) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', 'Genesis-credit loop facts must be an object');
  }
  const principalIds = canonicalPrincipals([facts.principalAId, facts.principalBId, facts.principalCId]);
  const p = normalizePolicy(policy);
  const edges = [
    { settlementCount: count(facts.aToBSettlementCount, 'aToBSettlementCount'), amount: units(facts.aToBAmount, 'aToBAmount'), genesisAmount: units(facts.aToBGenesisAmount, 'aToBGenesisAmount') },
    { settlementCount: count(facts.bToCSettlementCount, 'bToCSettlementCount'), amount: units(facts.bToCAmount, 'bToCAmount'), genesisAmount: units(facts.bToCGenesisAmount, 'bToCGenesisAmount') },
    { settlementCount: count(facts.cToASettlementCount, 'cToASettlementCount'), amount: units(facts.cToAAmount, 'cToAAmount'), genesisAmount: units(facts.cToAGenesisAmount, 'cToAGenesisAmount') },
  ];
  const totalSettlementCount = edges.reduce((sum, edge) => sum + edge.settlementCount, 0);
  const gross = edges.reduce((sum, edge) => sum + edge.amount, 0n);
  const genesis = edges.reduce((sum, edge) => sum + edge.genesisAmount, 0n);
  const minGross = units(p.minGrossAmount, 'minGrossAmount');
  if (
    edges.some((edge) => edge.settlementCount < p.minEdgeSettlements) ||
    totalSettlementCount < p.minTotalSettlements ||
    gross < minGross ||
    gross === 0n ||
    genesis * 10000n < gross * BigInt(p.minGenesisOriginRatioBps)
  ) return null;

  return {
    ruleCode: INTEGRITY_RULE_CODES.GENESIS_CREDIT_LOOP,
    ruleVersion: GENESIS_CREDIT_LOOP_RULE_VERSION,
    scope: 'principal',
    signalClass: 'economic_flow',
    relationshipType: 'genesis_credit_loop',
    principalIds,
    totalSettlementCount,
    grossAmount: amountText(gross),
    genesisAmount: amountText(genesis),
    genesisOriginRatioBps: Number((genesis * 10000n) / gross),
    policy: p,
  };
}

async function genesisCreditLoopFacts(prisma, principalAId, principalBId, principalCId) {
  const rows = await prisma.$queryRaw(Prisma.sql`
    WITH economic_flow AS (
      SELECT
        "counterpartyPrincipalId" AS "fromPrincipalId",
        "subjectPrincipalId" AS "toPrincipalId",
        "occurredAt",
        NULLIF("evidence" ->> 'subjectReceivedAmount', '')::numeric AS amount,
        COALESCE(NULLIF("evidence" ->> 'genesisOriginAmount', '')::numeric, 0) AS "genesisAmount"
      FROM "reputation_evidence"
      WHERE "evidenceClass" = 'economic'
        AND "subjectRole" = 'supplier'
        AND "subjectPrincipalId" IN (${principalAId}, ${principalBId}, ${principalCId})
        AND "counterpartyPrincipalId" IN (${principalAId}, ${principalBId}, ${principalCId})
    )
    SELECT
      ${principalAId}::text AS "principalAId",
      ${principalBId}::text AS "principalBId",
      ${principalCId}::text AS "principalCId",
      count(*) FILTER (WHERE "fromPrincipalId" = ${principalAId} AND "toPrincipalId" = ${principalBId})::integer AS "aToBSettlementCount",
      count(*) FILTER (WHERE "fromPrincipalId" = ${principalBId} AND "toPrincipalId" = ${principalCId})::integer AS "bToCSettlementCount",
      count(*) FILTER (WHERE "fromPrincipalId" = ${principalCId} AND "toPrincipalId" = ${principalAId})::integer AS "cToASettlementCount",
      COALESCE(sum(amount) FILTER (WHERE "fromPrincipalId" = ${principalAId} AND "toPrincipalId" = ${principalBId}), 0)::text AS "aToBAmount",
      COALESCE(sum(amount) FILTER (WHERE "fromPrincipalId" = ${principalBId} AND "toPrincipalId" = ${principalCId}), 0)::text AS "bToCAmount",
      COALESCE(sum(amount) FILTER (WHERE "fromPrincipalId" = ${principalCId} AND "toPrincipalId" = ${principalAId}), 0)::text AS "cToAAmount",
      COALESCE(sum("genesisAmount") FILTER (WHERE "fromPrincipalId" = ${principalAId} AND "toPrincipalId" = ${principalBId}), 0)::text AS "aToBGenesisAmount",
      COALESCE(sum("genesisAmount") FILTER (WHERE "fromPrincipalId" = ${principalBId} AND "toPrincipalId" = ${principalCId}), 0)::text AS "bToCGenesisAmount",
      COALESCE(sum("genesisAmount") FILTER (WHERE "fromPrincipalId" = ${principalCId} AND "toPrincipalId" = ${principalAId}), 0)::text AS "cToAGenesisAmount",
      min("occurredAt") AS "basisStart",
      max("occurredAt") AS "basisEnd"
    FROM economic_flow
  `);
  return rows[0] ?? null;
}

export async function evaluateGenesisCreditLoop(prisma, input, options = {}) {
  const principalAId = nonEmpty(input?.principalAId, 'principalAId');
  const principalBId = nonEmpty(input?.principalBId, 'principalBId');
  const principalCId = nonEmpty(input?.principalCId, 'principalCId');
  canonicalPrincipals([principalAId, principalBId, principalCId]);

  const facts = await genesisCreditLoopFacts(prisma, principalAId, principalBId, principalCId);
  if (!facts) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACTS_UNAVAILABLE', 'Genesis-credit loop facts could not be derived');
  }
  const classification = classifyGenesisCreditLoop(facts, options.policy);
  if (!classification) return { matched: false, ruleCode: INTEGRITY_RULE_CODES.GENESIS_CREDIT_LOOP, signals: [], facts };
  if (!(facts.basisStart instanceof Date) || !(facts.basisEnd instanceof Date)) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', 'Matched genesis-credit loop requires a valid evidence time window');
  }

  const metrics = {
    totalSettlementCount: classification.totalSettlementCount,
    grossAmount: classification.grossAmount,
    genesisAmount: classification.genesisAmount,
    genesisOriginRatioBps: classification.genesisOriginRatioBps,
    minimumEdgeSettlements: classification.policy.minEdgeSettlements,
    minimumTotalSettlements: classification.policy.minTotalSettlements,
    minimumGrossAmount: classification.policy.minGrossAmount,
    minimumGenesisOriginRatioBps: classification.policy.minGenesisOriginRatioBps,
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
      evidence: {
        relationshipType: classification.relationshipType,
        sourceEvidenceClass: 'economic',
        sourceFactLayer: 'reputation_evidence',
        capitalProvenanceField: 'genesisOriginAmount',
        principalIds: classification.principalIds,
      },
      metrics,
      basisStart: facts.basisStart,
      basisEnd: facts.basisEnd,
      observedAt: facts.basisEnd,
    }));
  }
  return { matched: true, ruleCode: classification.ruleCode, signals, facts };
}
