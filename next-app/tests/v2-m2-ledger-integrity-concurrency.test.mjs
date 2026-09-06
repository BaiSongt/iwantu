import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  ensurePrincipalLedgerAccounts,
  ensureSystemLedgerAccounts,
  fundProtocolIncentivePool,
} from '../src/lib/ledger/credit-foundation.mjs';
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

  assert.equal(await postedBalance(principalAccounts.principal_available.id), '0');
});

test('M2-05: finite incentive pool cannot over-award under concurrent writers', async () => {
  const programId = unique('program');
  const beneficiaries = await Promise.all([
    createPrincipal('award-a'),
    createPrincipal('award-b'),
    createPrincipal('award-c'),
  ]);

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

  const systemAccounts = await ensureSystemLedgerAccounts(prisma);
  assert.equal(await postedBalance(systemAccounts.system_incentive.id), '2');

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

  const first = await prisma.ledgerTransaction.create({
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

  await prisma.ledgerTransaction.delete({ where: { id: first.id } });
});
