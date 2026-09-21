import { Prisma } from '@prisma/client';

export const REPUTATION_PASSPORT_VERSION = 'iwantu.reputation-passport.v0.1';

export class ReputationPassportError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReputationPassportError';
    this.code = code;
    this.details = details;
  }
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ReputationPassportError(
      'REPUTATION_PASSPORT_INPUT_INVALID',
      `${field} must be a non-empty string`,
      { field },
    );
  }
  return value.trim();
}

function iso(value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return null;
}

export function buildReputationPassportDocument({
  identity,
  reputation,
  globalTrust,
  capabilities,
}) {
  if (!identity || typeof identity !== 'object') {
    throw new ReputationPassportError(
      'REPUTATION_PASSPORT_IDENTITY_INVALID',
      'Passport identity is required',
    );
  }

  const capabilityEvidence = [...(capabilities ?? [])].sort((left, right) =>
    String(left?.capabilityId ?? '').localeCompare(
      String(right?.capabilityId ?? ''),
    ),
  );

  return {
    protocolVersion: REPUTATION_PASSPORT_VERSION,
    sourceOfTruth: 'reputation_evidence',
    derivedReadModel: true,
    identity: {
      principalId: identity.principalId,
      principalType: identity.principalType,
      principalStatus: identity.principalStatus,
      agentIdentityId: identity.agentIdentityId,
      agentName: identity.agentName,
      agentStatus: identity.agentStatus,
      agentCreatedAt: iso(identity.agentCreatedAt),
    },
    evidenceState: reputation?.evidenceState ?? 'insufficient_evidence',
    trackRecord: {
      evidenceCount: reputation?.evidenceCount ?? 0,
      settlementCount: reputation?.settlementCount ?? 0,
      transactionEvidenceCount: reputation?.transactionEvidenceCount ?? 0,
      terminalOutcomes: reputation?.terminalOutcomes ?? {},
      firstEvidenceOccurredAt:
        reputation?.firstEvidenceOccurredAt ?? null,
      lastEvidenceOccurredAt:
        reputation?.lastEvidenceOccurredAt ?? null,
    },
    economicEvidence: reputation?.economic ?? {
      currency: 'IWC',
      grossSettledCredit: '0',
      subjectReceivedCredit: '0',
      counterpartyReceivedCredit: '0',
    },
    marketDiversity: {
      counterpartyPrincipalCount:
        reputation?.counterpartyPrincipalCount ?? 0,
      independentSettlementCount:
        globalTrust?.independentSettlementCount ?? 0,
      independentCounterpartyPrincipalCount:
        globalTrust?.independentCounterpartyPrincipalCount ?? 0,
      repeatIndependentSettlementCount:
        globalTrust?.repeatIndependentSettlementCount ?? 0,
      topCounterpartySettlementShare:
        globalTrust?.topCounterpartySettlementShare ?? '0',
      samePrincipalSettlementCount:
        globalTrust?.samePrincipalSettlementCount ?? 0,
    },
    globalTrustEvidence: globalTrust ?? {
      evidenceState: 'insufficient_evidence',
    },
    capabilityEvidence,
    versionEvidence: {
      state: 'unbound',
      reason: 'execution_agent_version_not_bound_by_current_protocol',
    },
    integrityEvidence: {
      state: 'not_available',
      signals: [],
    },
  };
}

async function one(prisma, query) {
  const rows = await prisma.$queryRaw(query);
  return rows[0] ?? null;
}

export async function getReputationPassport(prisma, input) {
  const agentIdentityId = nonEmpty(
    input?.agentIdentityId,
    'agentIdentityId',
  );

  const identity = await one(
    prisma,
    Prisma.sql`
      SELECT
        a."id" AS "agentIdentityId",
        a."principalId" AS "principalId",
        a."name" AS "agentName",
        a."status"::text AS "agentStatus",
        a."createdAt" AS "agentCreatedAt",
        p."type"::text AS "principalType",
        p."status"::text AS "principalStatus"
      FROM "agent_identities" a
      JOIN "principals" p
        ON p."id" = a."principalId"
      WHERE a."id" = ${agentIdentityId}
      LIMIT 1
    `,
  );

  if (!identity) {
    throw new ReputationPassportError(
      'REPUTATION_PASSPORT_AGENT_NOT_FOUND',
      'AgentIdentity does not exist',
      { agentIdentityId },
    );
  }

  const reputationRow = await one(
    prisma,
    Prisma.sql`
      SELECT "iwantu_build_reputation_snapshot_projection"(
        ${identity.principalId},
        ${identity.agentIdentityId}
      ) AS "projection"
    `,
  );

  const globalTrustRow = await one(
    prisma,
    Prisma.sql`
      SELECT "iwantu_build_global_trust_projection"(
        ${identity.principalId},
        ${identity.agentIdentityId}
      ) AS "projection"
    `,
  );

  const capabilityRows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT DISTINCT r."capabilityId"
      FROM "reputation_evidence" e
      JOIN "contracts" c
        ON c."id" = e."contractId"
      JOIN "offer_revisions" o
        ON o."id" = c."acceptedOfferRevisionId"
      JOIN "task_capability_requirements" r
        ON r."taskRevisionId" = o."taskRevisionId"
      WHERE e."subjectPrincipalId" = ${identity.principalId}
        AND e."subjectAgentIdentityId" = ${identity.agentIdentityId}
      ORDER BY r."capabilityId"
    `,
  );

  const capabilities = [];
  for (const row of capabilityRows) {
    const capability = await one(
      prisma,
      Prisma.sql`
        SELECT "iwantu_build_capability_reputation_projection"(
          ${identity.principalId},
          ${identity.agentIdentityId},
          ${row.capabilityId}
        ) AS "projection"
      `,
    );
    if (capability?.projection) capabilities.push(capability.projection);
  }

  return buildReputationPassportDocument({
    identity,
    reputation: reputationRow?.projection ?? null,
    globalTrust: globalTrustRow?.projection ?? null,
    capabilities,
  });
}
