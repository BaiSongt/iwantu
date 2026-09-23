import { Prisma } from '@prisma/client';

import {
  INTEGRITY_RULE_CODES,
  IntegritySignalError,
  emitIntegritySignal,
} from './integrity-signal.mjs';

export const RECIPROCAL_FLOW_RULE_VERSION =
  'iwantu.integrity-rule.r4/0.1';

export const RECIPROCAL_FLOW_POLICY = Object.freeze({
  minDirectionalSettlements: 2,
  minTotalSettlements: 6,
  minGrossAmount: '100.00000000',
  maxNetToGrossBps: 1000,
});

const AMOUNT_SCALE = 100000000n;

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_INPUT_INVALID',
      field + ' must be a non-empty string',
      { field },
    );
  }
  return value.trim();
}

function integerCount(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACT_INVALID',
      field + ' must be a non-negative integer',
      { field },
    );
  }
  return value;
}

function amountUnits(value, field) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(text)) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACT_INVALID',
      field + ' must be a non-negative decimal with at most 8 fractional digits',
      { field },
    );
  }
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * AMOUNT_SCALE +
    BigInt(fraction.padEnd(8, '0'));
}

function amountText(units) {
  const whole = units / AMOUNT_SCALE;
  const fraction = String(units % AMOUNT_SCALE).padStart(8, '0');
  return whole + '.' + fraction;
}

function ratioText(numerator, denominator) {
  if (denominator === 0n) return '0.00000000';
  const scaled = (numerator * AMOUNT_SCALE) / denominator;
  return amountText(scaled);
}

function canonicalPair(principalAId, principalBId) {
  const first = nonEmpty(principalAId, 'principalAId');
  const second = nonEmpty(principalBId, 'principalBId');
  if (first === second) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_INPUT_INVALID',
      'R4 requires two distinct Principals',
    );
  }
  return first < second
    ? { principalAId: first, principalBId: second }
    : { principalAId: second, principalBId: first };
}

function normalizePolicy(policy = RECIPROCAL_FLOW_POLICY) {
  const minDirectionalSettlements = integerCount(
    policy?.minDirectionalSettlements,
    'minDirectionalSettlements',
  );
  const minTotalSettlements = integerCount(
    policy?.minTotalSettlements,
    'minTotalSettlements',
  );
  const maxNetToGrossBps = integerCount(
    policy?.maxNetToGrossBps,
    'maxNetToGrossBps',
  );
  const minGrossAmount = amountText(
    amountUnits(policy?.minGrossAmount, 'minGrossAmount'),
  );

  if (minDirectionalSettlements < 1) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_POLICY_INVALID',
      'minDirectionalSettlements must be at least 1',
    );
  }
  if (minTotalSettlements < minDirectionalSettlements * 2) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_POLICY_INVALID',
      'minTotalSettlements must cover both directions',
    );
  }
  if (maxNetToGrossBps < 0 || maxNetToGrossBps > 10000) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_POLICY_INVALID',
      'maxNetToGrossBps must be between 0 and 10000',
    );
  }

  return {
    minDirectionalSettlements,
    minTotalSettlements,
    minGrossAmount,
    maxNetToGrossBps,
  };
}

export function classifyReciprocalFlow(
  facts,
  policy = RECIPROCAL_FLOW_POLICY,
) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACT_INVALID',
      'Reciprocal-flow facts must be an object',
    );
  }

  const pair = canonicalPair(
    facts.principalAId,
    facts.principalBId,
  );
  const normalizedPolicy = normalizePolicy(policy);
  const aToBSettlementCount = integerCount(
    facts.aToBSettlementCount,
    'aToBSettlementCount',
  );
  const bToASettlementCount = integerCount(
    facts.bToASettlementCount,
    'bToASettlementCount',
  );
  const aToBUnits = amountUnits(facts.aToBAmount, 'aToBAmount');
  const bToAUnits = amountUnits(facts.bToAAmount, 'bToAAmount');
  const totalSettlementCount =
    aToBSettlementCount + bToASettlementCount;
  const grossUnits = aToBUnits + bToAUnits;
  const netUnits =
    aToBUnits >= bToAUnits
      ? aToBUnits - bToAUnits
      : bToAUnits - aToBUnits;
  const minGrossUnits = amountUnits(
    normalizedPolicy.minGrossAmount,
    'minGrossAmount',
  );

  if (
    aToBSettlementCount < normalizedPolicy.minDirectionalSettlements ||
    bToASettlementCount < normalizedPolicy.minDirectionalSettlements ||
    totalSettlementCount < normalizedPolicy.minTotalSettlements ||
    grossUnits < minGrossUnits ||
    grossUnits === 0n
  ) {
    return null;
  }

  if (
    netUnits * 10000n >
    grossUnits * BigInt(normalizedPolicy.maxNetToGrossBps)
  ) {
    return null;
  }

  return {
    ruleCode: INTEGRITY_RULE_CODES.HIGH_RECIPROCAL_FLOW,
    ruleVersion: RECIPROCAL_FLOW_RULE_VERSION,
    scope: 'principal',
    signalClass: 'economic_flow',
    relationshipType: 'high_reciprocal_credit_flow',
    ...pair,
    aToBSettlementCount,
    bToASettlementCount,
    totalSettlementCount,
    aToBAmount: amountText(aToBUnits),
    bToAAmount: amountText(bToAUnits),
    grossAmount: amountText(grossUnits),
    netAmount: amountText(netUnits),
    netToGrossRatio: ratioText(netUnits, grossUnits),
    policy: normalizedPolicy,
  };
}

async function reciprocalFlowFacts(
  prisma,
  principalAId,
  principalBId,
) {
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT
      ${principalAId}::text AS "principalAId",
      ${principalBId}::text AS "principalBId",
      count(*) FILTER (
        WHERE "subjectPrincipalId" = ${principalBId}
          AND "counterpartyPrincipalId" = ${principalAId}
      )::integer AS "aToBSettlementCount",
      count(*) FILTER (
        WHERE "subjectPrincipalId" = ${principalAId}
          AND "counterpartyPrincipalId" = ${principalBId}
      )::integer AS "bToASettlementCount",
      COALESCE(sum(
        CASE
          WHEN "subjectPrincipalId" = ${principalBId}
            AND "counterpartyPrincipalId" = ${principalAId}
          THEN NULLIF("evidence" ->> 'subjectReceivedAmount', '')::numeric
          ELSE 0
        END
      ), 0)::text AS "aToBAmount",
      COALESCE(sum(
        CASE
          WHEN "subjectPrincipalId" = ${principalAId}
            AND "counterpartyPrincipalId" = ${principalBId}
          THEN NULLIF("evidence" ->> 'subjectReceivedAmount', '')::numeric
          ELSE 0
        END
      ), 0)::text AS "bToAAmount",
      min("occurredAt") AS "basisStart",
      max("occurredAt") AS "basisEnd"
    FROM "reputation_evidence"
    WHERE "evidenceClass" = 'economic'
      AND "subjectRole" = 'supplier'
      AND (
        (
          "subjectPrincipalId" = ${principalAId}
          AND "counterpartyPrincipalId" = ${principalBId}
        )
        OR
        (
          "subjectPrincipalId" = ${principalBId}
          AND "counterpartyPrincipalId" = ${principalAId}
        )
      )
  `);

  return rows[0] ?? null;
}

export async function evaluateReciprocalFlow(
  prisma,
  input,
  options = {},
) {
  const pair = canonicalPair(
    input?.principalAId,
    input?.principalBId,
  );
  const facts = await reciprocalFlowFacts(
    prisma,
    pair.principalAId,
    pair.principalBId,
  );

  if (!facts) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACTS_UNAVAILABLE',
      'Reciprocal-flow facts could not be derived',
    );
  }

  const classification = classifyReciprocalFlow(
    facts,
    options.policy,
  );

  if (!classification) {
    return {
      matched: false,
      ruleCode: INTEGRITY_RULE_CODES.HIGH_RECIPROCAL_FLOW,
      signals: [],
      facts,
    };
  }

  if (!(facts.basisStart instanceof Date) || !(facts.basisEnd instanceof Date)) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACT_INVALID',
      'Matched reciprocal flow requires a valid evidence time window',
    );
  }

  const metrics = {
    aToBSettlementCount: classification.aToBSettlementCount,
    bToASettlementCount: classification.bToASettlementCount,
    totalSettlementCount: classification.totalSettlementCount,
    aToBAmount: classification.aToBAmount,
    bToAAmount: classification.bToAAmount,
    grossAmount: classification.grossAmount,
    netAmount: classification.netAmount,
    netToGrossRatio: classification.netToGrossRatio,
    minimumDirectionalSettlements:
      classification.policy.minDirectionalSettlements,
    minimumTotalSettlements:
      classification.policy.minTotalSettlements,
    minimumGrossAmount:
      classification.policy.minGrossAmount,
    maximumNetToGrossBps:
      classification.policy.maxNetToGrossBps,
    automaticPunishmentApplied: false,
  };

  const signals = [];
  for (const [subjectPrincipalId, counterpartyPrincipalId] of [
    [classification.principalAId, classification.principalBId],
    [classification.principalBId, classification.principalAId],
  ]) {
    signals.push(
      await emitIntegritySignal(prisma, {
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
          principalAId: classification.principalAId,
          principalBId: classification.principalBId,
          counterpartyPrincipalId,
        },
        metrics,
        basisStart: facts.basisStart,
        basisEnd: facts.basisEnd,
        observedAt: facts.basisEnd,
      }),
    );
  }

  return {
    matched: true,
    ruleCode: classification.ruleCode,
    signals,
    facts,
  };
}

export async function scanReciprocalFlowSignals(
  prisma,
  { limit = 100, policy } = {},
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_INPUT_INVALID',
      'limit must be an integer from 1 to 1000',
      { field: 'limit' },
    );
  }

  const pairs = await prisma.$queryRaw(Prisma.sql`
    SELECT DISTINCT
      LEAST("subjectPrincipalId", "counterpartyPrincipalId")
        AS "principalAId",
      GREATEST("subjectPrincipalId", "counterpartyPrincipalId")
        AS "principalBId"
    FROM "reputation_evidence"
    WHERE "evidenceClass" = 'economic'
      AND "subjectRole" = 'supplier'
      AND "subjectPrincipalId" <> "counterpartyPrincipalId"
    ORDER BY "principalAId", "principalBId"
    LIMIT ${limit}
  `);

  const results = [];
  for (const pair of pairs) {
    results.push(
      await evaluateReciprocalFlow(
        prisma,
        pair,
        { policy },
      ),
    );
  }
  return results;
}
