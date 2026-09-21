import { Prisma } from '@prisma/client';

export const INTEGRITY_SIGNAL_PROTOCOL_VERSION =
  'iwantu.integrity-signal.v0.1';

export const INTEGRITY_RULE_CODES = Object.freeze({
  SELF_TRADING: 'R1_SELF_TRADING',
  SAME_PRINCIPAL_TRADING: 'R2_SAME_PRINCIPAL_TRADING',
  HIGH_COUNTERPARTY_CONCENTRATION: 'R3_HIGH_COUNTERPARTY_CONCENTRATION',
  HIGH_RECIPROCAL_FLOW: 'R4_HIGH_RECIPROCAL_FLOW',
  CIRCULAR_FLOW: 'R5_CIRCULAR_FLOW',
  NEW_ACCOUNT_CLUSTER: 'R6_NEW_ACCOUNT_CLUSTER',
  GENESIS_CREDIT_LOOP: 'R7_GENESIS_CREDIT_LOOP',
  INCENTIVE_FARMING: 'R8_INCENTIVE_FARMING',
});

export class IntegritySignalError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'IntegritySignalError';
    this.code = code;
    this.details = details;
  }
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IntegritySignalError(
      'INTEGRITY_SIGNAL_INPUT_INVALID',
      field + ' must be a non-empty string',
      { field },
    );
  }
  return value.trim();
}

function objectValue(value, field) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new IntegritySignalError(
      'INTEGRITY_SIGNAL_INPUT_INVALID',
      field + ' must be a plain JSON object',
      { field },
    );
  }
  return value;
}

function dateValue(value, field) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new IntegritySignalError(
      'INTEGRITY_SIGNAL_INPUT_INVALID',
      field + ' must be a valid date',
      { field },
    );
  }
  return date;
}

function normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new IntegritySignalError(
      'INTEGRITY_SIGNAL_INPUT_INVALID',
      'Integrity signal input must be an object',
    );
  }

  const scope = nonEmpty(input.scope, 'scope');
  if (scope !== 'principal' && scope !== 'agent') {
    throw new IntegritySignalError(
      'INTEGRITY_SIGNAL_INPUT_INVALID',
      'scope must be principal or agent',
      { field: 'scope' },
    );
  }

  const subjectAgentIdentityId =
    input.subjectAgentIdentityId === null ||
    input.subjectAgentIdentityId === undefined
      ? null
      : nonEmpty(input.subjectAgentIdentityId, 'subjectAgentIdentityId');

  if (scope === 'agent' && !subjectAgentIdentityId) {
    throw new IntegritySignalError(
      'INTEGRITY_SIGNAL_INPUT_INVALID',
      'agent scope requires subjectAgentIdentityId',
      { field: 'subjectAgentIdentityId' },
    );
  }
  if (scope === 'principal' && subjectAgentIdentityId) {
    throw new IntegritySignalError(
      'INTEGRITY_SIGNAL_INPUT_INVALID',
      'principal scope must not bind an AgentIdentity',
      { field: 'subjectAgentIdentityId' },
    );
  }

  const basisStart = dateValue(input.basisStart, 'basisStart');
  const basisEnd = dateValue(input.basisEnd, 'basisEnd');
  const observedAt = dateValue(input.observedAt, 'observedAt');

  if (basisStart > basisEnd || observedAt < basisEnd) {
    throw new IntegritySignalError(
      'INTEGRITY_SIGNAL_TIME_WINDOW_INVALID',
      'Integrity signal time window is invalid',
    );
  }

  return {
    subjectPrincipalId: nonEmpty(
      input.subjectPrincipalId,
      'subjectPrincipalId',
    ),
    subjectAgentIdentityId,
    scope,
    ruleCode: nonEmpty(input.ruleCode, 'ruleCode'),
    ruleVersion: nonEmpty(input.ruleVersion, 'ruleVersion'),
    signalClass: nonEmpty(input.signalClass, 'signalClass'),
    evidence: objectValue(input.evidence, 'evidence'),
    metrics: objectValue(input.metrics, 'metrics'),
    basisStart,
    basisEnd,
    observedAt,
  };
}

export async function emitIntegritySignal(prisma, input) {
  const normalized = normalizeInput(input);
  const evidenceJson = JSON.stringify(normalized.evidence);
  const metricsJson = JSON.stringify(normalized.metrics);

  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM "iwantu_emit_integrity_signal"(
        ${normalized.subjectPrincipalId},
        ${normalized.subjectAgentIdentityId},
        ${normalized.scope},
        ${normalized.ruleCode},
        ${normalized.ruleVersion},
        ${normalized.signalClass},
        CAST(${evidenceJson} AS jsonb),
        CAST(${metricsJson} AS jsonb),
        ${normalized.basisStart},
        ${normalized.basisEnd},
        ${normalized.observedAt}
      )
    `,
  );

  const signal = rows[0] ?? null;
  if (!signal) {
    throw new IntegritySignalError(
      'INTEGRITY_SIGNAL_EMIT_FAILED',
      'Integrity signal emission returned no row',
      {
        subjectPrincipalId: normalized.subjectPrincipalId,
        ruleCode: normalized.ruleCode,
      },
    );
  }
  return signal;
}

export async function listIntegritySignals(prisma, input) {
  const subjectPrincipalId = nonEmpty(
    input?.subjectPrincipalId,
    'subjectPrincipalId',
  );
  const subjectAgentIdentityId =
    input?.subjectAgentIdentityId === undefined ||
    input?.subjectAgentIdentityId === null
      ? null
      : nonEmpty(input.subjectAgentIdentityId, 'subjectAgentIdentityId');

  if (subjectAgentIdentityId) {
    return prisma.$queryRaw(
      Prisma.sql`
        SELECT *
        FROM "integrity_signals"
        WHERE "subjectPrincipalId" = ${subjectPrincipalId}
          AND "subjectAgentIdentityId" = ${subjectAgentIdentityId}
        ORDER BY "observedAt" DESC, "ruleCode", "id"
      `,
    );
  }

  return prisma.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM "integrity_signals"
      WHERE "subjectPrincipalId" = ${subjectPrincipalId}
      ORDER BY "observedAt" DESC, "ruleCode", "id"
    `,
  );
}
