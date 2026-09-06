import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
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

test('M2-05: fork guard rejects two posted successors while draft work cannot poison the chain head', async () => {
  const systemAccounts = await ensureSystemLedgerAccounts(prisma);
  const beneficiary = await createPrincipal('fork-beneficiary');
  const beneficiaryAccounts = await ensurePrincipalLedgerAccounts(prisma, beneficiary.id);
  const head = await prisma.ledgerTransaction.findFirst({
    where: { status: 'posted', transactionHash: { not: null } },
    orderBy: [{ postedAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
  });
  assert.ok(head?.transactionHash);

  const primaryReference = unique('fork-primary');
  const primary = await postLedgerTransaction(prisma, {
    type: 'reserve',
    referenceType: 'm2_integrity_fork_primary',
    referenceId: primaryReference,
    idempotencyKey: `m2-integrity:${primaryReference}`,
    entries: [
      {
        accountId: systemAccounts.system_reserve.id,
        side: 'debit',
        amount: '1',
      },
      {
        accountId: beneficiaryAccounts.principal_available.id,
        side: 'credit',
        amount: '1',
      },
    ],
  });
  assert.equal(primary.previousHash, head.transactionHash);

  const competingReference = unique('fork-competing');
  const competing = await prisma.ledgerTransaction.create({
    data: {
      type: 'reserve',
      referenceType: 'm2_integrity_fork_fixture',
      referenceId: competingReference,
      idempotencyKey: `m2-integrity:${competingReference}`,
      previousHash: head.transactionHash,
    },
  });
  await prisma.ledgerEntry.createMany({
    data: [
      {
        transactionId: competing.id,
        entryIndex: 0,
        accountId: systemAccounts.system_reserve.id,
        side: 'debit',
        amount: '1',
      },
      {
        transactionId: competing.id,
        entryIndex: 1,
        accountId: beneficiaryAccounts.principal_available.id,
        side: 'credit',
        amount: '1',
      },
    ],
  });

  await assert.rejects(
    prisma.ledgerTransaction.update({
      where: { id: competing.id },
      data: {
        status: 'posted',
        postedAt: new Date(),
        transactionHash: sha256(competingReference),
      },
    }),
    (error) => error && error.code === 'P2002',
  );

  const persisted = await prisma.ledgerTransaction.findUnique({ where: { id: competing.id } });
  assert.equal(persisted?.status, 'draft');
});

test('M2 closure hardening: canonical ledger and Escrow use one explicit concurrency-control model', async () => {
  const [escrowSource, postingSource] = await Promise.all([
    readFile(new URL('../src/lib/ledger/escrow-primitives.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../src/lib/ledger/ledger-posting.mjs', import.meta.url), 'utf8'),
  ]);

  assert.doesNotMatch(escrowSource, /function lockAccountsForUpdate/);
  assert.doesNotMatch(escrowSource, /function assertSufficientPostedBalance/);
  assert.match(escrowSource, /postLedgerTransactionInTransaction/);
  assert.match(escrowSource, /LEDGER_ACCOUNT_OVERDRAFT/);

  assert.match(postingSource, /pg_advisory_xact_lock/);
  assert.match(postingSource, /FOR UPDATE/);
  assert.match(postingSource, /TransactionIsolationLevel\.ReadCommitted/);
  assert.doesNotMatch(postingSource, /TransactionIsolationLevel\.Serializable/);
  assert.match(escrowSource, /TransactionIsolationLevel\.ReadCommitted/);
  assert.doesNotMatch(escrowSource, /TransactionIsolationLevel\.Serializable/);
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
