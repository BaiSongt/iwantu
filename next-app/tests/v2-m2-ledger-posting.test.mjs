import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  LedgerPostingError,
  buildLedgerPostingHash,
  normalizeLedgerAmount,
  postLedgerTransaction,
} from '../src/lib/ledger/ledger-posting.mjs';

const prisma = new PrismaClient();

before(async () => {
  await prisma.$connect();
});

after(async () => {
  await prisma.$disconnect();
});

function unique(label) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let hashIndex = 0;
function nextHash() {
  const chars = '0123456789abcdef';
  const pair = `${chars[hashIndex % 16]}${chars[(hashIndex + 7) % 16]}`;
  hashIndex += 1;
  return pair.repeat(32);
}

async function createPrincipalAccounts(label) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `Posting Org ${suffix}`, type: 'buyer' },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const available = await prisma.ledgerAccount.create({
    data: { principalId: principal.id, type: 'principal_available' },
  });
  const locked = await prisma.ledgerAccount.create({
    data: { principalId: principal.id, type: 'principal_locked' },
  });
  return { suffix, organization, principal, available, locked };
}

async function getSystemAccount(type) {
  const existing = await prisma.ledgerAccount.findFirst({
    where: { principalId: null, type, currency: 'IWC' },
  });
  if (existing) return existing;
  try {
    return await prisma.ledgerAccount.create({ data: { type, currency: 'IWC' } });
  } catch (error) {
    const raced = await prisma.ledgerAccount.findFirst({
      where: { principalId: null, type, currency: 'IWC' },
    });
    if (raced) return raced;
    throw error;
  }
}

function postingInput(label, debitAccountId, creditAccountId, amount = '10') {
  const reference = unique(label);
  return {
    type: 'genesis',
    referenceType: 'm2_posting_test',
    referenceId: reference,
    idempotencyKey: `ledger:${reference}`,
    metadata: { reason: label, nested: { b: 2, a: 1 } },
    entries: [
      {
        accountId: debitAccountId,
        side: 'debit',
        amount,
        provenance: { source: 'test', class: 'genesis' },
      },
      {
        accountId: creditAccountId,
        side: 'credit',
        amount,
        provenance: { class: 'genesis', source: 'test' },
      },
    ],
  };
}

function assertLedgerError(error, code) {
  assert.ok(error instanceof LedgerPostingError);
  assert.equal(error.code, code);
  return true;
}

async function directPostedTransaction({ type, idempotencyKey, debitAccountId, creditAccountId, amount, transactionHash }) {
  const referenceId = unique('direct');
  const transaction = await prisma.ledgerTransaction.create({
    data: {
      type,
      referenceType: 'direct_test_fixture',
      referenceId,
      idempotencyKey,
    },
  });
  await prisma.ledgerEntry.createMany({
    data: [
      {
        transactionId: transaction.id,
        entryIndex: 0,
        accountId: debitAccountId,
        side: 'debit',
        amount,
      },
      {
        transactionId: transaction.id,
        entryIndex: 1,
        accountId: creditAccountId,
        side: 'credit',
        amount,
      },
    ],
  });
  return prisma.ledgerTransaction.update({
    where: { id: transaction.id },
    data: {
      status: 'posted',
      postedAt: new Date(),
      transactionHash,
    },
  });
}

test('M2-02: decimal normalization and canonical hashing are deterministic', async () => {
  assert.deepEqual(normalizeLedgerAmount('10.5'), {
    decimal: '10.50000000',
    minorUnits: 1_050_000_000n,
  });

  const fixture = await createPrincipalAccounts('canonical');
  const reserve = await getSystemAccount('system_reserve');
  const first = postingInput('canonical-hash', reserve.id, fixture.available.id, '10.0');
  const second = {
    ...first,
    metadata: { nested: { a: 1, b: 2 }, reason: 'canonical-hash' },
    entries: [
      {
        provenance: { class: 'genesis', source: 'test' },
        amount: '10.00000000',
        side: 'debit',
        accountId: reserve.id,
      },
      {
        sourceIgnored: undefined,
        accountId: fixture.available.id,
        side: 'credit',
        amount: '10.00000000',
        provenance: { source: 'test', class: 'genesis' },
      },
    ],
  };
  delete second.entries[1].sourceIgnored;

  assert.equal(buildLedgerPostingHash(first), buildLedgerPostingHash(second));
});

test('M2-02: balanced posting commits transaction and entries atomically with deterministic evidence hash', async () => {
  const fixture = await createPrincipalAccounts('post');
  const reserve = await getSystemAccount('system_reserve');
  const input = postingInput('post', reserve.id, fixture.available.id, '25.125');
  const expectedHash = buildLedgerPostingHash(input);

  const posted = await postLedgerTransaction(prisma, input);

  assert.equal(posted.status, 'posted');
  assert.equal(posted.transactionHash, expectedHash);
  assert.ok(posted.postedAt);
  assert.equal(posted.entries.length, 2);
  assert.equal(posted.entries[0].entryIndex, 0);
  assert.equal(posted.entries[0].amount.toString(), '25.125');
});

test('M2-02: exact idempotent retry returns original economic result without duplicate entries', async () => {
  const fixture = await createPrincipalAccounts('retry');
  const reserve = await getSystemAccount('system_reserve');
  const input = postingInput('retry', reserve.id, fixture.available.id, '4');

  const first = await postLedgerTransaction(prisma, input);
  const second = await postLedgerTransaction(prisma, {
    ...input,
    metadata: { nested: { a: 1, b: 2 }, reason: 'retry' },
    entries: input.entries.map((entry) => ({ ...entry, amount: '4.00000000' })),
  });

  assert.equal(second.id, first.id);
  assert.equal(second.transactionHash, first.transactionHash);
  assert.equal(
    await prisma.ledgerTransaction.count({ where: { idempotencyKey: input.idempotencyKey } }),
    1,
  );
  assert.equal(
    await prisma.ledgerEntry.count({ where: { transactionId: first.id } }),
    2,
  );
});

test('M2-02: same idempotency key with different canonical evidence fails closed', async () => {
  const fixture = await createPrincipalAccounts('conflict');
  const reserve = await getSystemAccount('system_reserve');
  const input = postingInput('conflict', reserve.id, fixture.available.id, '5');
  const first = await postLedgerTransaction(prisma, input);

  await assert.rejects(
    postLedgerTransaction(prisma, {
      ...input,
      entries: input.entries.map((entry) => ({ ...entry, amount: '6' })),
    }),
    (error) => assertLedgerError(error, 'IDEMPOTENCY_CONFLICT'),
  );

  assert.equal(
    await prisma.ledgerTransaction.count({ where: { idempotencyKey: input.idempotencyKey } }),
    1,
  );
  assert.equal((await prisma.ledgerTransaction.findUnique({ where: { id: first.id } }))?.status, 'posted');
});

test('M2-02: unbalanced request fails before any economic write', async () => {
  const fixture = await createPrincipalAccounts('unbalanced');
  const reserve = await getSystemAccount('system_reserve');
  const input = postingInput('unbalanced', reserve.id, fixture.available.id, '9');
  input.entries[1].amount = '8';

  await assert.rejects(
    postLedgerTransaction(prisma, input),
    (error) => assertLedgerError(error, 'LEDGER_UNBALANCED'),
  );
  assert.equal(
    await prisma.ledgerTransaction.count({ where: { idempotencyKey: input.idempotencyKey } }),
    0,
  );
});

test('M2-02: inactive account fails closed and leaves no draft transaction', async () => {
  const fixture = await createPrincipalAccounts('inactive');
  const reserve = await getSystemAccount('system_reserve');
  await prisma.ledgerAccount.update({
    where: { id: fixture.available.id },
    data: { status: 'frozen' },
  });
  const input = postingInput('inactive', reserve.id, fixture.available.id, '3');

  await assert.rejects(
    postLedgerTransaction(prisma, input),
    (error) => assertLedgerError(error, 'LEDGER_ACCOUNT_INACTIVE'),
  );
  assert.equal(
    await prisma.ledgerTransaction.count({ where: { idempotencyKey: input.idempotencyKey } }),
    0,
  );
});

test('M2-02: concurrent identical retries converge to exactly one posted transaction', async () => {
  const fixture = await createPrincipalAccounts('concurrent');
  const reserve = await getSystemAccount('system_reserve');
  const input = postingInput('concurrent', reserve.id, fixture.available.id, '7');

  const results = await Promise.all([
    postLedgerTransaction(prisma, input),
    postLedgerTransaction(prisma, input),
    postLedgerTransaction(prisma, input),
  ]);

  assert.equal(new Set(results.map((result) => result.id)).size, 1);
  assert.equal(
    await prisma.ledgerTransaction.count({ where: { idempotencyKey: input.idempotencyKey } }),
    1,
  );
  assert.equal(
    await prisma.ledgerEntry.count({ where: { transactionId: results[0].id } }),
    2,
  );
});

test('M2-02: database failure during finalization rolls back draft transaction and partial entries', async () => {
  const fixture = await createPrincipalAccounts('rollback');
  const reserve = await getSystemAccount('system_reserve');
  const input = postingInput('rollback', reserve.id, fixture.available.id, '11');
  const targetHash = buildLedgerPostingHash(input);

  await directPostedTransaction({
    type: 'reserve',
    idempotencyKey: `fixture:${unique('hash-collision')}`,
    debitAccountId: reserve.id,
    creditAccountId: fixture.available.id,
    amount: '11',
    transactionHash: targetHash,
  });

  await assert.rejects(
    postLedgerTransaction(prisma, input),
    (error) => assertLedgerError(error, 'LEDGER_TRANSACTION_HASH_CONFLICT'),
  );

  assert.equal(
    await prisma.ledgerTransaction.count({ where: { idempotencyKey: input.idempotencyKey } }),
    0,
  );
  const partialEntries = await prisma.ledgerEntry.findMany({
    where: { transaction: { idempotencyKey: input.idempotencyKey } },
  });
  assert.equal(partialEntries.length, 0);
});

test('M2-02: idempotency lookup rejects stored transaction whose hash is not its canonical evidence', async () => {
  const fixture = await createPrincipalAccounts('tampered-hash');
  const reserve = await getSystemAccount('system_reserve');
  const input = postingInput('tampered-hash', reserve.id, fixture.available.id, '2');

  await directPostedTransaction({
    type: input.type,
    idempotencyKey: input.idempotencyKey,
    debitAccountId: reserve.id,
    creditAccountId: fixture.available.id,
    amount: '2',
    transactionHash: nextHash(),
  });

  await assert.rejects(
    postLedgerTransaction(prisma, input),
    (error) => assertLedgerError(error, 'LEDGER_EVIDENCE_HASH_MISMATCH'),
  );
});