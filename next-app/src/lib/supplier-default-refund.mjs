import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { buildCreditProvenance } from './ledger/credit-foundation.mjs';
import {
  LedgerPostingError,
  postLedgerTransactionInTransaction,
} from './ledger/ledger-posting.mjs';

const SUPPLIER_DEFAULT_PROTOCOL = 'iwantu.supplier-default.v0.1';
const SETTLEMENT_PROTOCOL = 'iwantu.settlement.v0.1';

export class SupplierDefaultRefundError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'SupplierDefaultRefundError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new SupplierDefaultRefundError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('SUPPLIER_DEFAULT_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function asDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    deny('SUPPLIER_DEFAULT_INPUT_INVALID', `${field} must be a valid timestamp`, { field });
  }
  return date;
}

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function hashEvidence(value) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(value)), 'utf8')
    .digest('hex');
}

export function buildSupplierDefaultEvidence(input) {
  return canonicalize({
    protocol: SUPPLIER_DEFAULT_PROTOCOL,
    reasonCode: 'delivery_deadline_missed',
    contractId: nonEmpty(input?.contractId, 'contractId'),
    effectiveContractHash: nonEmpty(input?.effectiveContractHash, 'effectiveContractHash'),
    supplierPrincipalId: nonEmpty(input?.supplierPrincipalId, 'supplierPrincipalId'),
    supplierAgentIdentityId: nonEmpty(input?.supplierAgentIdentityId, 'supplierAgentIdentityId'),
    deliveryDeadline: asDate(input?.deliveryDeadline, 'deliveryDeadline'),
    observedAt: asDate(input?.observedAt, 'observedAt'),
  });
}

export function hashSupplierDefaultEvidence(evidence) {
  return hashEvidence(buildSupplierDefaultEvidence(evidence));
}

export function buildFullRefundSettlementEvidence(input) {
  return canonicalize({
    protocol: SETTLEMENT_PROTOCOL,
    type: 'full_refund',
    contractId: nonEmpty(input?.contractId, 'contractId'),
    effectiveContractHash: nonEmpty(input?.effectiveContractHash, 'effectiveContractHash'),
    supplierDefaultId: nonEmpty(input?.supplierDefaultId, 'supplierDefaultId'),
    supplierDefaultHash: nonEmpty(input?.supplierDefaultHash, 'supplierDefaultHash'),
    buyerPrincipalId: nonEmpty(input?.buyerPrincipalId, 'buyerPrincipalId'),
    supplierPrincipalId: nonEmpty(input?.supplierPrincipalId, 'supplierPrincipalId'),
    supplierAgentIdentityId: nonEmpty(input?.supplierAgentIdentityId, 'supplierAgentIdentityId'),
    escrowId: nonEmpty(input?.escrowId, 'escrowId'),
    amount: nonEmpty(String(input?.amount), 'amount'),
    currency: nonEmpty(input?.currency, 'currency'),
    ledgerTransactionId: nonEmpty(input?.ledgerTransactionId, 'ledgerTransactionId'),
    ledgerTransactionHash: nonEmpty(input?.ledgerTransactionHash, 'ledgerTransactionHash'),
  });
}

export function hashFullRefundSettlementEvidence(evidence) {
  return hashEvidence(buildFullRefundSettlementEvidence(evidence));
}

function isPrismaCode(error, code) {
  return Boolean(error && typeof error === 'object' && error.code === code);
}

function isSerializationFailure(error) {
  if (isPrismaCode(error, 'P2034')) return true;
  const diagnostic = `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`;
  return /serialization|could not serialize|sqlstate.?40001|\b40001\b|concurrent update/i.test(diagnostic);
}

async function one(tx, query) {
  const rows = await tx.$queryRaw(query);
  return rows[0] ?? null;
}

async function loadContractForUpdate(tx, contractId) {
  return one(tx, Prisma.sql`SELECT * FROM "contracts" WHERE "id" = ${contractId} FOR UPDATE`);
}

async function loadExistingSettlement(tx, contractId) {
  return one(tx, Prisma.sql`SELECT * FROM "settlements" WHERE "contractId" = ${contractId}`);
}

async function loadEscrowForUpdate(tx, escrowId, contractId) {
  return one(
    tx,
    Prisma.sql`
      SELECT e.*, e."amount"::text AS "amountText",
             a."principalId" AS "buyerPrincipalId",
             a."type" AS "buyerAccountType"
      FROM "escrows" e
      JOIN "ledger_accounts" a ON a."id" = e."buyerAccountId"
      WHERE e."id" = ${escrowId} AND e."contractId" = ${contractId}
      FOR UPDATE OF e
    `,
  );
}

async function loadBuyerLockedAccount(tx, principalId) {
  return one(
    tx,
    Prisma.sql`
      SELECT * FROM "ledger_accounts"
      WHERE "principalId" = ${principalId}
        AND "type" = 'principal_locked'::"LedgerAccountType"
        AND "currency" = 'IWC'
      LIMIT 1
    `,
  );
}

async function loadAnyDelivery(tx, contractId) {
  return one(
    tx,
    Prisma.sql`SELECT "id" FROM "deliveries" WHERE "contractId" = ${contractId} LIMIT 1`,
  );
}

function assertReplay(existing, input) {
  if (existing.type !== 'full_refund' || existing.idempotencyKey !== input.idempotencyKey) {
    deny(
      'SUPPLIER_DEFAULT_SETTLEMENT_CONFLICT',
      'Contract already has a different terminal Settlement',
      { contractId: input.contractId, settlementId: existing.id, settlementType: existing.type },
    );
  }
}

function refundPostingInput({ contract, escrow, lockedAccount, supplierDefault }) {
  const provenance = buildCreditProvenance({
    kind: 'refund',
    beneficiaryPrincipalId: contract.buyerPrincipalId,
    sourceReferenceType: 'escrow_refund',
    sourceReferenceId: contract.id,
    originalLedgerTransactionId: escrow.lockLedgerTransactionId,
    contractId: contract.id,
  });

  return {
    type: 'refund',
    referenceType: 'escrow_refund',
    referenceId: contract.id,
    idempotencyKey: `escrow:refund:${contract.id}`,
    metadata: {
      escrowAction: 'refund',
      contractId: contract.id,
      buyerPrincipalId: contract.buyerPrincipalId,
      supplierDefaultId: supplierDefault.id,
      supplierDefaultHash: supplierDefault.evidenceHash,
      settlementProtocol: SETTLEMENT_PROTOCOL,
    },
    entries: [
      { accountId: lockedAccount.id, side: 'debit', amount: escrow.amountText },
      {
        accountId: escrow.buyerAccountId,
        side: 'credit',
        amount: escrow.amountText,
        provenance,
      },
    ],
  };
}

async function performDefaultRefund(tx, input, now) {
  const contract = await loadContractForUpdate(tx, input.contractId);
  if (!contract) {
    deny('SUPPLIER_DEFAULT_CONTRACT_NOT_FOUND', 'Contract does not exist', {
      contractId: input.contractId,
    });
  }

  const existingSettlement = await loadExistingSettlement(tx, contract.id);
  if (existingSettlement) {
    assertReplay(existingSettlement, input);
    return { settlement: existingSettlement, replayed: true };
  }

  if (contract.lifecycleState !== 'active') {
    deny(
      'SUPPLIER_DEFAULT_REQUIRES_ACTIVE_CONTRACT',
      'Supplier Default requires an ACTIVE Contract with no protocol-valid Delivery',
      { contractId: contract.id, lifecycleState: contract.lifecycleState },
    );
  }
  if (!contract.escrowId) {
    deny('SUPPLIER_DEFAULT_ESCROW_NOT_BOUND', 'Contract does not have bound Escrow');
  }

  const offerRevision = await tx.offerRevision.findUnique({
    where: { id: contract.acceptedOfferRevisionId },
    select: { deliveryCommitmentSeconds: true },
  });
  if (!offerRevision || offerRevision.deliveryCommitmentSeconds === null) {
    deny(
      'SUPPLIER_DEFAULT_REQUIRES_DELIVERY_DEADLINE',
      'Supplier Default requires an explicit contractual delivery deadline',
      { contractId: contract.id },
    );
  }

  const deliveryDeadline = new Date(
    contract.activatedAt.getTime() + offerRevision.deliveryCommitmentSeconds * 1000,
  );
  if (now.getTime() < deliveryDeadline.getTime()) {
    deny('SUPPLIER_DEFAULT_NOT_DUE', 'Contract delivery deadline has not expired', {
      contractId: contract.id,
      deliveryDeadline: deliveryDeadline.toISOString(),
    });
  }

  const delivery = await loadAnyDelivery(tx, contract.id);
  if (delivery) {
    deny(
      'SUPPLIER_DEFAULT_REQUIRES_NO_VALID_DELIVERY',
      'Supplier Default cannot be formed after a protocol-valid Delivery exists',
      { contractId: contract.id, deliveryId: delivery.id },
    );
  }

  const escrow = await loadEscrowForUpdate(tx, contract.escrowId, contract.id);
  if (!escrow || escrow.status !== 'locked') {
    deny('SUPPLIER_DEFAULT_REQUIRES_LOCKED_ESCROW', 'Supplier Default refund requires locked Escrow', {
      contractId: contract.id,
      escrowId: contract.escrowId,
      escrowStatus: escrow?.status,
    });
  }
  if (
    escrow.buyerPrincipalId !== contract.buyerPrincipalId
    || escrow.buyerAccountType !== 'principal_available'
  ) {
    deny('SUPPLIER_DEFAULT_BUYER_ACCOUNT_INVALID', 'Escrow Buyer account binding is invalid');
  }

  const lockedAccount = await loadBuyerLockedAccount(tx, contract.buyerPrincipalId);
  if (!lockedAccount) {
    deny('SUPPLIER_DEFAULT_LOCKED_ACCOUNT_MISSING', 'Buyer locked Ledger account is missing');
  }

  const defaultEvidence = buildSupplierDefaultEvidence({
    contractId: contract.id,
    effectiveContractHash: contract.effectiveContractHash,
    supplierPrincipalId: contract.supplierPrincipalId,
    supplierAgentIdentityId: contract.supplierAgentIdentityId,
    deliveryDeadline,
    observedAt: now,
  });
  const defaultHash = hashSupplierDefaultEvidence(defaultEvidence);
  const supplierDefaultId = `supplier_default_${randomUUID()}`;

  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO "supplier_defaults" (
        "id", "idempotencyKey", "contractId", "effectiveContractHash",
        "supplierPrincipalId", "supplierAgentIdentityId",
        "deliveryDeadline", "observedAt", "reasonCode", "evidenceHash"
      ) VALUES (
        ${supplierDefaultId}, ${`supplier-default:${contract.id}`}, ${contract.id},
        ${contract.effectiveContractHash}, ${contract.supplierPrincipalId},
        ${contract.supplierAgentIdentityId}, ${deliveryDeadline}, ${now},
        'delivery_deadline_missed', ${defaultHash}
      )
    `,
  );

  const supplierDefault = await one(
    tx,
    Prisma.sql`SELECT * FROM "supplier_defaults" WHERE "id" = ${supplierDefaultId}`,
  );

  let ledgerTransaction;
  try {
    ledgerTransaction = await postLedgerTransactionInTransaction(
      tx,
      refundPostingInput({ contract, escrow, lockedAccount, supplierDefault }),
    );
  } catch (error) {
    if (error instanceof LedgerPostingError) {
      deny('SUPPLIER_DEFAULT_REFUND_LEDGER_FAILED', 'Supplier Default refund Ledger posting failed', {
        ledgerCode: error.code,
        ledgerDetails: error.details,
      });
    }
    throw error;
  }

  if (!ledgerTransaction.transactionHash) {
    deny('SUPPLIER_DEFAULT_REFUND_LEDGER_HASH_MISSING', 'Refund Ledger transaction has no hash');
  }

  const settlementEvidence = buildFullRefundSettlementEvidence({
    contractId: contract.id,
    effectiveContractHash: contract.effectiveContractHash,
    supplierDefaultId,
    supplierDefaultHash: defaultHash,
    buyerPrincipalId: contract.buyerPrincipalId,
    supplierPrincipalId: contract.supplierPrincipalId,
    supplierAgentIdentityId: contract.supplierAgentIdentityId,
    escrowId: escrow.id,
    amount: escrow.amountText,
    currency: escrow.currency,
    ledgerTransactionId: ledgerTransaction.id,
    ledgerTransactionHash: ledgerTransaction.transactionHash,
  });
  const settlementHash = hashFullRefundSettlementEvidence(settlementEvidence);
  const settlementId = `settlement_${randomUUID()}`;
  const allocation = {
    currency: escrow.currency,
    grossAmount: escrow.amountText,
    supplierAmount: '0',
    buyerRefundAmount: escrow.amountText,
  };

  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO "settlements" (
        "id", "idempotencyKey", "contractId", "deliveryId", "acceptanceDecisionId",
        "supplierDefaultId", "effectiveContractHash", "supplierPrincipalId",
        "supplierAgentIdentityId", "escrowId", "type", "ledgerTransactionId",
        "allocation", "settlementHash"
      ) VALUES (
        ${settlementId}, ${input.idempotencyKey}, ${contract.id}, NULL, NULL,
        ${supplierDefaultId}, ${contract.effectiveContractHash}, ${contract.supplierPrincipalId},
        ${contract.supplierAgentIdentityId}, ${escrow.id}, 'full_refund',
        ${ledgerTransaction.id}, ${JSON.stringify(allocation)}::jsonb, ${settlementHash}
      )
    `,
  );

  const settledAt = now;
  await tx.$executeRaw(
    Prisma.sql`
      UPDATE "escrows"
      SET "status" = 'refunded'::"EscrowStatus",
          "refundLedgerTransactionId" = ${ledgerTransaction.id},
          "refundedAt" = ${settledAt}
      WHERE "id" = ${escrow.id}
    `,
  );
  await tx.$executeRaw(
    Prisma.sql`
      UPDATE "contracts"
      SET "lifecycleState" = 'closed'::"ContractLifecycleState",
          "closedAt" = ${settledAt}
      WHERE "id" = ${contract.id}
    `,
  );

  return {
    supplierDefault,
    defaultEvidence,
    settlement: await loadExistingSettlement(tx, contract.id),
    settlementEvidence,
    ledgerTransaction,
    replayed: false,
  };
}

export async function defaultAndRefundContract(prisma, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('PROTOCOL_CLIENT_INVALID', 'defaultAndRefundContract requires a PrismaClient');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('SUPPLIER_DEFAULT_INPUT_INVALID', 'Supplier Default input must be an object');
  }

  const normalized = {
    contractId: nonEmpty(input.contractId, 'contractId'),
    idempotencyKey: nonEmpty(input.idempotencyKey, 'idempotencyKey'),
  };
  const now = asDate(options.now ?? new Date(), 'now');
  const maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0
    ? options.maxRetries
    : 3;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => performDefaultRefund(tx, normalized, now),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof SupplierDefaultRefundError) throw error;
      if (isSerializationFailure(error) && attempt < maxRetries) continue;
      if (isSerializationFailure(error)) {
        deny(
          'SUPPLIER_DEFAULT_CONCURRENCY_RETRY_EXHAUSTED',
          'Supplier Default refund concurrency retries exhausted',
          { contractId: normalized.contractId },
        );
      }
      throw error;
    }
  }

  deny('SUPPLIER_DEFAULT_REFUND_FAILED', 'Supplier Default refund failed unexpectedly');
}
