import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

const POSTING_PROTOCOL_VERSION = 'iwantu-ledger-posting/0.1';
const SCALE = 100_000_000n;
const MAX_INTEGER_DIGITS = 28;
const MAX_FRACTION_DIGITS = 8;
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

async function lockAndValidateAccounts(tx, normalized) {
  const accountIds = [...new Set(normalized.entries.map((entry) => entry.accountId))].sort();
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT "id", "status", "currency"
      FROM "ledger_accounts"
      WHERE "id" IN (${Prisma.join(accountIds)})
      ORDER BY "id"
      FOR SHARE
    `,
  );

  if (rows.length !== accountIds.length) {
    const found = new Set(rows.map((row) => row.id));
    deny('LEDGER_ACCOUNT_NOT_FOUND', 'One or more ledger accounts do not exist', {
      accountIds: accountIds.filter((id) => !found.has(id)),
    });
  }

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
}

async function attemptAtomicPosting(prisma, normalized, expectedHash) {
  return prisma.$transaction(
    async (tx) => {
      const existing = await loadTransactionByIdempotency(tx, normalized.idempotencyKey);
      if (existing) return verifyExistingTransaction(existing, expectedHash);

      await lockAndValidateAccounts(tx, normalized);

      const transaction = await tx.ledgerTransaction.create({
        data: {
          type: normalized.type,
          referenceType: normalized.referenceType,
          referenceId: normalized.referenceId,
          idempotencyKey: normalized.idempotencyKey,
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

      // previousHash intentionally remains null in M2-02. A global hash-chain head
      // requires serialized concurrent posting and belongs to the M2-05 integrity gate.
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
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function isPrismaCode(error, code) {
  return Boolean(error && typeof error === 'object' && error.code === code);
}

/**
 * Canonical write path for future v2 economic events.
 *
 * All transaction and entry writes occur inside one serializable database
 * transaction. Validation failures and database failures therefore leave no
 * draft transaction or partial journal behind. A repeated idempotency key with
 * identical canonical evidence returns the original posted transaction; the
 * same key with different evidence fails closed.
 */
export async function postLedgerTransaction(prisma, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('LEDGER_CLIENT_INVALID', 'postLedgerTransaction requires a PrismaClient');
  }

  const normalized = normalizeLedgerPostingInput(input);
  const expectedHash = hashLedgerPostingEvidence(buildLedgerPostingEvidence(normalized));
  const maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0
    ? options.maxRetries
    : 3;

  const existing = await loadTransactionByIdempotency(prisma, normalized.idempotencyKey);
  if (existing) return verifyExistingTransaction(existing, expectedHash);

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await attemptAtomicPosting(prisma, normalized, expectedHash);
    } catch (error) {
      if (error instanceof LedgerPostingError) throw error;

      const raced = await loadTransactionByIdempotency(prisma, normalized.idempotencyKey);
      if (raced) return verifyExistingTransaction(raced, expectedHash);

      if (isPrismaCode(error, 'P2034') && attempt < maxRetries) continue;
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
