import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { canonicalEconomicCommandJson } from './signed-economic-command.mjs';

const DISPUTE_PROTOCOL = 'iwantu.dispute.v0.1';
const REASON_CODES = new Set(['rework_not_granted', 'attempts_exhausted']);

export class DisputeProtocolError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'DisputeProtocolError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new DisputeProtocolError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('DISPUTE_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function asDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    deny('DISPUTE_INPUT_INVALID', `${field} must be a valid timestamp`, { field });
  }
  return date;
}

export function buildDisputeEvidence(input) {
  const reasonCode = nonEmpty(input?.reasonCode, 'reasonCode');
  if (!REASON_CODES.has(reasonCode)) {
    deny('DISPUTE_REASON_INVALID', 'Unsupported dispute reason code', { reasonCode });
  }
  return {
    protocolVersion: DISPUTE_PROTOCOL,
    contractId: nonEmpty(input?.contractId, 'contractId'),
    effectiveContractHash: nonEmpty(input?.effectiveContractHash, 'effectiveContractHash'),
    deliveryId: nonEmpty(input?.deliveryId, 'deliveryId'),
    deliveryHash: nonEmpty(input?.deliveryHash, 'deliveryHash'),
    rejectionDecisionId: nonEmpty(input?.rejectionDecisionId, 'rejectionDecisionId'),
    rejectionDecisionHash: nonEmpty(input?.rejectionDecisionHash, 'rejectionDecisionHash'),
    reasonCode,
    openedAt: asDate(input?.openedAt, 'openedAt').toISOString(),
  };
}

export function hashDisputeEvidence(evidence) {
  return createHash('sha256')
    .update(canonicalEconomicCommandJson(buildDisputeEvidence(evidence)), 'utf8')
    .digest('hex');
}

function assertExistingMatches(existing, evidence) {
  if (
    existing.contractId !== evidence.contractId
    || existing.effectiveContractHash !== evidence.effectiveContractHash
    || existing.deliveryId !== evidence.deliveryId
    || existing.deliveryHash !== evidence.deliveryHash
    || existing.rejectionDecisionId !== evidence.rejectionDecisionId
    || existing.rejectionDecisionHash !== evidence.rejectionDecisionHash
    || existing.reasonCode !== evidence.reasonCode
  ) {
    deny(
      'DISPUTE_CONFLICT',
      'Contract already has a different immutable Dispute fact',
      { contractId: evidence.contractId, disputeId: existing.id },
    );
  }
}

export async function createDisputeInTransaction(tx, input) {
  const evidence = buildDisputeEvidence(input);
  const existingRows = await tx.$queryRaw(
    Prisma.sql`
      SELECT * FROM "disputes"
      WHERE "contractId" = ${evidence.contractId}
      LIMIT 1
    `,
  );
  if (existingRows[0]) {
    assertExistingMatches(existingRows[0], evidence);
    return { dispute: existingRows[0], disputeHash: existingRows[0].disputeHash, replayed: true };
  }

  const disputeHash = hashDisputeEvidence(evidence);
  const id = `dispute_${randomUUID()}`;
  const rows = await tx.$queryRaw(
    Prisma.sql`
      INSERT INTO "disputes" (
        "id", "contractId", "effectiveContractHash", "deliveryId", "deliveryHash",
        "rejectionDecisionId", "rejectionDecisionHash", "reasonCode",
        "openedAt", "disputeHash"
      ) VALUES (
        ${id}, ${evidence.contractId}, ${evidence.effectiveContractHash},
        ${evidence.deliveryId}, ${evidence.deliveryHash},
        ${evidence.rejectionDecisionId}, ${evidence.rejectionDecisionHash},
        ${evidence.reasonCode}, ${new Date(evidence.openedAt)}, ${disputeHash}
      )
      RETURNING *
    `,
  );
  return { dispute: rows[0], disputeHash, replayed: false };
}
