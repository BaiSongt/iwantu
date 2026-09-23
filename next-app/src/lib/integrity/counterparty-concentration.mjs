import { Prisma } from '@prisma/client';

import {
  INTEGRITY_RULE_CODES,
  IntegritySignalError,
  emitIntegritySignal,
} from './integrity-signal.mjs';

export const COUNTERPARTY_CONCENTRATION_RULE_VERSION =
  'iwantu.integrity-rule.r3/0.1';

export const COUNTERPARTY_CONCENTRATION_POLICY = Object.freeze({
  minIndependentSettlements: 5,
  topCounterpartyShareBps: 8000,
});

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

function normalizePolicy(policy = COUNTERPARTY_CONCENTRATION_POLICY) {
  const minIndependentSettlements = integerCount(
    policy?.minIndependentSettlements,
    'minIndependentSettlements',
  );
  const topCounterpartyShareBps = integerCount(
    policy?.topCounterpartyShareBps,
    'topCounterpartyShareBps',
  );

  if (minIndependentSettlements < 1) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_POLICY_INVALID',
      'minIndependentSettlements must be at least 1',
    );
  }
  if (topCounterpartyShareBps < 1 || topCounterpartyShareBps > 10000) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_POLICY_INVALID',
      'topCounterpartyShareBps must be between 1 and 10000',
    );
  }

  return { minIndependentSettlements, topCounterpartyShareBps };
}

function ratioText(numerator, denominator) {
  if (denominator === 0) return '0.00000000';
  const scale = 100000000n;
  const scaled =
    (BigInt(numerator) * scale) / BigInt(denominator);
  const whole = scaled / scale;
  const fraction = String(scaled % scale).padStart(8, '0');
  return whole + '.' + fraction;
}

export function classifyCounterpartyConcentration(
  facts,
  policy = COUNTERPARTY_CONCENTRATION_POLICY,
) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACT_INVALID',
      'Counterparty concentration facts must be an object',
    );
  }

  const normalizedPolicy = normalizePolicy(policy);
  const independentSettlementCount = integerCount(
    facts.independentSettlementCount,
    'independentSettlementCount',
  );
  const independentCounterpartyPrincipalCount = integerCount(
    facts.independentCounterpartyPrincipalCount,
    'independentCounterpartyPrincipalCount',
  );
  const topCounterpartySettlementCount = integerCount(
    facts.topCounterpartySettlementCount,
    'topCounterpartySettlementCount',
  );

  if (topCounterpartySettlementCount > independentSettlementCount) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACT_INVALID',
      'topCounterpartySettlementCount cannot exceed independentSettlementCount',
    );
  }

  if (
    independentSettlementCount < normalizedPolicy.minIndependentSettlements ||
    topCounterpartySettlementCount === 0
  ) {
    return null;
  }

  const thresholdMet =
    topCounterpartySettlementCount * 10000 >=
    independentSettlementCount * normalizedPolicy.topCounterpartyShareBps;

  if (!thresholdMet) return null;

  const topCounterpartyPrincipalId = nonEmpty(
    facts.topCounterpartyPrincipalId,
    'topCounterpartyPrincipalId',
  );

  return {
    ruleCode: INTEGRITY_RULE_CODES.HIGH_COUNTERPARTY_CONCENTRATION,
    ruleVersion: COUNTERPARTY_CONCENTRATION_RULE_VERSION,
    scope: 'agent',
    signalClass: 'market_concentration',
    relationshipType: 'independent_counterparty_concentration',
    topCounterpartyPrincipalId,
    independentSettlementCount,
    independentCounterpartyPrincipalCount,
    topCounterpartySettlementCount,
    topCounterpartySettlementShare: ratioText(
      topCounterpartySettlementCount,
      independentSettlementCount,
    ),
    policy: normalizedPolicy,
  };
}

async function concentrationFacts(
  prisma,
  subjectPrincipalId,
  subjectAgentIdentityId,
) {
  const rows = await prisma.$queryRaw(Prisma.sql`
    WITH independent_transactions AS (
      SELECT
        "counterpartyPrincipalId",
        "occurredAt"
      FROM "reputation_evidence"
      WHERE "subjectPrincipalId" = ${subjectPrincipalId}
        AND "subjectAgentIdentityId" = ${subjectAgentIdentityId}
        AND "evidenceClass" = 'transaction'
        AND "counterpartyPrincipalId" <> ${subjectPrincipalId}
    ),
    counterparty_counts AS (
      SELECT
        "counterpartyPrincipalId",
        count(*)::integer AS settlement_count
      FROM independent_transactions
      GROUP BY "counterpartyPrincipalId"
    ),
    aggregate_stats AS (
      SELECT
        count(*)::integer AS "independentSettlementCount",
        count(DISTINCT "counterpartyPrincipalId")::integer
          AS "independentCounterpartyPrincipalCount",
        min("occurredAt") AS "basisStart",
        max("occurredAt") AS "basisEnd"
      FROM independent_transactions
    ),
    top_counterparty AS (
      SELECT
        "counterpartyPrincipalId" AS "topCounterpartyPrincipalId",
        settlement_count AS "topCounterpartySettlementCount"
      FROM counterparty_counts
      ORDER BY settlement_count DESC, "counterpartyPrincipalId" ASC
      LIMIT 1
    )
    SELECT
      aggregate_stats.*,
      top_counterparty."topCounterpartyPrincipalId",
      COALESCE(
        top_counterparty."topCounterpartySettlementCount",
        0
      )::integer AS "topCounterpartySettlementCount"
    FROM aggregate_stats
    LEFT JOIN top_counterparty ON TRUE
  `);

  return rows[0] ?? null;
}

export async function evaluateCounterpartyConcentration(
  prisma,
  input,
  options = {},
) {
  const subjectPrincipalId = nonEmpty(
    input?.subjectPrincipalId,
    'subjectPrincipalId',
  );
  const subjectAgentIdentityId = nonEmpty(
    input?.subjectAgentIdentityId,
    'subjectAgentIdentityId',
  );

  const facts = await concentrationFacts(
    prisma,
    subjectPrincipalId,
    subjectAgentIdentityId,
  );

  if (!facts) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACTS_UNAVAILABLE',
      'Counterparty concentration facts could not be derived',
    );
  }

  const classification = classifyCounterpartyConcentration(
    facts,
    options.policy,
  );

  if (!classification) {
    return {
      matched: false,
      ruleCode: INTEGRITY_RULE_CODES.HIGH_COUNTERPARTY_CONCENTRATION,
      signal: null,
      facts,
    };
  }

  if (!(facts.basisStart instanceof Date) || !(facts.basisEnd instanceof Date)) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACT_INVALID',
      'Matched concentration requires a valid evidence time window',
    );
  }

  const signal = await emitIntegritySignal(prisma, {
    subjectPrincipalId,
    subjectAgentIdentityId,
    scope: classification.scope,
    ruleCode: classification.ruleCode,
    ruleVersion: classification.ruleVersion,
    signalClass: classification.signalClass,
    evidence: {
      relationshipType: classification.relationshipType,
      sourceEvidenceClass: 'transaction',
      sourceFactLayer: 'reputation_evidence',
      topCounterpartyPrincipalId:
        classification.topCounterpartyPrincipalId,
    },
    metrics: {
      independentSettlementCount:
        classification.independentSettlementCount,
      independentCounterpartyPrincipalCount:
        classification.independentCounterpartyPrincipalCount,
      topCounterpartySettlementCount:
        classification.topCounterpartySettlementCount,
      topCounterpartySettlementShare:
        classification.topCounterpartySettlementShare,
      thresholdShareBps:
        classification.policy.topCounterpartyShareBps,
      minimumIndependentSettlements:
        classification.policy.minIndependentSettlements,
      automaticPunishmentApplied: false,
    },
    basisStart: facts.basisStart,
    basisEnd: facts.basisEnd,
    observedAt: facts.basisEnd,
  });

  return {
    matched: true,
    ruleCode: classification.ruleCode,
    signal,
    facts,
  };
}

export async function scanCounterpartyConcentrationSignals(
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

  const subjects = await prisma.$queryRaw(Prisma.sql`
    SELECT DISTINCT
      "subjectPrincipalId",
      "subjectAgentIdentityId"
    FROM "reputation_evidence"
    WHERE "evidenceClass" = 'transaction'
      AND "counterpartyPrincipalId" <> "subjectPrincipalId"
    ORDER BY "subjectPrincipalId", "subjectAgentIdentityId"
    LIMIT ${limit}
  `);

  const results = [];
  for (const subject of subjects) {
    results.push(
      await evaluateCounterpartyConcentration(
        prisma,
        subject,
        { policy },
      ),
    );
  }
  return results;
}
