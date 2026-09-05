import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';

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
  const pair = `${chars[hashIndex % 16]}${chars[(hashIndex + 11) % 16]}`;
  hashIndex += 1;
  return pair.repeat(32);
}

async function createPrincipalFixture(label) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `Ledger Org ${suffix}`, type: 'buyer' },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const available = await prisma.ledgerAccount.create({
    data: {
      principalId: principal.id,
      type: 'principal_available',
    },
  });
  const locked = await prisma.ledgerAccount.create({
    data: {
      principalId: principal.id,
      type: 'principal_locked',
    },
  });
  return { suffix, organization, principal, available, locked };
}

async function getSystemAccount(type) {
  const existing = await prisma.ledgerAccount.findFirst({
    where: { principalId: null, type, currency: 'IWC' },
  });
  if (existing) return existing;

  try {
    return await prisma.ledgerAccount.create({
      data: { type, currency: 'IWC' },
    });
  } catch (error) {
    const raced = await prisma.ledgerAccount.findFirst({
      where: { principalId: null, type, currency: 'IWC' },
    });
    if (raced) return raced;
    throw error;
  }
}

async function createDraftTransaction(
  type,
  label,
  metadata = undefined,
  referenceType = 'invariant_test',
  referenceId = undefined,
) {
  const suffix = unique(label);
  return prisma.ledgerTransaction.create({
    data: {
      type,
      referenceType,
      referenceId: referenceId ?? suffix,
      idempotencyKey: `idem:${suffix}`,
      ...(metadata === undefined ? {} : { metadata }),
    },
  });
}

async function appendEntry(transactionId, entryIndex, accountId, side, amount) {
  return prisma.ledgerEntry.create({
    data: {
      transactionId,
      entryIndex,
      accountId,
      side,
      amount,
    },
  });
}

async function postTransaction(transactionId, transactionHash = nextHash()) {
  return prisma.ledgerTransaction.update({
    where: { id: transactionId },
    data: {
      status: 'posted',
      postedAt: new Date(),
      transactionHash,
    },
  });
}

async function createBalancedPostedTransaction(
  type,
  label,
  debitAccountId,
  creditAccountId,
  amount = '10.00000000',
  referenceType = 'invariant_test',
  referenceId = undefined,
) {
  const transaction = await createDraftTransaction(
    type,
    label,
    undefined,
    referenceType,
    referenceId,
  );
  const debit = await appendEntry(transaction.id, 0, debitAccountId, 'debit', amount);
  const credit = await appendEntry(transaction.id, 1, creditAccountId, 'credit', amount);
  const posted = await postTransaction(transaction.id);
  return { transaction: posted, debit, credit };
}

test('M2-01: schema uses journal models and does not add a mutable Principal balance source of truth', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const principal = schema.match(/model Principal \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const account = schema.match(/model LedgerAccount \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const transaction = schema.match(/model LedgerTransaction \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const entry = schema.match(/model LedgerEntry \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const escrow = schema.match(/model Escrow \{([\s\S]*?)\n\}/)?.[1] ?? '';

  assert.doesNotMatch(principal, /\bbalance\b/i);
  assert.doesNotMatch(account, /\bbalance\b/i);
  assert.match(transaction, /idempotencyKey/);
  assert.match(transaction, /status\s+LedgerTransactionStatus/);
  assert.match(entry, /side\s+LedgerEntrySide/);
  assert.match(entry, /amount\s+Decimal/);
  assert.match(escrow, /lockLedgerTransactionId/);
});

test('M2-01: account ownership shape distinguishes Principal accounts from system accounts', async () => {
  const fixture = await createPrincipalFixture('account-shape');
  assert.equal(fixture.available.principalId, fixture.principal.id);

  const reserve = await getSystemAccount('system_reserve');
  assert.equal(reserve.principalId, null);

  await assert.rejects(
    prisma.ledgerAccount.create({
      data: { type: 'principal_available' },
    }),
  );

  await assert.rejects(
    prisma.ledgerAccount.create({
      data: {
        principalId: fixture.principal.id,
        type: 'system_clearing',
      },
    }),
  );

  await assert.rejects(
    prisma.ledgerAccount.create({
      data: {
        principalId: fixture.principal.id,
        type: 'principal_pending',
        currency: 'USD',
      },
    }),
  );
});

test('M2-01: idempotency key is unique and draft transaction identity is immutable', async () => {
  const transaction = await createDraftTransaction('genesis', 'idempotency', { source: 'test' });

  await assert.rejects(
    prisma.ledgerTransaction.create({
      data: {
        type: 'genesis',
        referenceType: 'invariant_test',
        referenceId: unique('duplicate-idem'),
        idempotencyKey: transaction.idempotencyKey,
      },
    }),
  );

  await assert.rejects(
    prisma.ledgerTransaction.update({
      where: { id: transaction.id },
      data: { metadata: { source: 'mutated' } },
    }),
  );
});

test('M2-01: entries must be positive and can only be appended to draft transactions', async () => {
  const fixture = await createPrincipalFixture('positive-entry');
  const clearing = await getSystemAccount('system_clearing');
  const transaction = await createDraftTransaction('genesis', 'positive-entry');

  await assert.rejects(
    appendEntry(transaction.id, 0, fixture.available.id, 'debit', '0'),
  );
  await assert.rejects(
    appendEntry(transaction.id, 0, fixture.available.id, 'debit', '-1'),
  );

  await appendEntry(transaction.id, 0, fixture.available.id, 'debit', '5');
  await appendEntry(transaction.id, 1, clearing.id, 'credit', '5');
  await postTransaction(transaction.id);

  await assert.rejects(
    appendEntry(transaction.id, 2, fixture.available.id, 'debit', '1'),
  );
});

test('M2-01: database rejects posting with fewer than two entries or unequal debit and credit totals', async () => {
  const fixture = await createPrincipalFixture('balance-reject');
  const clearing = await getSystemAccount('system_clearing');

  const single = await createDraftTransaction('genesis', 'single-entry');
  await appendEntry(single.id, 0, fixture.available.id, 'debit', '5');
  await assert.rejects(postTransaction(single.id));

  const unbalanced = await createDraftTransaction('genesis', 'unbalanced');
  await appendEntry(unbalanced.id, 0, fixture.available.id, 'debit', '10');
  await appendEntry(unbalanced.id, 1, clearing.id, 'credit', '9');
  await assert.rejects(postTransaction(unbalanced.id));

  const persisted = await prisma.ledgerTransaction.findUnique({ where: { id: unbalanced.id } });
  assert.equal(persisted?.status, 'draft');
  assert.equal(persisted?.transactionHash, null);
});

test('M2-01: balanced transaction posts exactly once and becomes immutable with its entries', async () => {
  const fixture = await createPrincipalFixture('post-once');
  const reserve = await getSystemAccount('system_reserve');
  const { transaction, debit } = await createBalancedPostedTransaction(
    'genesis',
    'post-once',
    reserve.id,
    fixture.available.id,
    '25',
  );

  assert.equal(transaction.status, 'posted');
  assert.ok(transaction.postedAt);
  assert.match(transaction.transactionHash ?? '', /^[0-9a-f]{64}$/);

  await assert.rejects(
    prisma.ledgerTransaction.update({
      where: { id: transaction.id },
      data: { previousHash: nextHash() },
    }),
  );

  await assert.rejects(
    prisma.ledgerEntry.update({
      where: { id: debit.id },
      data: { amount: '26' },
    }),
  );

  await assert.rejects(
    prisma.ledgerEntry.delete({ where: { id: debit.id } }),
  );

  await assert.rejects(
    prisma.ledgerTransaction.delete({ where: { id: transaction.id } }),
  );
});

test('M2-01: escrow requires exact posted lock evidence and supports only one terminal transition', async () => {
  const fixture = await createPrincipalFixture('escrow');
  const clearing = await getSystemAccount('system_clearing');
  const draftContractId = unique('contract-draft-lock');

  const draftLock = await createDraftTransaction(
    'contract_escrow',
    'escrow-draft-lock',
    undefined,
    'escrow_lock',
    draftContractId,
  );
  await assert.rejects(
    prisma.escrow.create({
      data: {
        contractId: draftContractId,
        buyerAccountId: fixture.available.id,
        amount: '10',
        lockLedgerTransactionId: draftLock.id,
      },
    }),
  );

  const contractId = unique('contract');
  const lock = await createBalancedPostedTransaction(
    'contract_escrow',
    'escrow-lock',
    fixture.available.id,
    fixture.locked.id,
    '10',
    'escrow_lock',
    contractId,
  );

  await assert.rejects(
    prisma.escrow.create({
      data: {
        contractId: unique('contract-system-buyer'),
        buyerAccountId: clearing.id,
        amount: '10',
        lockLedgerTransactionId: lock.transaction.id,
      },
    }),
  );

  const escrow = await prisma.escrow.create({
    data: {
      contractId,
      buyerAccountId: fixture.available.id,
      amount: '10',
      lockLedgerTransactionId: lock.transaction.id,
    },
  });
  assert.equal(escrow.status, 'locked');

  const release = await createBalancedPostedTransaction(
    'settlement',
    'escrow-release',
    fixture.locked.id,
    fixture.available.id,
    '10',
    'escrow_release',
    contractId,
  );

  const released = await prisma.escrow.update({
    where: { id: escrow.id },
    data: {
      status: 'released',
      releaseLedgerTransactionId: release.transaction.id,
      releasedAt: new Date(),
    },
  });
  assert.equal(released.status, 'released');

  const refund = await createBalancedPostedTransaction(
    'refund',
    'escrow-refund-after-release',
    fixture.locked.id,
    fixture.available.id,
    '10',
    'escrow_refund',
    contractId,
  );

  await assert.rejects(
    prisma.escrow.update({
      where: { id: escrow.id },
      data: {
        status: 'refunded',
        releaseLedgerTransactionId: null,
        releasedAt: null,
        refundLedgerTransactionId: refund.transaction.id,
        refundedAt: new Date(),
      },
    }),
  );

  await assert.rejects(prisma.escrow.delete({ where: { id: escrow.id } }));
});
