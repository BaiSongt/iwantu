import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

const POSTING_PROTOCOL_VERSION = 'iwantu-ledger-posting/0.1';
const SCALE = 100_000_000n;
const MAX_INTEGER_DIGITS = 28;
const MAX_FRACTION_DIGITS = 8;
const LEDGER_CHAIN_ADVISORY_LOCK_KEY = 4_921_178_337;
const TRANSACTION_TYPES = new Set([
  'genesis',
  'purchased_credit',
  'contract_escrow',
  'settlement',
  'refund',
  'protocol_fee',
  'incentive',
  'penalty',
  'reserve',
]);
const ENTRY_SIDES = new Set(['debit', 'credit']);
const NO_OVERDRAFT_ACCOUNT_TYPES = new Set([
  'principal_available',
  'principal_locked',
  'principal_pending',
  'system_clearing',
  'system_fee',
  'system_incentive',
]);

export class LedgerPostingError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'LedgerPostingError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new LedgerPostingError(code, message, details);
}

function normalizeNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('LEDGER_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function normalizeJsonValue(value, field = 'json') {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      deny('LEDGER_INPUT_INVALID', `${field} contains a non-finite number`, { field });
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeJsonValue(item, `${field}[${index}]`));
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeJsonValue(value[key], `${field}.${key}`)]),
    );
  }
  deny('LEDGER_INPUT_INVALID', `${field} must be JSON-compatible`, { field });
}

function canonicalize(value) {
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

export function canonicalLedgerJson(value) {
  return JSON.stringify(canonicalize(value));
}

function amountInputToString(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  deny('LEDGER_AMOUNT_INVALID', 'Ledger entry amount must be a decimal string or finite number');
}

function decimalValueToMinorUnits(value) {
  const raw = String(value);
  const match = raw.match(/^(-?)(\d+)(?:\.(\d{1,8}))?$/);
  if (!match) {
    deny('LEDGER_BALANCE_INVALID', 'Stored ledger balance is not a supported decimal value', { value: raw });
  }
  const fraction = (match[3] ?? '').padEnd(MAX_FRACTION_DIGITS, '0');
  const units = BigInt(match[2]) * SCALE + BigInt(fraction);
  return match[1] === '-' ? -units : units;
}

export function normalizeLedgerAmount(value) {
  const raw = amountInputToString(value);
  const match = raw.match(new RegExp(`^(0|[1-9]\\d{0,${MAX_INTEGER_DIGITS - 1}})(?:\\.(\\d{1,${MAX_FRACTION_DIGITS}}))?$`));
  if (!match) {
    deny(
      'LEDGER_AMOUNT_INVALID',
      `Ledger entry amount must have at most ${MAX_INTEGER_DIGITS} integer digits and ${MAX_FRACTION_DIGITS} fractional digits`,
      { value: raw },
    );
  }

  const integer = match[1];
  const fraction = (match[2] ?? '').padEnd(MAX_FRACTION_DIGITS, '0');
  const minorUnits = BigInt(integer) * SCALE + BigInt(fraction);
  if (minorUnits <= 0n) {
    deny('LEDGER_AMOUNT_INVALID', 'Ledger entry amount must be positive', { value: raw });
  }

  return {
    decimal: `${integer}.${fraction}`,
    minorUnits,
  };
}

export function normalizeLedgerPostingInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('LEDGER_INPUT_INVALID', 'Ledger posting input must be an object');
  }

  const type = normalizeNonEmptyString(input.type, 'type');
  if (!TRANSACTION_TYPES.has(type)) {
    deny('LEDGER_TRANSACTION_TYPE_INVALID', 'Unsupported ledger transaction type', { type });
  }

  if (!Array.isArray(input.entries) || input.entries.length < 2) {
    deny('LEDGER_ENTRIES_INVALID', 'Ledger posting requires at least two entries');
  }

  let debitMinorUnits = 0n;
  let creditMinorUnits = 0n;
  const entries = input.entries.map((entry, entryIndex) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      deny('LEDGER_ENTRY_INVALID', 'Ledger entry must be an object', { entryIndex });
    }
    const accountId = normalizeNonEmptyString(entry.accountId, `entries[${entryIndex}].accountId`);
    const side = normalizeNonEmptyString(entry.side, `entries[${entryIndex}].side`);
    if (!ENTRY_SIDES.has(side)) {
      deny('LEDGER_ENTRY_SIDE_INVALID', 'Ledger entry side must be debit or credit', {
        entryIndex,
        side,
      });
    }
    const amount = normalizeLedgerAmount(entry.amount);
    if (side === 'debit') debitMinorUnits += amount.minorUnits;
    else creditMinorUnits += amount.minorUnits;

    return {
      entryIndex,
      accountId,
      side,
      amount: amount.decimal,
      amountMinorUnits: amount.minorUnits,
      provenance: normalizeJsonValue(entry.provenance ?? null, `entries[${entryIndex}].provenance`),
    };
  });

  if (debitMinorUnits !== creditMinorUnits) {
    deny('LEDGER_UNBALANCED', 'Ledger posting debit and credit totals must match', {
      debitMinorUnits: debitMinorUnits.toString(),
      creditMinorUnits: creditMinorUnits.toString(),
    });
  }

  return {
    type,
    referenceType: normalizeNonEmptyString(input.referenceType, 'referenceType'),
    referenceId: normalizeNonEmptyString(input.referenceId, 'referenceId'),
    idempotencyKey: normalizeNonEmptyString(input.idempotencyKey, 'idempotencyKey'),
    metadata: normalizeJsonValue(input.metadata ?? null, 'metadata'),
    entries,
  };
}

export function buildLedgerPostingEvidence(normalizedInput) {
  return {
    protocolVersion: POSTING_PROTOCOL_VERSION,
    type: normalizedInput.type,
    referenceType: normalizedInput.referenceType,
    referenceId: normalizedInput.referenceId,
    idempotencyKey: normalizedInput.idempotencyKey,
    metadata: normalizedInput.metadata,
    entries: normalizedInput.entries.map((entry) => ({
      entryIndex: entry.entryIndex,
      accountId: entry.accountId,
      side: entry.side,
      amount: entry.amount,
      provenance: entry.provenance,
    })),
  };
}

export function hashLedgerPostingEvidence(evidence) {
  return createHash('sha256').update(canonicalLedgerJson(evidence), 'utf8').digest('hex');
}

export function buildLedgerPostingHash(input) {
  const normalized = normalizeLedgerPostingInput(input);
  return hashLedgerPostingEvidence(buildLedgerPostingEvidence(normalized));
}

function transactionAsPostingInput(transaction) {
  return {
    type: transaction.type,
    referenceType: transaction.referenceType,
    referenceId: transaction.referenceId,
    idempotencyKey: transaction.idempotencyKey,
    metadata: transaction.metadata ?? null,
    entries: transaction.entries
      .slice()
      .sort((left, right) => left.entryIndex - right.entryIndex)
      .map((entry) => ({
        accountId: entry.accountId,
        side: entry.side,
        amount: entry.amount.toString(),
        provenance: entry.provenance ?? null,
      })),
  };
}

async function loadTransactionByIdempotency(client, idempotencyKey) {
  return client.ledgerTransaction.findUnique({
    where: { idempotencyKey },
    include: { entries: { orderBy: { entryIndex: 'asc' } } },
  });
}

function verifyExistingTransaction(existing, expectedHash) {
  if (existing.status !== 'posted' || !existing.transactionHash) {
    deny(
      'IDEMPOTENCY_INCOMPLETE',
      'Idempotency key already belongs to a non-posted ledger transaction',
      { idempotencyKey: existing.idempotencyKey, transactionId: existing.id },
    );
  }

  const storedNormalized = normalizeLedgerPostingInput(transactionAsPostingInput(existing));
  const storedHash = hashLedgerPostingEvidence(buildLedgerPostingEvidence(storedNormalized));
  if (storedHash !== existing.transactionHash) {
    deny(
      'LEDGER_EVIDENCE_HASH_MISMATCH',
      'Stored ledger transaction hash does not match its canonical economic evidence',
      { transactionId: existing.id },
    );
  }
  if (storedHash !== expectedHash) {
    deny(
      'IDEMPOTENCY_CONFLICT',
      'Idempotency key was already used for different economic evidence',
      { idempotencyKey: existing.idempotencyKey, transactionId: existing.id },
    );
  }
  return existing;
}

async function acquireLedgerChainLock(tx) {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(${LEDGER_CHAIN_ADVISORY_LOCK_KEY}::bigint)`,
  );
}

async function loadLedgerChainHead(tx) {
  return tx.ledgerTransaction.findFirst({
    where: { status: 'posted', transactionHash: { not: null } },
    orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
    select: { transactionHash: true },
  });
}

async function lockAndValidateAccounts(tx, normalized) {
  const accountIds = [...new Set(normalized.entries.map((entry) => entry.accountId))].sort();
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT "id", "status", "currency", "type"
      FROM "ledger_accounts"
      WHERE "id" IN (${Prisma.join(accountIds)})
      ORDER BY "id"
      FOR UPDATE
    `,
  );

  if (rows.length !== accountIds.length) {
    const found = new Set(rows.map((row) => row.id));
    deny('LEDGER_ACCOUNT_NOT_FOUND', 'One or more ledger accounts do not exist', {
      accountIds: accountIds.filter((id) => !found.has(id)),
    });
  }

  const rowById = new Map(rows.map((row) => [row.id, row]));
  for (const row of rows) {
    if (row.currency !== 'IWC') {
      deny('LEDGER_ACCOUNT_CURRENCY_INVALID', 'Ledger posting requires IWC accounts', {
        accountId: row.id,
        currency: row.currency,
      });
    }
    if (row.status !== 'active') {
      deny('LEDGER_ACCOUNT_INACTIVE', 'Ledger posting requires active accounts', {
        accountId: row.id,
        status: row.status,
      });
    }
  }

  const balances = await tx.$queryRaw(
    Prisma.sql`
      SELECT
        a."id" AS "accountId",
        COALESCE(sum(CASE
          WHEN t."status" = 'posted' AND e."side" = 'credit' THEN e."amount"
          WHEN t."status" = 'posted' AND e."side" = 'debit' THEN -e."amount"
          ELSE 0
        END), 0)::DECIMAL(36,8) AS "balance"
      FROM "ledger_accounts" a
      LEFT JOIN "ledger_entries" e ON e."accountId" = a."id"
      LEFT JOIN "ledger_transactions" t ON t."id" = e."transactionId"
      WHERE a."id" IN (${Prisma.join(accountIds)})
      GROUP BY a."id"
    `,
  );
  const balanceById = new Map(
    balances.map((row) => [row.accountId, decimalValueToMinorUnits(row.balance)]),
  );

  const deltaById = new Map(accountIds.map((accountId) => [accountId, 0n]));
  for (const entry of normalized.entries) {
    const sign = entry.side === 'credit' ? 1n : -1n;
    deltaById.set(entry.accountId, deltaById.get(entry.accountId) + sign * entry.amountMinorUnits);
  }

  for (const accountId of accountIds) {
    const account = rowById.get(accountId);
    if (!NO_OVERDRAFT_ACCOUNT_TYPES.has(account.type)) continue;
    const before = balanceById.get(accountId) ?? 0n;
    const after = before + (deltaById.get(accountId) ?? 0n);
    if (after < 0n) {
      deny('LEDGER_ACCOUNT_OVERDRAFT', 'Ledger posting would overdraw a protected account', {
        accountId,
        accountType: account.type,
        balanceMinorUnits: before.toString(),
        deltaMinorUnits: (deltaById.get(accountId) ?? 0n).toString(),
      });
    }
  }
}

async function postNormalizedWithinTransaction(tx, normalized, expectedHash) {
  const existingBeforeLock = await loadTransactionByIdempotency(tx, normalized.idempotencyKey);
  if (existingBeforeLock) return verifyExistingTransaction(existingBeforeLock, expectedHash);

  await acquireLedgerChainLock(tx);

  const existing = await loadTransactionByIdempotency(tx, normalized.idempotencyKey);
  if (existing) return verifyExistingTransaction(existing, expectedHash);

  await lockAndValidateAccounts(tx, normalized);
  const chainHead = await loadLedgerChainHead(tx);
  const previousHash = chainHead?.transactionHash ?? null;

  const transaction = await tx.ledgerTransaction.create({
    data: {
      type: normalized.type,
      referenceType: normalized.referenceType,
      referenceId: normalized.referenceId,
      idempotencyKey: normalized.idempotencyKey,
      previousHash,
      ...(normalized.metadata === null ? {} : { metadata: normalized.metadata }),
    },
  });

  await tx.ledgerEntry.createMany({
    data: normalized.entries.map((entry) => ({
      transactionId: transaction.id,
      entryIndex: entry.entryIndex,
      accountId: entry.accountId,
      side: entry.side,
      amount: entry.amount,
      ...(entry.provenance === null ? {} : { provenance: entry.provenance }),
    })),
  });

  await tx.ledgerTransaction.update({
    where: { id: transaction.id },
    data: {
      status: 'posted',
      postedAt: new Date(),
      transactionHash: expectedHash,
    },
  });

  const posted = await tx.ledgerTransaction.findUnique({
    where: { id: transaction.id },
    include: { entries: { orderBy: { entryIndex: 'asc' } } },
  });
  if (!posted) {
    deny('LEDGER_POSTING_FAILED', 'Posted ledger transaction could not be reloaded');
  }
  return posted;
}

function isPrismaCode(error, code) {
  return Boolean(error && typeof error === 'object' && error.code === code);
}

export async function postLedgerTransactionInTransaction(tx, input) {
  if (!tx || typeof tx.$queryRaw !== 'function' || !tx.ledgerTransaction) {
    deny('LEDGER_TRANSACTION_CLIENT_INVALID', 'A Prisma transaction client is required');
  }
  const normalized = normalizeLedgerPostingInput(input);
  const expectedHash = hashLedgerPostingEvidence(buildLedgerPostingEvidence(normalized));
  return postNormalizedWithinTransaction(tx, normalized, expectedHash);
}

export async function postLedgerTransaction(prisma, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('LEDGER_CLIENT_INVALID', 'postLedgerTransaction requires a PrismaClient');
  }

  const normalized = normalizeLedgerPostingInput(input);
  const expectedHash = hashLedgerPostingEvidence(buildLedgerPostingEvidence(normalized));
  const maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0
    ? options.maxRetries
    : 5;

  const existing = await loadTransactionByIdempotency(prisma, normalized.idempotencyKey);
  if (existing) return verifyExistingTransaction(existing, expectedHash);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => postNormalizedWithinTransaction(tx, normalized, expectedHash),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof LedgerPostingError) throw error;

      const raced = await loadTransactionByIdempotency(prisma, normalized.idempotencyKey);
      if (raced) return verifyExistingTransaction(raced, expectedHash);

      if ((isPrismaCode(error, 'P2034') || isPrismaCode(error, 'P2002')) && attempt < maxRetries) {
        continue;
      }
      if (isPrismaCode(error, 'P2034')) {
        deny('LEDGER_CONCURRENCY_RETRY_EXHAUSTED', 'Ledger posting serialization retries exhausted', {
          idempotencyKey: normalized.idempotencyKey,
          attempts: maxRetries + 1,
        });
      }
      if (isPrismaCode(error, 'P2002')) {
        deny('LEDGER_TRANSACTION_HASH_CONFLICT', 'Ledger transaction unique evidence conflict', {
          idempotencyKey: normalized.idempotencyKey,
        });
      }
      throw error;
    }
  }

  deny('LEDGER_POSTING_FAILED', 'Ledger posting failed unexpectedly');
}
