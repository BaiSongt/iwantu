import { Prisma } from '@prisma/client';
import { buildCreditProvenance, ensurePrincipalLedgerAccounts } from './credit-foundation.mjs';
import {
  LedgerPostingError,
  normalizeLedgerAmount,
  postLedgerTransactionInTransaction,
} from './ledger-posting.mjs';

export class EscrowPrimitiveError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'EscrowPrimitiveError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new EscrowPrimitiveError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('ESCROW_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function optionalString(value, field) {
  if (value === undefined || value === null) return undefined;
  return nonEmpty(value, field);
}

function isPrismaCode(error, code) {
  return Boolean(error && typeof error === 'object' && error.code === code);
}

async function requireActivePrincipal(tx, principalId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT "id", "status"
      FROM "principals"
      WHERE "id" = ${principalId}
      FOR SHARE
    `,
  );
  const principal = rows[0];
  if (!principal) {
    deny('ESCROW_PRINCIPAL_NOT_FOUND', 'Principal does not exist', { principalId });
  }
  if (principal.status !== 'active') {
    deny('ESCROW_PRINCIPAL_INACTIVE', 'Escrow operation requires an active Principal', {
      principalId,
      status: principal.status,
    });
  }
  return principal;
}

async function requireAgentAttribution(tx, agentIdentityId, principalId) {
  if (!agentIdentityId) return;
  const agent = await tx.agentIdentity.findUnique({
    where: { id: agentIdentityId },
    select: { id: true, principalId: true },
  });
  if (!agent || agent.principalId !== principalId) {
    deny(
      'ESCROW_AGENT_ATTRIBUTION_INVALID',
      'earnedByAgentIdentityId must belong to the recipient Principal',
      { agentIdentityId, principalId },
    );
  }
}

async function loadEscrowForUpdate(tx, contractId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT
        e."id",
        e."contractId",
        e."buyerAccountId",
        e."amount"::text AS "amount",
        e."currency",
        e."status",
        e."lockLedgerTransactionId",
        e."releaseLedgerTransactionId",
        e."refundLedgerTransactionId",
        e."createdAt",
        e."releasedAt",
        e."refundedAt",
        a."principalId" AS "buyerPrincipalId"
      FROM "escrows" e
      JOIN "ledger_accounts" a ON a."id" = e."buyerAccountId"
      WHERE e."contractId" = ${contractId}
      FOR UPDATE OF e
    `,
  );
  return rows[0] ?? null;
}

async function loadPrincipalLockedAccount(tx, principalId) {
  const account = await tx.ledgerAccount.findFirst({
    where: {
      principalId,
      type: 'principal_locked',
      currency: 'IWC',
    },
  });
  if (!account) {
    deny('ESCROW_LOCKED_ACCOUNT_MISSING', 'Principal locked account does not exist', {
      principalId,
    });
  }
  return account;
}

async function lockAccountsForUpdate(tx, accountIds) {
  const ids = [...new Set(accountIds)].sort();
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT "id", "principalId", "type", "status", "currency"
      FROM "ledger_accounts"
      WHERE "id" IN (${Prisma.join(ids)})
      ORDER BY "id"
      FOR UPDATE
    `,
  );
  if (rows.length !== ids.length) {
    const found = new Set(rows.map((row) => row.id));
    deny('ESCROW_ACCOUNT_NOT_FOUND', 'One or more Escrow accounts do not exist', {
      accountIds: ids.filter((id) => !found.has(id)),
    });
  }
  for (const row of rows) {
    if (row.status !== 'active' || row.currency !== 'IWC') {
      deny('ESCROW_ACCOUNT_INACTIVE', 'Escrow movement requires active IWC accounts', {
        accountId: row.id,
        status: row.status,
        currency: row.currency,
      });
    }
  }
  return rows;
}

async function assertSufficientPostedBalance(tx, accountId, amountDecimal) {
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT
        COALESCE(SUM(
          CASE WHEN e."side" = 'credit' THEN e."amount" ELSE -e."amount" END
        ), 0)::text AS "balance",
        COALESCE(SUM(
          CASE WHEN e."side" = 'credit' THEN e."amount" ELSE -e."amount" END
        ), 0) >= CAST(${amountDecimal} AS DECIMAL(36,8)) AS "sufficient"
      FROM "ledger_entries" e
      JOIN "ledger_transactions" t ON t."id" = e."transactionId"
      WHERE e."accountId" = ${accountId}
        AND t."status" = 'posted'
    `,
  );
  const state = rows[0];
  if (!state?.sufficient) {
    deny('ESCROW_INSUFFICIENT_FUNDS', 'Ledger account has insufficient posted balance', {
      accountId,
      requiredAmount: amountDecimal,
      availableBalance: state?.balance ?? '0',
    });
  }
}

function normalizeEscrowAmount(value) {
  return normalizeLedgerAmount(value).decimal;
}

function normalizePersistedAmount(value) {
  return normalizeLedgerAmount(String(value)).decimal;
}

function lockPostingInput({ contractId, buyerPrincipalId, availableAccountId, lockedAccountId, amount, metadata }) {
  return {
    type: 'contract_escrow',
    referenceType: 'escrow_lock',
    referenceId: contractId,
    idempotencyKey: `escrow:lock:${contractId}`,
    metadata: {
      escrowAction: 'lock',
      contractId,
      buyerPrincipalId,
      details: metadata ?? null,
    },
    entries: [
      { accountId: availableAccountId, side: 'debit', amount },
      { accountId: lockedAccountId, side: 'credit', amount },
    ],
  };
}

function releasePostingInput({
  contractId,
  buyerPrincipalId,
  recipientPrincipalId,
  lockedAccountId,
  recipientAvailableAccountId,
  amount,
  earnedByAgentIdentityId,
  metadata,
}) {
  const provenance = buildCreditProvenance({
    kind: 'earned',
    beneficiaryPrincipalId: recipientPrincipalId,
    sourceReferenceType: 'escrow_release',
    sourceReferenceId: contractId,
    contractId,
    earnedByAgentIdentityId,
  });
  return {
    type: 'settlement',
    referenceType: 'escrow_release',
    referenceId: contractId,
    idempotencyKey: `escrow:release:${contractId}`,
    metadata: {
      escrowAction: 'release',
      contractId,
      buyerPrincipalId,
      recipientPrincipalId,
      details: metadata ?? null,
    },
    entries: [
      { accountId: lockedAccountId, side: 'debit', amount },
      {
        accountId: recipientAvailableAccountId,
        side: 'credit',
        amount,
        provenance,
      },
    ],
  };
}

function refundPostingInput({
  contractId,
  buyerPrincipalId,
  availableAccountId,
  lockedAccountId,
  amount,
  lockLedgerTransactionId,
  metadata,
}) {
  const provenance = buildCreditProvenance({
    kind: 'refund',
    beneficiaryPrincipalId: buyerPrincipalId,
    sourceReferenceType: 'escrow_refund',
    sourceReferenceId: contractId,
    originalLedgerTransactionId: lockLedgerTransactionId,
    contractId,
  });
  return {
    type: 'refund',
    referenceType: 'escrow_refund',
    referenceId: contractId,
    idempotencyKey: `escrow:refund:${contractId}`,
    metadata: {
      escrowAction: 'refund',
      contractId,
      buyerPrincipalId,
      details: metadata ?? null,
    },
    entries: [
      { accountId: lockedAccountId, side: 'debit', amount },
      { accountId: availableAccountId, side: 'credit', amount, provenance },
    ],
  };
}

async function runSerializable(prisma, work, options = {}) {
  const maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0
    ? options.maxRetries
    : 3;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (error instanceof EscrowPrimitiveError || error instanceof LedgerPostingError) throw error;
      if ((isPrismaCode(error, 'P2034') || isPrismaCode(error, 'P2002')) && attempt < maxRetries) {
        continue;
      }
      if (isPrismaCode(error, 'P2034')) {
        deny('ESCROW_CONCURRENCY_RETRY_EXHAUSTED', 'Escrow serialization retries exhausted');
      }
      throw error;
    }
  }
  deny('ESCROW_OPERATION_FAILED', 'Escrow operation failed unexpectedly');
}

function assertExistingLockIdentity(existing, expected) {
  if (
    existing.buyerPrincipalId !== expected.buyerPrincipalId
    || existing.buyerAccountId !== expected.availableAccountId
    || normalizePersistedAmount(existing.amount) !== expected.amount
    || existing.currency !== 'IWC'
  ) {
    deny('ESCROW_IDEMPOTENCY_CONFLICT', 'contractId already belongs to different Escrow evidence', {
      contractId: expected.contractId,
      escrowId: existing.id,
    });
  }
}

export async function lockEscrow(prisma, input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('ESCROW_INPUT_INVALID', 'Escrow lock input must be an object');
  }
  const contractId = nonEmpty(input.contractId, 'contractId');
  const buyerPrincipalId = nonEmpty(input.buyerPrincipalId, 'buyerPrincipalId');
  const amount = normalizeEscrowAmount(input.amount);
  const buyerAccounts = await ensurePrincipalLedgerAccounts(prisma, buyerPrincipalId);
  const availableAccount = buyerAccounts.principal_available;
  const lockedAccount = buyerAccounts.principal_locked;
  const postingInput = lockPostingInput({
    contractId,
    buyerPrincipalId,
    availableAccountId: availableAccount.id,
    lockedAccountId: lockedAccount.id,
    amount,
    metadata: input.metadata,
  });

  return runSerializable(prisma, async (tx) => {
    await requireActivePrincipal(tx, buyerPrincipalId);
    const existing = await loadEscrowForUpdate(tx, contractId);
    if (existing) {
      assertExistingLockIdentity(existing, {
        contractId,
        buyerPrincipalId,
        availableAccountId: availableAccount.id,
        amount,
      });
      const ledgerTransaction = await postLedgerTransactionInTransaction(tx, postingInput);
      const escrow = await tx.escrow.findUnique({ where: { id: existing.id } });
      return { escrow, ledgerTransaction };
    }

    await lockAccountsForUpdate(tx, [availableAccount.id, lockedAccount.id]);
    await assertSufficientPostedBalance(tx, availableAccount.id, amount);
    const ledgerTransaction = await postLedgerTransactionInTransaction(tx, postingInput);
    const escrow = await tx.escrow.create({
      data: {
        contractId,
        buyerAccountId: availableAccount.id,
        amount,
        currency: 'IWC',
        lockLedgerTransactionId: ledgerTransaction.id,
      },
    });
    return { escrow, ledgerTransaction };
  }, options);
}

export async function releaseEscrow(prisma, input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('ESCROW_INPUT_INVALID', 'Escrow release input must be an object');
  }
  const contractId = nonEmpty(input.contractId, 'contractId');
  const recipientPrincipalId = nonEmpty(input.recipientPrincipalId, 'recipientPrincipalId');
  const earnedByAgentIdentityId = optionalString(
    input.earnedByAgentIdentityId,
    'earnedByAgentIdentityId',
  );
  const recipientAccounts = await ensurePrincipalLedgerAccounts(prisma, recipientPrincipalId);

  return runSerializable(prisma, async (tx) => {
    await requireActivePrincipal(tx, recipientPrincipalId);
    await requireAgentAttribution(tx, earnedByAgentIdentityId, recipientPrincipalId);
    const existing = await loadEscrowForUpdate(tx, contractId);
    if (!existing) {
      deny('ESCROW_NOT_FOUND', 'Escrow does not exist', { contractId });
    }
    if (existing.status === 'refunded') {
      deny('ESCROW_TERMINAL_CONFLICT', 'Refunded Escrow cannot be released', { contractId });
    }

    const lockedAccount = await loadPrincipalLockedAccount(tx, existing.buyerPrincipalId);
    const amount = normalizePersistedAmount(existing.amount);
    const postingInput = releasePostingInput({
      contractId,
      buyerPrincipalId: existing.buyerPrincipalId,
      recipientPrincipalId,
      lockedAccountId: lockedAccount.id,
      recipientAvailableAccountId: recipientAccounts.principal_available.id,
      amount,
      earnedByAgentIdentityId,
      metadata: input.metadata,
    });

    if (existing.status === 'released') {
      const ledgerTransaction = await postLedgerTransactionInTransaction(tx, postingInput);
      const escrow = await tx.escrow.findUnique({ where: { id: existing.id } });
      return { escrow, ledgerTransaction };
    }

    await lockAccountsForUpdate(tx, [lockedAccount.id, recipientAccounts.principal_available.id]);
    await assertSufficientPostedBalance(tx, lockedAccount.id, amount);
    const ledgerTransaction = await postLedgerTransactionInTransaction(tx, postingInput);
    const escrow = await tx.escrow.update({
      where: { id: existing.id },
      data: {
        status: 'released',
        releaseLedgerTransactionId: ledgerTransaction.id,
        releasedAt: new Date(),
      },
    });
    return { escrow, ledgerTransaction };
  }, options);
}

export async function refundEscrow(prisma, input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('ESCROW_INPUT_INVALID', 'Escrow refund input must be an object');
  }
  const contractId = nonEmpty(input.contractId, 'contractId');

  return runSerializable(prisma, async (tx) => {
    const existing = await loadEscrowForUpdate(tx, contractId);
    if (!existing) {
      deny('ESCROW_NOT_FOUND', 'Escrow does not exist', { contractId });
    }
    if (existing.status === 'released') {
      deny('ESCROW_TERMINAL_CONFLICT', 'Released Escrow cannot be refunded', { contractId });
    }

    const lockedAccount = await loadPrincipalLockedAccount(tx, existing.buyerPrincipalId);
    const amount = normalizePersistedAmount(existing.amount);
    const postingInput = refundPostingInput({
      contractId,
      buyerPrincipalId: existing.buyerPrincipalId,
      availableAccountId: existing.buyerAccountId,
      lockedAccountId: lockedAccount.id,
      amount,
      lockLedgerTransactionId: existing.lockLedgerTransactionId,
      metadata: input.metadata,
    });

    if (existing.status === 'refunded') {
      const ledgerTransaction = await postLedgerTransactionInTransaction(tx, postingInput);
      const escrow = await tx.escrow.findUnique({ where: { id: existing.id } });
      return { escrow, ledgerTransaction };
    }

    await lockAccountsForUpdate(tx, [existing.buyerAccountId, lockedAccount.id]);
    await assertSufficientPostedBalance(tx, lockedAccount.id, amount);
    const ledgerTransaction = await postLedgerTransactionInTransaction(tx, postingInput);
    const escrow = await tx.escrow.update({
      where: { id: existing.id },
      data: {
        status: 'refunded',
        refundLedgerTransactionId: ledgerTransaction.id,
        refundedAt: new Date(),
      },
    });
    return { escrow, ledgerTransaction };
  }, options);
}
