import { Prisma } from '@prisma/client';

export const REPUTATION_SNAPSHOT_PROJECTION_VERSION =
  'iwantu.reputation-snapshot.v0.1';

export class ReputationSnapshotError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReputationSnapshotError';
    this.code = code;
    this.details = details;
  }
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ReputationSnapshotError(
      'REPUTATION_SNAPSHOT_INPUT_INVALID',
      `${field} must be a non-empty string`,
      { field },
    );
  }
  return value.trim();
}

export function buildReputationSnapshotId({
  subjectPrincipalId,
  subjectAgentIdentityId,
  projectionVersion = REPUTATION_SNAPSHOT_PROJECTION_VERSION,
}) {
  return [
    'repsnap',
    nonEmpty(subjectPrincipalId, 'subjectPrincipalId'),
    nonEmpty(subjectAgentIdentityId, 'subjectAgentIdentityId'),
    nonEmpty(projectionVersion, 'projectionVersion'),
  ].join(':');
}

function normalizeSubject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ReputationSnapshotError(
      'REPUTATION_SNAPSHOT_INPUT_INVALID',
      'Reputation snapshot subject must be an object',
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
  };
}

export async function rebuildReputationSnapshot(prisma, input) {
  const subject = normalizeSubject(input);

  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM "iwantu_rebuild_reputation_snapshot"(
        ${subject.subjectPrincipalId},
        ${subject.subjectAgentIdentityId}
      )
    `,
  );

  const snapshot = rows[0] ?? null;
  if (!snapshot) {
    throw new ReputationSnapshotError(
      'REPUTATION_SNAPSHOT_REBUILD_FAILED',
      'Reputation snapshot rebuild returned no row',
      subject,
    );
  }

  return snapshot;
}

export async function getReputationSnapshot(prisma, input) {
  const subject = normalizeSubject(input);

  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM "reputation_snapshots"
      WHERE "subjectPrincipalId" = ${subject.subjectPrincipalId}
        AND "subjectAgentIdentityId" = ${subject.subjectAgentIdentityId}
        AND "projectionVersion" = ${REPUTATION_SNAPSHOT_PROJECTION_VERSION}
      LIMIT 1
    `,
  );

  return rows[0] ?? null;
}
