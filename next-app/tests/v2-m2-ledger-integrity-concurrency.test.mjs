import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  ensurePrincipalLedgerAccounts,
  ensureSystemLedgerAccounts,
  fundProtocolIncentivePool,
  issueGenesisCredit,
} from '../src/lib/ledger/credit-foundation.mjs';
import { lockEscrow } from '../src/lib/ledger/escrow-primitives.mjs';
import { awardProtocolIncentive } from '../src/lib/ledger/incentive-awards.mjs';
import {
  LedgerPostingError,
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

async function createPrincipal(label) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `Integrity Org ${suffix}`, type: 'buyer' },
  });
  return prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
}

async function postedBalance(accountId) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(sum(CASE
      WHEN t."status" = 'posted' AND e."side" = 'credit' THEN e."amount"
      WHEN t."status" = 'posted' AND e."side" = 'debit' THEN -e."amount"
      ELSE 0
    END), 0)::DECIMAL(36,8) AS balance
    FROM "ledger_entries" e
    JOIN "ledger_transactions" t ON t."id" = e."transactionId"
    WHERE e."accountId" = ${accountId}
  `;
  return rows[0].balance.toString();
}

test('M2-05: protected Principal accounts cannot be overdrawn by the canonical posting path', async () => {
  const principal = await createPrincipal('overdraft');
  const principalAccounts = await ensurePrincipalLedgerAccounts(prisma, principal.id);
  const systemAccounts = await ensureSystemLedgerAccounts(prisma);
  const referenceId = unique('overdraft');

  await assert.rejects(
    postLedgerTransaction(prisma, {
      type: 'penalty',
      referenceType: 'm2_integrity_overdraft',
      referenceId,
      idempotencyKey: `m2-integrity:${referenceId}`,
      entries: [
        {
          accountId: principalAccounts.principal_available.id,
          side: 'debit',
          amount: '1',
        },
        {
          accountId: systemAccounts.system_clearing.id,
          side: 'credit',
          amount: '1',
        },
      ],
    }),
    (error) => {
      assert.ok(error instanceof LedgerPostingError);
      assert.equal(error.code, 'LEDGER_ACCOUNT_OVERDRAFT');
      return true;
    },
  );

  assert.equal(Number(await postedBalance(principalAccounts.principal_available.id)), 0);
});

test('M2-05: finite incentive pool cannot over-award under concurrent writers', async () => {
  const programId = unique('program');
  const beneficiaries = await Promise.all([
    createPrincipal('award-a'),
    createPrincipal('award-b'),
    createPrincipal('award-c'),
  ]);
  const systemAccounts = await ensureSystemLedgerAccounts(prisma);
  const startingBalance = await postedBalance(systemAccounts.system_incentive.id);

  if (Number(startingBalance) > 0) {
    const drainRef = unique('incentive-drain');
    await postLedgerTransaction(prisma, {
      type: 'reserve',
      referenceType: 'm2_integrity_test_reset',
      referenceId: drainRef,
      idempotencyKey: `m2-integrity:${drainRef}`,
      entries: [
        {
          accountId: systemAccounts.system_incentive.id,
          side: 'debit',
          amount: startingBalance,
        },
        {
          accountId: systemAccounts.system_reserve.id,
          side: 'credit',
          amount: startingBalance,
        },
      ],
    });
  }
  assert.equal(Number(await postedBalance(systemAccounts.system_incentive.id)), 0);

  const funded = await fundProtocolIncentivePool(prisma, {
    budgetRef: unique('budget'),
    amount: '10',
  });

  const results = await Promise.allSettled(
    beneficiaries.map((principal, index) => awardProtocolIncentive(prisma, {
      principalId: principal.id,
      programId,
      awardId: `award-${index + 1}`,
      amount: '4',
    })),
  );

  const fulfilled = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
  const rejected = results.filter((result) => result.status === 'rejected');

  assert.equal(fulfilled.length, 2);
  assert.equal(rejected.length, 1);
  assert.ok(rejected[0].reason instanceof LedgerPostingError);
  assert.equal(rejected[0].reason.code, 'LEDGER_ACCOUNT_OVERDRAFT');
  assert.equal(Number(await postedBalance(systemAccounts.system_incentive.id)), 2);

  const successful = [funded, ...fulfilled];
  const hashes = new Set(successful.map((transaction) => transaction.transactionHash));
  const internalLinks = successful.filter(
    (transaction) => transaction.previousHash && hashes.has(transaction.previousHash),
  );
  assert.equal(internalLinks.length, 2);
  assert.equal(
    new Set(successful.map((transaction) => transaction.previousHash).filter(Boolean)).size,
    successful.map((transaction) => transaction.previousHash).filter(Boolean).length,
  );
});

test('M2-05: database fork guard rejects two successors for the same previousHash', async () => {
  const head = await prisma.ledgerTransaction.findFirst({
    where: { status: 'posted', transactionHash: { not: null } },
    orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  });
  assert.ok(head?.transactionHash);

  await prisma.ledgerTransaction.create({
    data: {
      type: 'reserve',
      referenceType: 'm2_integrity_fork_fixture',
      referenceId: unique('fork-a'),
      idempotencyKey: unique('fork-a-key'),
      previousHash: head.transactionHash,
    },
  });

  await assert.rejects(
    prisma.ledgerTransaction.create({
      data: {
        type: 'reserve',
        referenceType: 'm2_integrity_fork_fixture',
        referenceId: unique('fork-b'),
        idempotencyKey: unique('fork-b-key'),
        previousHash: head.transactionHash,
      },
    }),
    (error) => error && error.code === 'P2002',
  );
});

test('M2 closure hardening: Escrow delegates account locking and no-overdraft enforcement to canonical posting', async () => {
  const source = await readFile(
    new URL('../src/lib/ledger/escrow-primitives.mjs', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(source, /function lockAccountsForUpdate/);
  assert.doesNotMatch(source, /function assertSufficientPostedBalance/);
  assert.match(source, /postLedgerTransactionInTransaction/);
  assert.match(source, /LEDGER_ACCOUNT_OVERDRAFT/);
});

test('M2 closure hardening: mixed Escrow and direct postings converge under contention', async () => {
  const principal = await createPrincipal('mixed-contention');
  const principalAccounts = await ensurePrincipalLedgerAccounts(prisma, principal.id);
  const systemAccounts = await ensureSystemLedgerAccounts(prisma);
  const allocationVersion = unique('mixed-contention-allocation');

  await issueGenesisCredit(prisma, {
    principalId: principal.id,
    allocationVersion,
    amount: '100',
  });

  const escrowContracts = Array.from({ length: 6 }, (_, index) => unique(`mixed-escrow-${index}`));
  const directReferences = Array.from({ length: 6 }, (_, index) => unique(`mixed-direct-${index}`));
  const operations = [];

  for (let index = 0; index < 6; index += 1) {
    operations.push(
      lockEscrow(prisma, {
        contractId: escrowContracts[index],
        buyerPrincipalId: principal.id,
        amount: '10',
      }),
    );
    operations.push(
      postLedgerTransaction(prisma, {
        type: 'penalty',
        referenceType: 'm2_mixed_contention',
        referenceId: directReferences[index],
        idempotencyKey: `m2-mixed:${directReferences[index]}`,
        entries: [
          {
            accountId: principalAccounts.principal_available.id,
            side: 'debit',
            amount: '5',
          },
          {
            accountId: systemAccounts.system_fee.id,
            side: 'credit',
            amount: '5',
          },
        ],
      }),
    );
  }

  const settled = await Promise.allSettled(operations);
  const rejected = settled.filter((result) => result.status === 'rejected');

  assert.equal(rejected.length, 0, rejected.map((result) => result.reason?.message).join('\n'));
  assert.equal(Number(await postedBalance(principalAccounts.principal_available.id)), 10);
  assert.equal(Number(await postedBalance(principalAccounts.principal_locked.id)), 60);
  assert.equal(
    await prisma.escrow.count({ where: { contractId: { in: escrowContracts } } }),
    6,
  );
});
