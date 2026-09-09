import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { ensurePrincipalLedgerAccounts } from './ledger/credit-foundation.mjs';
import {
  LedgerPostingError,
  normalizeLedgerAmount,
  postLedgerTransactionInTransaction,
} from './ledger/ledger-posting.mjs';

const CONTRACT_EVIDENCE_VERSION = 'iwantu-contract/0.1';

export class ContractFormationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ContractFormationError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new ContractFormationError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('CONTRACT_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function asDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    deny('CONTRACT_INPUT_INVALID', `${field} must be a valid timestamp`, { field });
  }
  return date;
}

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalContractJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function buildContractEvidence(input) {
  return {
    protocolVersion: CONTRACT_EVIDENCE_VERSION,
    taskId: nonEmpty(input?.taskId, 'taskId'),
    acceptedOfferRevisionId: nonEmpty(input?.acceptedOfferRevisionId, 'acceptedOfferRevisionId'),
    buyerPrincipalId: nonEmpty(input?.buyerPrincipalId, 'buyerPrincipalId'),
    buyerAgentIdentityId: nonEmpty(input?.buyerAgentIdentityId, 'buyerAgentIdentityId'),
    supplierPrincipalId: nonEmpty(input?.supplierPrincipalId, 'supplierPrincipalId'),
    supplierAgentIdentityId: nonEmpty(input?.supplierAgentIdentityId, 'supplierAgentIdentityId'),
    buyerAuthoritySnapshotId: nonEmpty(input?.buyerAuthoritySnapshotId, 'buyerAuthoritySnapshotId'),
    supplierAuthoritySnapshotId: nonEmpty(
      input?.supplierAuthoritySnapshotId,
      'supplierAuthoritySnapshotId',
    ),
    taskSnapshotHash: nonEmpty(input?.taskSnapshotHash, 'taskSnapshotHash'),
    offerSnapshotHash: nonEmpty(input?.offerSnapshotHash, 'offerSnapshotHash'),
    priceAmount: normalizeLedgerAmount(input?.priceAmount).decimal,
    currency: nonEmpty(input?.currency, 'currency'),
  };
}

export function hashContractEvidence(evidence) {
  return createHash('sha256')
    .update(canonicalContractJson(evidence), 'utf8')
    .digest('hex');
}

function isPrismaCode(error, code) {
  return Boolean(error && typeof error === 'object' && error.code === code);
}

function isSerializationFailure(error) {
  if (isPrismaCode(error, 'P2034')) return true;
  const diagnostic = `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`;
  return /could not serialize access|serialization|sqlstate.?40001|\b40001\b/i.test(diagnostic);
}

async function loadExistingByIdempotency(tx, idempotencyKey) {
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT *
      FROM "contracts"
      WHERE "formationIdempotencyKey" = ${idempotencyKey}
    `,
  );
  return rows[0] ?? null;
}

async function lockTask(tx, taskId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT "id", "issuerPrincipalId", "issuerAgentIdentityId", "status", "currentRevision"
      FROM "tasks"
      WHERE "id" = ${taskId}
      FOR UPDATE
    `,
  );
  return rows[0] ?? null;
}

async function lockOffers(tx, taskId) {
  return tx.$queryRaw(
    Prisma.sql`
      SELECT "id", "taskId", "supplierPrincipalId", "supplierAgentIdentityId", "status", "currentRevision"
      FROM "offers"
      WHERE "taskId" = ${taskId}
      ORDER BY "id"
      FOR UPDATE
    `,
  );
}

async function loadAuthoritySnapshot(tx, snapshotId) {
  return tx.authoritySnapshot.findUnique({ where: { id: snapshotId } });
}

function assertBuyerSnapshot(snapshot, input) {
  if (!snapshot) deny('BUYER_AUTHORITY_SNAPSHOT_NOT_FOUND', 'Buyer AuthoritySnapshot does not exist');
  if (
    snapshot.principalId !== input.buyerPrincipalId
    || snapshot.agentIdentityId !== input.buyerAgentIdentityId
    || snapshot.resolvedAction !== 'offer.accept'
  ) {
    deny('BUYER_MANDATE_DENIED', 'Buyer AuthoritySnapshot is not bound to offer.accept', {
      buyerAuthoritySnapshotId: snapshot.id,
    });
  }
  const evidence = snapshot.requestEvidence ?? {};
  if (
    evidence.action !== 'offer.accept'
    || evidence.payloadHash !== input.buyerAcceptanceHash
    || typeof evidence.commandHash !== 'string'
    || evidence.commandHash.length === 0
  ) {
    deny('BUYER_ACCEPTANCE_EVIDENCE_MISMATCH', 'Buyer signed acceptance evidence is not bound to the AuthoritySnapshot');
  }
}

function assertSupplierSnapshot(snapshot, offerRevision, offer) {
  if (!snapshot) deny('SUPPLIER_AUTHORITY_SNAPSHOT_NOT_FOUND', 'Supplier AuthoritySnapshot does not exist');
  if (
    snapshot.principalId !== offer.supplierPrincipalId
    || snapshot.agentIdentityId !== offer.supplierAgentIdentityId
    || !['offer.issue', 'offer.revise'].includes(snapshot.resolvedAction)
  ) {
    deny('SUPPLIER_COMMITMENT_INVALID', 'Supplier AuthoritySnapshot is not bound to the selected Offer');
  }
  const evidence = snapshot.requestEvidence ?? {};
  if (evidence.payloadHash !== offerRevision.offerHash) {
    deny('SUPPLIER_COMMITMENT_INVALID', 'Supplier AuthoritySnapshot payload hash does not match selected Offer');
  }
}

function escrowPostingInput({ contractId, buyerPrincipalId, availableAccountId, lockedAccountId, amount, metadata }) {
  return {
    type: 'contract_escrow',
    referenceType: 'escrow_lock',
    referenceId: contractId,
    idempotencyKey: `escrow:lock:${contractId}`,
    metadata: {
      escrowAction: 'lock',
      contractId,
      buyerPrincipalId,
      formation: metadata ?? null,
    },
    entries: [
      { accountId: availableAccountId, side: 'debit', amount },
      { accountId: lockedAccountId, side: 'credit', amount },
    ],
  };
}

async function formContractInTransaction(tx, input, now) {
  const idempotencyKey = nonEmpty(input.formationIdempotencyKey, 'formationIdempotencyKey');
  const offerId = nonEmpty(input.offerId, 'offerId');
  const offerRevisionNumber = input.offerRevision;
  if (!Number.isInteger(offerRevisionNumber) || offerRevisionNumber < 1) {
    deny('CONTRACT_INPUT_INVALID', 'offerRevision must be a positive integer');
  }
  const offerHash = nonEmpty(input.offerHash, 'offerHash');
  const buyerAcceptanceHash = nonEmpty(input.buyerAcceptanceHash, 'buyerAcceptanceHash');
  const buyerAuthoritySnapshotId = nonEmpty(
    input.buyerAuthoritySnapshotId,
    'buyerAuthoritySnapshotId',
  );

  const existing = await loadExistingByIdempotency(tx, idempotencyKey);
  if (existing) {
    if (existing.offerSnapshotHash !== offerHash) {
      deny('IDEMPOTENCY_CONFLICT', 'Formation idempotency key is already bound to another Offer');
    }
    const escrow = existing.escrowId
      ? await tx.escrow.findUnique({ where: { id: existing.escrowId } })
      : null;
    return { contract: existing, escrow, ledgerTransaction: null, idempotent: true };
  }

  const offerEnvelope = await tx.offer.findUnique({
    where: { id: offerId },
    select: { id: true, taskId: true },
  });
  if (!offerEnvelope) deny('OFFER_NOT_FOUND', 'Offer does not exist', { offerId });

  const task = await lockTask(tx, offerEnvelope.taskId);
  if (!task) deny('TASK_NOT_FOUND', 'Task does not exist', { taskId: offerEnvelope.taskId });
  if (task.status !== 'open') {
    deny('TASK_NOT_OPEN', 'Contract Formation requires an OPEN Task', {
      taskId: task.id,
      status: task.status,
    });
  }

  const offers = await lockOffers(tx, task.id);
  const offer = offers.find((candidate) => candidate.id === offerId);
  if (!offer) deny('OFFER_NOT_FOUND', 'Offer does not belong to the locked Task', { offerId });
  if (offer.status !== 'active') {
    deny('OFFER_NOT_ACTIVE', 'Contract Formation requires an ACTIVE Offer', {
      offerId,
      status: offer.status,
    });
  }
  if (offer.currentRevision !== offerRevisionNumber) {
    deny('OFFER_SUPERSEDED', 'Requested Offer revision is not current', {
      requestedRevision: offerRevisionNumber,
      currentRevision: offer.currentRevision,
    });
  }

  const [offerRevision, taskRevision] = await Promise.all([
    tx.offerRevision.findUnique({
      where: { offerId_revision: { offerId, revision: offerRevisionNumber } },
    }),
    tx.taskRevision.findUnique({
      where: { taskId_revision: { taskId: task.id, revision: task.currentRevision } },
    }),
  ]);
  if (!offerRevision) deny('OFFER_REVISION_NOT_FOUND', 'Offer revision does not exist');
  if (!taskRevision || !taskRevision.sealedAt) {
    deny('TASK_REVISION_INVALID', 'Current Task revision is missing or unsealed');
  }
  if (offerRevision.offerHash !== offerHash) {
    deny('OFFER_REVISION_MISMATCH', 'Offer hash does not match the selected immutable revision');
  }
  if (now.getTime() >= offerRevision.validUntil.getTime()) {
    deny('OFFER_EXPIRED', 'Selected Firm Offer has expired', {
      validUntil: offerRevision.validUntil.toISOString(),
    });
  }
  if (
    offerRevision.taskRevisionId !== taskRevision.id
    || offerRevision.taskHash !== taskRevision.contentHash
  ) {
    deny('TASK_REVISION_MISMATCH', 'Offer is bound to a stale Task snapshot');
  }

  const buyerPrincipalId = task.issuerPrincipalId;
  const buyerAgentIdentityId = task.issuerAgentIdentityId;
  const [buyerSnapshot, supplierSnapshot] = await Promise.all([
    loadAuthoritySnapshot(tx, buyerAuthoritySnapshotId),
    loadAuthoritySnapshot(tx, offerRevision.supplierAuthoritySnapshotId),
  ]);
  assertBuyerSnapshot(buyerSnapshot, {
    buyerPrincipalId,
    buyerAgentIdentityId,
    buyerAcceptanceHash,
  });
  assertSupplierSnapshot(supplierSnapshot, offerRevision, offer);

  const amount = normalizeLedgerAmount(String(offerRevision.priceAmount)).decimal;
  if (offerRevision.currency !== 'IWC') {
    deny('CONTRACT_CURRENCY_UNSUPPORTED', 'M4-01 Contract Formation supports IWC only');
  }

  const buyerAccounts = await ensurePrincipalLedgerAccounts(tx, buyerPrincipalId);
  let ledgerTransaction;
  const contractId = randomUUID();
  try {
    ledgerTransaction = await postLedgerTransactionInTransaction(
      tx,
      escrowPostingInput({
        contractId,
        buyerPrincipalId,
        availableAccountId: buyerAccounts.principal_available.id,
        lockedAccountId: buyerAccounts.principal_locked.id,
        amount,
        metadata: {
          taskId: task.id,
          offerId,
          offerRevision: offerRevisionNumber,
          offerHash,
        },
      }),
    );
  } catch (error) {
    if (error instanceof LedgerPostingError && error.code === 'LEDGER_ACCOUNT_OVERDRAFT') {
      deny('INSUFFICIENT_CREDIT', 'Buyer has insufficient available IWC for Contract Escrow');
    }
    throw error;
  }

  const escrow = await tx.escrow.create({
    data: {
      contractId,
      buyerAccountId: buyerAccounts.principal_available.id,
      amount,
      currency: 'IWC',
      lockLedgerTransactionId: ledgerTransaction.id,
    },
  });

  const contractEvidence = buildContractEvidence({
    taskId: task.id,
    acceptedOfferRevisionId: offerRevision.id,
    buyerPrincipalId,
    buyerAgentIdentityId,
    supplierPrincipalId: offer.supplierPrincipalId,
    supplierAgentIdentityId: offer.supplierAgentIdentityId,
    buyerAuthoritySnapshotId,
    supplierAuthoritySnapshotId: offerRevision.supplierAuthoritySnapshotId,
    taskSnapshotHash: taskRevision.contentHash,
    offerSnapshotHash: offerRevision.offerHash,
    priceAmount: amount,
    currency: offerRevision.currency,
  });
  const effectiveContractHash = hashContractEvidence(contractEvidence);

  const inserted = await tx.$queryRaw(
    Prisma.sql`
      INSERT INTO "contracts" (
        "id", "taskId", "acceptedOfferRevisionId",
        "buyerPrincipalId", "buyerAgentIdentityId",
        "supplierPrincipalId", "supplierAgentIdentityId",
        "buyerAuthoritySnapshotId", "supplierAuthoritySnapshotId",
        "taskSnapshotHash", "offerSnapshotHash", "effectiveContractHash",
        "formationIdempotencyKey", "lifecycleState", "escrowId", "activatedAt"
      ) VALUES (
        ${contractId}, ${task.id}, ${offerRevision.id},
        ${buyerPrincipalId}, ${buyerAgentIdentityId},
        ${offer.supplierPrincipalId}, ${offer.supplierAgentIdentityId},
        ${buyerAuthoritySnapshotId}, ${offerRevision.supplierAuthoritySnapshotId},
        ${taskRevision.contentHash}, ${offerRevision.offerHash}, ${effectiveContractHash},
        ${idempotencyKey}, 'active'::"ContractLifecycleState", ${escrow.id}, ${now}
      )
      RETURNING *
    `,
  );

  await tx.offer.update({ where: { id: offerId }, data: { status: 'accepted' } });
  await tx.offer.updateMany({
    where: { taskId: task.id, id: { not: offerId }, status: 'active' },
    data: { status: 'not_selected' },
  });
  await tx.task.update({ where: { id: task.id }, data: { status: 'awarded' } });

  return {
    contract: inserted[0],
    escrow,
    ledgerTransaction,
    contractEvidence,
    idempotent: false,
  };
}

/**
 * Internal M4-01 atomic persistence boundary.
 *
 * The caller must first authenticate and produce a live, server-captured buyer
 * AuthoritySnapshot for action `offer.accept`, bound to buyerAcceptanceHash.
 * This function then performs Task/Offer revalidation, Escrow lock, Contract
 * creation, Offer selection and Task award in one SERIALIZABLE transaction.
 */
export async function formAuthorizedContract(prisma, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('PROTOCOL_CLIENT_INVALID', 'formAuthorizedContract requires a PrismaClient');
  }
  const now = asDate(options.now ?? new Date(), 'now');
  const maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0
    ? options.maxRetries
    : 3;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => formContractInTransaction(tx, input, now),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof ContractFormationError) throw error;
      if (isSerializationFailure(error) && attempt < maxRetries) continue;
      if (isSerializationFailure(error)) {
        deny('CONTRACT_CONCURRENCY_RETRY_EXHAUSTED', 'Contract Formation concurrency retries exhausted');
      }
      if (isPrismaCode(error, 'P2002')) {
        deny('IDEMPOTENCY_CONFLICT', 'Contract Formation collided with an existing immutable Contract');
      }
      throw error;
    }
  }

  deny('CONTRACT_FORMATION_FAILED', 'Contract Formation failed unexpectedly');
}
