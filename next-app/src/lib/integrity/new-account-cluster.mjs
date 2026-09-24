import { Prisma } from '@prisma/client';

import {
  INTEGRITY_RULE_CODES,
  IntegritySignalError,
  emitIntegritySignal,
} from './integrity-signal.mjs';

export const NEW_ACCOUNT_CLUSTER_RULE_VERSION =
  'iwantu.integrity-rule.r6/0.1';

export const NEW_ACCOUNT_CLUSTER_POLICY = Object.freeze({
  maxPrincipalCreationSpreadDays: 14,
  maxFirstActivityDelayDays: 14,
  minPairSettlements: 1,
  minTotalSettlements: 6,
});

const DAY_MS = 24 * 60 * 60 * 1000;

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

function count(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACT_INVALID',
      field + ' must be a non-negative integer',
      { field },
    );
  }
  return value;
}

function dateValue(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACT_INVALID',
      field + ' must be a valid date',
      { field },
    );
  }
  return date;
}

function canonicalPrincipals(values) {
  if (!Array.isArray(values) || values.length !== 3) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_INPUT_INVALID',
      'R6 requires exactly three Principals',
    );
  }
  const ids = values.map((id, index) =>
    nonEmpty(id, 'principalIds[' + index + ']'),
  );
  if (new Set(ids).size !== 3) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_INPUT_INVALID',
      'R6 requires three distinct Principals',
    );
  }
  return [...ids].sort();
}

function normalizePolicy(policy = NEW_ACCOUNT_CLUSTER_POLICY) {
  const normalized = {
    maxPrincipalCreationSpreadDays: count(
      policy?.maxPrincipalCreationSpreadDays,
      'maxPrincipalCreationSpreadDays',
    ),
    maxFirstActivityDelayDays: count(
      policy?.maxFirstActivityDelayDays,
      'maxFirstActivityDelayDays',
    ),
    minPairSettlements: count(
      policy?.minPairSettlements,
      'minPairSettlements',
    ),
    minTotalSettlements: count(
      policy?.minTotalSettlements,
      'minTotalSettlements',
    ),
  };
  if (
    normalized.maxPrincipalCreationSpreadDays < 1 ||
    normalized.maxFirstActivityDelayDays < 1 ||
    normalized.minPairSettlements < 1 ||
    normalized.minTotalSettlements < normalized.minPairSettlements * 3
  ) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_POLICY_INVALID',
      'R6 policy thresholds are inconsistent',
    );
  }
  return normalized;
}

function daysBetween(later, earlier) {
  return (later.getTime() - earlier.getTime()) / DAY_MS;
}

export function classifyNewAccountCluster(
  facts,
  policy = NEW_ACCOUNT_CLUSTER_POLICY,
) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACT_INVALID',
      'New-account cluster facts must be an object',
    );
  }

  const principalIds = canonicalPrincipals([
    facts.principalAId,
    facts.principalBId,
    facts.principalCId,
  ]);
  const p = normalizePolicy(policy);

  const created = [
    dateValue(facts.principalACreatedAt, 'principalACreatedAt'),
    dateValue(facts.principalBCreatedAt, 'principalBCreatedAt'),
    dateValue(facts.principalCCreatedAt, 'principalCCreatedAt'),
  ].sort((a, b) => a - b);

  const basisStart = dateValue(facts.basisStart, 'basisStart');
  const basisEnd = dateValue(facts.basisEnd, 'basisEnd');
  if (basisStart > basisEnd) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACT_INVALID',
      'basisStart must not be after basisEnd',
    );
  }

  const pairCounts = [
    count(facts.abSettlementCount, 'abSettlementCount'),
    count(facts.bcSettlementCount, 'bcSettlementCount'),
    count(facts.caSettlementCount, 'caSettlementCount'),
  ];
  const totalSettlementCount = pairCounts.reduce((sum, value) => sum + value, 0);

  const creationSpreadDays = daysBetween(created[2], created[0]);
  const firstActivityDelayDays = daysBetween(basisStart, created[2]);

  if (
    creationSpreadDays > p.maxPrincipalCreationSpreadDays ||
    firstActivityDelayDays < 0 ||
    firstActivityDelayDays > p.maxFirstActivityDelayDays ||
    pairCounts.some((value) => value < p.minPairSettlements) ||
    totalSettlementCount < p.minTotalSettlements
  ) {
    return null;
  }

  return {
    ruleCode: INTEGRITY_RULE_CODES.NEW_ACCOUNT_CLUSTER,
    ruleVersion: NEW_ACCOUNT_CLUSTER_RULE_VERSION,
    scope: 'principal',
    signalClass: 'relationship_graph',
    relationshipType: 'new_account_dense_cluster',
    principalIds,
    creationSpreadDays: Number(creationSpreadDays.toFixed(6)),
    firstActivityDelayDays: Number(firstActivityDelayDays.toFixed(6)),
    pairSettlementCounts: {
      ab: pairCounts[0],
      bc: pairCounts[1],
      ca: pairCounts[2],
    },
    totalSettlementCount,
    policy: p,
  };
}

async function newAccountClusterFacts(
  prisma,
  principalAId,
  principalBId,
  principalCId,
) {
  const rows = await prisma.$queryRaw(Prisma.sql\`
    WITH principal_rows AS (
      SELECT "id", "createdAt"
      FROM "principals"
      WHERE "id" IN (\${principalAId}, \${principalBId}, \${principalCId})
    ),
    pair_evidence AS (
      SELECT
        LEAST("subjectPrincipalId", "counterpartyPrincipalId") AS p1,
        GREATEST("subjectPrincipalId", "counterpartyPrincipalId") AS p2,
        "occurredAt"
      FROM "reputation_evidence"
      WHERE "evidenceClass" = 'transaction'
        AND "subjectRole" = 'supplier'
        AND "subjectPrincipalId" IN (
          \${principalAId}, \${principalBId}, \${principalCId}
        )
        AND "counterpartyPrincipalId" IN (
          \${principalAId}, \${principalBId}, \${principalCId}
        )
        AND "subjectPrincipalId" <> "counterpartyPrincipalId"
    )
    SELECT
      \${principalAId}::text AS "principalAId",
      \${principalBId}::text AS "principalBId",
      \${principalCId}::text AS "principalCId",
      (SELECT "createdAt" FROM principal_rows WHERE "id" = \${principalAId})
        AS "principalACreatedAt",
      (SELECT "createdAt" FROM principal_rows WHERE "id" = \${principalBId})
        AS "principalBCreatedAt",
      (SELECT "createdAt" FROM principal_rows WHERE "id" = \${principalCId})
        AS "principalCCreatedAt",
      count(*) FILTER (
        WHERE p1 = LEAST(\${principalAId}, \${principalBId})
          AND p2 = GREATEST(\${principalAId}, \${principalBId})
      )::integer AS "abSettlementCount",
      count(*) FILTER (
        WHERE p1 = LEAST(\${principalBId}, \${principalCId})
          AND p2 = GREATEST(\${principalBId}, \${principalCId})
      )::integer AS "bcSettlementCount",
      count(*) FILTER (
        WHERE p1 = LEAST(\${principalCId}, \${principalAId})
          AND p2 = GREATEST(\${principalCId}, \${principalAId})
      )::integer AS "caSettlementCount",
      min("occurredAt") AS "basisStart",
      max("occurredAt") AS "basisEnd"
    FROM pair_evidence
  \`);
  return rows[0] ?? null;
}

export async function evaluateNewAccountCluster(
  prisma,
  input,
  options = {},
) {
  const principalAId = nonEmpty(input?.principalAId, 'principalAId');
  const principalBId = nonEmpty(input?.principalBId, 'principalBId');
  const principalCId = nonEmpty(input?.principalCId, 'principalCId');
  canonicalPrincipals([principalAId, principalBId, principalCId]);

  const facts = await newAccountClusterFacts(
    prisma,
    principalAId,
    principalBId,
    principalCId,
  );
  if (!facts) {
    throw new IntegritySignalError(
      'INTEGRITY_RULE_FACTS_UNAVAILABLE',
      'New-account cluster facts could not be derived',
    );
  }

  const classification = classifyNewAccountCluster(facts, options.policy);
  if (!classification) {
    return {
      matched: false,
      ruleCode: INTEGRITY_RULE_CODES.NEW_ACCOUNT_CLUSTER,
      signals: [],
      facts,
    };
  }

  const metrics = {
    creationSpreadDays: classification.creationSpreadDays,
    firstActivityDelayDays: classification.firstActivityDelayDays,
    pairSettlementCounts: classification.pairSettlementCounts,
    totalSettlementCount: classification.totalSettlementCount,
    maximumPrincipalCreationSpreadDays:
      classification.policy.maxPrincipalCreationSpreadDays,
    maximumFirstActivityDelayDays:
      classification.policy.maxFirstActivityDelayDays,
    minimumPairSettlements: classification.policy.minPairSettlements,
    minimumTotalSettlements: classification.policy.minTotalSettlements,
    automaticPunishmentApplied: false,
  };

  const signals = [];
  for (const subjectPrincipalId of classification.principalIds) {
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
          sourceEvidenceClass: 'transaction',
          sourceFactLayer: 'reputation_evidence',
          principalFactLayer: 'principals.createdAt',
          principalIds: classification.principalIds,
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
