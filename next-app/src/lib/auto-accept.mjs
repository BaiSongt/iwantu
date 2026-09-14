import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { canonicalEconomicCommandJson } from './signed-economic-command.mjs';

const AUTO_ACCEPT_PROTOCOL_VERSION = 'iwantu-auto-accept/0.1';
const DEFAULT_ACCEPTANCE_TIMEOUT_SECONDS = 24 * 60 * 60;
const MIN_ACCEPTANCE_TIMEOUT_SECONDS = 60;
const MAX_ACCEPTANCE_TIMEOUT_SECONDS = 7 * 24 * 60 * 60;

export class AutoAcceptProtocolError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AutoAcceptProtocolError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new AutoAcceptProtocolError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('AUTO_ACCEPT_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function asDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    deny('AUTO_ACCEPT_INPUT_INVALID', `${field} must be a valid timestamp`, { field });
  }
  return date;
}

function hashCanonical(value) {
  return createHash('sha256').update(canonicalEconomicCommandJson(value), 'utf8').digest('hex');
}

export function resolveAcceptanceTimeoutSeconds(termsPayload) {
  const candidate = termsPayload && typeof termsPayload === 'object'
    ? termsPayload.acceptanceTimeoutSeconds
    : undefined;
  if (candidate === undefined || candidate === null || candidate === '') {
    return DEFAULT_ACCEPTANCE_TIMEOUT_SECONDS;
  }
  const seconds = Number(candidate);
  if (!Number.isInteger(seconds)
      || seconds < MIN_ACCEPTANCE_TIMEOUT_SECONDS
      || seconds > MAX_ACCEPTANCE_TIMEOUT_SECONDS) {
    deny('AUTO_ACCEPT_POLICY_INVALID', 'acceptanceTimeoutSeconds must be an integer between 60 and 604800', {
      acceptanceTimeoutSeconds: candidate,
    });
  }
  return seconds;
}

export function calculateAutoAcceptDeadline(submittedAt, timeoutSeconds) {
  const submitted = asDate(submittedAt, 'submittedAt');
  if (!Number.isInteger(timeoutSeconds)
      || timeoutSeconds < MIN_ACCEPTANCE_TIMEOUT_SECONDS
      || timeoutSeconds > MAX_ACCEPTANCE_TIMEOUT_SECONDS) {
    deny('AUTO_ACCEPT_POLICY_INVALID', 'timeoutSeconds is outside the supported MVP range');
  }
  return new Date(submitted.getTime() + timeoutSeconds * 1000);
}

export function buildAutoAcceptEvidence(input) {
  return {
    protocolVersion: AUTO_ACCEPT_PROTOCOL_VERSION,
    contractId: nonEmpty(input?.contractId, 'contractId'),
    effectiveContractHash: nonEmpty(input?.effectiveContractHash, 'effectiveContractHash'),
    deliveryId: nonEmpty(input?.deliveryId, 'deliveryId'),
    deliveryHash: nonEmpty(input?.deliveryHash, 'deliveryHash'),
    buyerPrincipalId: nonEmpty(input?.buyerPrincipalId, 'buyerPrincipalId'),
    buyerAgentIdentityId: nonEmpty(input?.buyerAgentIdentityId, 'buyerAgentIdentityId'),
    decision: 'accept',
    source: 'auto_accept',
    acceptanceTimeoutSeconds: input?.acceptanceTimeoutSeconds,
    autoAcceptDeadline: asDate(input?.autoAcceptDeadline, 'autoAcceptDeadline').toISOString(),
  };
}

export function hashAutoAcceptEvidence(evidence) {
  return hashCanonical(buildAutoAcceptEvidence(evidence));
}

async function loadContractForUpdate(tx, contractId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT * FROM "contracts" WHERE "id" = ${contractId} FOR UPDATE`,
  );
  return rows[0] ?? null;
}

async function loadLatestDelivery(tx, contractId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT * FROM "deliveries" WHERE "contractId" = ${contractId} ORDER BY "sequence" DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

async function loadExistingDecision(tx, deliveryId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT * FROM "delivery_acceptance_decisions" WHERE "deliveryId" = ${deliveryId} LIMIT 1`,
  );
  return rows[0] ?? null;
}

function isSerializationFailure(error) {
  if (error && typeof error === 'object' && error.code === 'P2034') return true;
  const diagnostic = `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`;
  return /could not serialize access|serialization|sqlstate.?40001|\b40001\b/i.test(diagnostic);
}

async function autoAcceptInTransaction(tx, contractId, now) {
  const contract = await loadContractForUpdate(tx, contractId);
  if (!contract) deny('AUTO_ACCEPT_CONTRACT_NOT_FOUND', 'Contract does not exist', { contractId });
  if (contract.lifecycleState !== 'acceptance_pending') {
    deny('AUTO_ACCEPT_CONTRACT_STATE_INVALID', 'AUTO_ACCEPT requires ACCEPTANCE_PENDING Contract', {
      lifecycleState: contract.lifecycleState,
    });
  }

  const delivery = await loadLatestDelivery(tx, contractId);
  if (!delivery) deny('AUTO_ACCEPT_DELIVERY_NOT_FOUND', 'Contract has no protocol-valid Delivery');

  const existingDecision = await loadExistingDecision(tx, delivery.id);
  if (existingDecision) {
    if (existingDecision.source === 'auto_accept' && existingDecision.decision === 'accept') {
      const escrow = contract.escrowId ? await tx.escrow.findUnique({ where: { id: contract.escrowId } }) : null;
      return {
        acceptanceDecision: existingDecision,
        contract,
        escrow,
        idempotent: true,
      };
    }
    deny('AUTO_ACCEPT_ALREADY_DECIDED', 'Latest Delivery already has a Buyer decision', {
      decision: existingDecision.decision,
      source: existingDecision.source,
    });
  }

  const offerRevision = await tx.offerRevision.findUnique({
    where: { id: contract.acceptedOfferRevisionId },
    select: { id: true, termsPayload: true },
  });
  if (!offerRevision) deny('AUTO_ACCEPT_OFFER_REVISION_NOT_FOUND', 'Accepted Offer revision no longer resolves');

  const acceptanceTimeoutSeconds = resolveAcceptanceTimeoutSeconds(offerRevision.termsPayload);
  const autoAcceptDeadline = calculateAutoAcceptDeadline(delivery.submittedAt, acceptanceTimeoutSeconds);
  if (now.getTime() < autoAcceptDeadline.getTime()) {
    deny('AUTO_ACCEPT_NOT_DUE', 'Buyer acceptance window is still open', {
      autoAcceptDeadline: autoAcceptDeadline.toISOString(),
    });
  }

  const evidence = buildAutoAcceptEvidence({
    contractId,
    effectiveContractHash: contract.effectiveContractHash,
    deliveryId: delivery.id,
    deliveryHash: delivery.deliveryHash,
    buyerPrincipalId: contract.buyerPrincipalId,
    buyerAgentIdentityId: contract.buyerAgentIdentityId,
    acceptanceTimeoutSeconds,
    autoAcceptDeadline,
  });
  const systemEvidenceHash = hashAutoAcceptEvidence(evidence);
  const decisionIdempotencyKey = `auto-accept:${delivery.id}`;
  const nonce = `system:auto-accept:${delivery.id}`;

  const inserted = await tx.$queryRaw(
    Prisma.sql`
      INSERT INTO "delivery_acceptance_decisions" (
        "id", "decisionIdempotencyKey", "contractId", "deliveryId",
        "effectiveContractHash", "deliveryHash", "decision", "source",
        "reasonCode", "reasonDetail", "buyerPrincipalId", "buyerAgentIdentityId",
        "authoritySnapshotId", "decisionHash", "commandHash", "nonce",
        "signatureAlgorithm", "signingKeyId", "buyerSignature",
        "commandIssuedAt", "commandExpiresAt", "decidedAt",
        "autoAcceptDeadline", "autoAcceptPolicySeconds", "systemEvidenceHash"
      ) VALUES (
        ${randomUUID()}, ${decisionIdempotencyKey}, ${contractId}, ${delivery.id},
        ${contract.effectiveContractHash}, ${delivery.deliveryHash}, 'accept', 'auto_accept',
        NULL, NULL, ${contract.buyerPrincipalId}, ${contract.buyerAgentIdentityId},
        NULL, ${systemEvidenceHash}, NULL, ${nonce},
        NULL, NULL, NULL,
        NULL, NULL, ${now},
        ${autoAcceptDeadline}, ${acceptanceTimeoutSeconds}, ${systemEvidenceHash}
      )
      RETURNING *
    `,
  );

  const escrow = contract.escrowId ? await tx.escrow.findUnique({ where: { id: contract.escrowId } }) : null;
  if (!escrow || escrow.status !== 'locked') {
    deny('AUTO_ACCEPT_ESCROW_STATE_INVALID', 'AUTO_ACCEPT must leave Escrow locked for the settlement boundary');
  }

  return {
    acceptanceDecision: inserted[0],
    evidence,
    contract,
    escrow,
    idempotent: false,
  };
}

export async function autoAcceptTimedOutDelivery(prisma, contractIdInput, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('PROTOCOL_CLIENT_INVALID', 'autoAcceptTimedOutDelivery requires a PrismaClient');
  }
  const contractId = nonEmpty(contractIdInput, 'contractId');
  const now = asDate(options.now ?? new Date(), 'now');
  const maxAttempts = Number.isInteger(options.maxSerializationAttempts)
    ? Math.max(1, options.maxSerializationAttempts)
    : 3;
  let lastError;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => autoAcceptInTransaction(tx, contractId, now),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      lastError = error;
      if (!isSerializationFailure(error) || attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
}
