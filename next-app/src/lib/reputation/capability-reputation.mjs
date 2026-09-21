import { Prisma } from '@prisma/client';

export const CAPABILITY_REPUTATION_PROJECTION_VERSION =
  'iwantu.capability-reputation.v0.1';

export class CapabilityReputationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'CapabilityReputationError';
    this.code = code;
    this.details = details;
  }
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new CapabilityReputationError(
      'CAPABILITY_REPUTATION_INPUT_INVALID',
      `${field} must be a non-empty string`,
      { field },
    );
  }
  return value.trim();
}

function normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new CapabilityReputationError(
      'CAPABILITY_REPUTATION_INPUT_INVALID',
      'Capability reputation input must be an object',
    );
  }

  return {
    subjectPrincipalId: nonEmpty(
      input.subjectPrincipalId,
      'subjectPrincipalId',
    ),
    subjectAgentIdentityId: nonEmpty(
      input.subjectAgentIdentityId,
      'subjectAgentIdentityId',
    ),
    capabilityId: nonEmpty(input.capabilityId, 'capabilityId'),
  };
}

export function buildCapabilityReputationSnapshotId(input) {
  const normalized = normalizeInput(input);
  return [
    'caprep',
    normalized.subjectPrincipalId,
    normalized.subjectAgentIdentityId,
    normalized.capabilityId,
    CAPABILITY_REPUTATION_PROJECTION_VERSION,
  ].join(':');
}

export async function rebuildCapabilityReputationSnapshot(prisma, input) {
  const normalized = normalizeInput(input);
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM "iwantu_rebuild_capability_reputation_snapshot"(
        ${normalized.subjectPrincipalId},
        ${normalized.subjectAgentIdentityId},
        ${normalized.capabilityId}
      )
    `,
  );

  const snapshot = rows[0] ?? null;
  if (!snapshot) {
    throw new CapabilityReputationError(
      'CAPABILITY_REPUTATION_REBUILD_FAILED',
      'Capability reputation snapshot rebuild returned no row',
      normalized,
    );
  }
  return snapshot;
}

export async function getCapabilityReputationSnapshot(prisma, input) {
  const normalized = normalizeInput(input);
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM "reputation_capability_snapshots"
      WHERE "subjectPrincipalId" = ${normalized.subjectPrincipalId}
        AND "subjectAgentIdentityId" = ${normalized.subjectAgentIdentityId}
        AND "capabilityId" = ${normalized.capabilityId}
        AND "projectionVersion" =
          ${CAPABILITY_REPUTATION_PROJECTION_VERSION}
      LIMIT 1
    `,
  );

  return rows[0] ?? null;
}
