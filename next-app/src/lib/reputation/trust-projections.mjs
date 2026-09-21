import { Prisma } from '@prisma/client';

export const LOCAL_TRUST_PROJECTION_VERSION = 'iwantu.local-trust.v0.1';
export const GLOBAL_TRUST_PROJECTION_VERSION = 'iwantu.global-trust.v0.1';

export class TrustProjectionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'TrustProjectionError';
    this.code = code;
    this.details = details;
  }
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TrustProjectionError(
      'TRUST_PROJECTION_INPUT_INVALID',
      `${field} must be a non-empty string`,
      { field },
    );
  }
  return value.trim();
}

function normalizeSubject(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new TrustProjectionError(
      'TRUST_PROJECTION_INPUT_INVALID',
      'Trust projection input must be an object',
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

function normalizeLocalRelationship(input) {
  const subject = normalizeSubject(input);
  return {
    ...subject,
    counterpartyPrincipalId: nonEmpty(
      input.counterpartyPrincipalId,
      'counterpartyPrincipalId',
    ),
    counterpartyAgentIdentityId: nonEmpty(
      input.counterpartyAgentIdentityId,
      'counterpartyAgentIdentityId',
    ),
  };
}

export function buildLocalTrustSnapshotId(input) {
  const relationship = normalizeLocalRelationship(input);
  return [
    'localtrust',
    relationship.counterpartyAgentIdentityId,
    relationship.subjectAgentIdentityId,
    LOCAL_TRUST_PROJECTION_VERSION,
  ].join(':');
}

export function buildGlobalTrustSnapshotId(input) {
  const subject = normalizeSubject(input);
  return [
    'globaltrust',
    subject.subjectPrincipalId,
    subject.subjectAgentIdentityId,
    GLOBAL_TRUST_PROJECTION_VERSION,
  ].join(':');
}

export async function rebuildLocalTrustSnapshot(prisma, input) {
  const relationship = normalizeLocalRelationship(input);
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM "iwantu_rebuild_local_trust_snapshot"(
        ${relationship.subjectPrincipalId},
        ${relationship.subjectAgentIdentityId},
        ${relationship.counterpartyPrincipalId},
        ${relationship.counterpartyAgentIdentityId}
      )
    `,
  );

  const snapshot = rows[0] ?? null;
  if (!snapshot) {
    throw new TrustProjectionError(
      'LOCAL_TRUST_REBUILD_FAILED',
      'Local trust snapshot rebuild returned no row',
      relationship,
    );
  }
  return snapshot;
}

export async function getLocalTrustSnapshot(prisma, input) {
  const relationship = normalizeLocalRelationship(input);
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM "reputation_local_trust_snapshots"
      WHERE "subjectAgentIdentityId" =
        ${relationship.subjectAgentIdentityId}
        AND "counterpartyAgentIdentityId" =
          ${relationship.counterpartyAgentIdentityId}
        AND "projectionVersion" = ${LOCAL_TRUST_PROJECTION_VERSION}
      LIMIT 1
    `,
  );
  return rows[0] ?? null;
}

export async function rebuildGlobalTrustSnapshot(prisma, input) {
  const subject = normalizeSubject(input);
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM "iwantu_rebuild_global_trust_snapshot"(
        ${subject.subjectPrincipalId},
        ${subject.subjectAgentIdentityId}
      )
    `,
  );

  const snapshot = rows[0] ?? null;
  if (!snapshot) {
    throw new TrustProjectionError(
      'GLOBAL_TRUST_REBUILD_FAILED',
      'Global trust snapshot rebuild returned no row',
      subject,
    );
  }
  return snapshot;
}

export async function getGlobalTrustSnapshot(prisma, input) {
  const subject = normalizeSubject(input);
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM "reputation_global_trust_snapshots"
      WHERE "subjectPrincipalId" = ${subject.subjectPrincipalId}
        AND "subjectAgentIdentityId" = ${subject.subjectAgentIdentityId}
        AND "projectionVersion" = ${GLOBAL_TRUST_PROJECTION_VERSION}
      LIMIT 1
    `,
  );
  return rows[0] ?? null;
}
