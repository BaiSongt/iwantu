import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  ensurePrincipalLedgerAccounts,
  issueGenesisCredit,
} from '../src/lib/ledger/credit-foundation.mjs';
import {
  EscrowPrimitiveError,
  lockEscrow,
  refundEscrow,
  releaseEscrow,
} from '../src/lib/ledger/escrow-primitives.mjs';
import { postLedgerTransaction } from '../src/lib/ledger/ledger-posting.mjs';

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

async function createPrincipal(label, status = 'active') {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `Escrow Org ${suffix}`, type: 'buyer' },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id, status },
  });
  const accounts = await ensurePrincipalLedgerAccounts(prisma, principal.id);
  return { suffix, organization, principal, accounts };
}

async function fundPrincipal(fixture, amount = '100') {
  return issueGenesisCredit(prisma, {
    principalId: fixture.principal.id,
    allocationVersion: `escrow-${fixture.suffix}`,
    amount,
  });
}

async function accountBalance(accountId) {
  const rows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT COALESCE(SUM(
        CASE WHEN e."side" = 'credit' THEN e."amount" ELSE -e."amount" END
      ), 0)::text AS "balance"
      FROM "ledger_entries" e
      JOIN "ledger_transactions" t ON t."id" = e."transactionId"
      WHERE e."accountId" = ${accountId}
        AND t."status" = 'posted'
    `,
  );
  return rows[0]?.balance ?? '0.00000000';
}

async function transactionCount(referenceType, referenceId) {
  return prisma.ledgerTransaction.count({ where: { referenceType, referenceId } });
}

async function expectEscrowError(promise, code) {
  await assert.rejects(
    promise,
    (error) => error instanceof EscrowPrimitiveError && error.code === code,
  );
}

test('M2-04: lock atomically moves Principal available Credit into locked Credit and creates Escrow evidence', async () => {
  const buyer = await createPrincipal('lock-success');
  await fundPrincipal(buyer, '100');
  const contractId = unique('contract-lock');

  const result = await lockEscrow(prisma, {
    contractId,
    buyerPrincipalId: buyer.principal.id,
    amount: '40',
  });

  assert.equal(result.escrow.status, 'locked');
  assert.equal(result.escrow.contractId, contractId);
  assert.equal(result.escrow.buyerAccountId, buyer.accounts.principal_available.id);
  assert.equal(result.ledgerTransaction.type, 'contract_escrow');
  assert.equal(result.ledgerTransaction.referenceType, 'escrow_lock');
  assert.equal(result.ledgerTransaction.referenceId, contractId);
  assert.equal(result.ledgerTransaction.entries.length, 2);
  assert.equal(await accountBalance(buyer.accounts.principal_available.id), '60.00000000');
  assert.equal(await accountBalance(buyer.accounts.principal_locked.id), '40.00000000');
});

test('M2-04: identical lock retry is idempotent and changed lock evidence fails closed', async () => {
  const buyer = await createPrincipal('lock-idempotent');
  await fundPrincipal(buyer, '80');
  const contractId = unique('contract-lock-idem');

  const first = await lockEscrow(prisma, {
    contractId,
    buyerPrincipalId: buyer.principal.id,
    amount: '25',
  });
  const second = await lockEscrow(prisma, {
    contractId,
    buyerPrincipalId: buyer.principal.id,
    amount: '25',
  });

  assert.equal(second.escrow.id, first.escrow.id);
  assert.equal(second.ledgerTransaction.id, first.ledgerTransaction.id);
  assert.equal(await transactionCount('escrow_lock', contractId), 1);

  await expectEscrowError(
    lockEscrow(prisma, {
      contractId,
      buyerPrincipalId: buyer.principal.id,
      amount: '26',
    }),
    'ESCROW_IDEMPOTENCY_CONFLICT',
  );
});

test('M2-04: insufficient available balance rejects lock without journal or Escrow residue', async () => {
  const buyer = await createPrincipal('insufficient');
  await fundPrincipal(buyer, '10');
  const contractId = unique('contract-insufficient');

  await expectEscrowError(
    lockEscrow(prisma, {
      contractId,
      buyerPrincipalId: buyer.principal.id,
      amount: '11',
    }),
    'ESCROW_INSUFFICIENT_FUNDS',
  );

  assert.equal(await transactionCount('escrow_lock', contractId), 0);
  assert.equal(await prisma.escrow.count({ where: { contractId } }), 0);
  assert.equal(await accountBalance(buyer.accounts.principal_available.id), '10.00000000');
  assert.equal(await accountBalance(buyer.accounts.principal_locked.id), '0.00000000');
});

test('M2-04: concurrent locks on the same available account cannot overdraw posted balance', async () => {
  const buyer = await createPrincipal('concurrent-lock');
  await fundPrincipal(buyer, '50');
  const contractA = unique('contract-concurrent-a');
  const contractB = unique('contract-concurrent-b');

  const settled = await Promise.allSettled([
    lockEscrow(prisma, {
      contractId: contractA,
      buyerPrincipalId: buyer.principal.id,
      amount: '40',
    }),
    lockEscrow(prisma, {
      contractId: contractB,
      buyerPrincipalId: buyer.principal.id,
      amount: '40',
    }),
  ]);

  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = settled.find((item) => item.status === 'rejected');
  assert.ok(rejected);
  assert.equal(rejected.reason?.code, 'ESCROW_INSUFFICIENT_FUNDS');
  assert.equal(await accountBalance(buyer.accounts.principal_available.id), '10.00000000');
  assert.equal(await accountBalance(buyer.accounts.principal_locked.id), '40.00000000');
  assert.equal(await prisma.escrow.count({ where: { contractId: { in: [contractA, contractB] } } }), 1);
});

test('M2-04: release atomically moves locked Credit to recipient Principal with earned provenance', async () => {
  const buyer = await createPrincipal('release-buyer');
  const supplier = await createPrincipal('release-supplier');
  await fundPrincipal(buyer, '100');
  const agent = await prisma.agentIdentity.create({
    data: { principalId: supplier.principal.id, name: `Supplier Agent ${supplier.suffix}` },
  });
  const contractId = unique('contract-release');
  await lockEscrow(prisma, {
    contractId,
    buyerPrincipalId: buyer.principal.id,
    amount: '30',
  });

  const result = await releaseEscrow(prisma, {
    contractId,
    recipientPrincipalId: supplier.principal.id,
    earnedByAgentIdentityId: agent.id,
  });

  assert.equal(result.escrow.status, 'released');
  assert.equal(result.ledgerTransaction.type, 'settlement');
  assert.equal(result.ledgerTransaction.referenceType, 'escrow_release');
  assert.equal(await accountBalance(buyer.accounts.principal_locked.id), '0.00000000');
  assert.equal(await accountBalance(supplier.accounts.principal_available.id), '30.00000000');

  const creditEntry = result.ledgerTransaction.entries.find((entry) => entry.side === 'credit');
  assert.equal(creditEntry.provenance.kind, 'earned');
  assert.equal(creditEntry.provenance.beneficiaryPrincipalId, supplier.principal.id);
  assert.equal(creditEntry.provenance.earnedByAgentIdentityId, agent.id);
});

test('M2-04: release retry is idempotent and cannot be redirected to another Principal', async () => {
  const buyer = await createPrincipal('release-idem-buyer');
  const supplier = await createPrincipal('release-idem-supplier');
  const other = await createPrincipal('release-idem-other');
  await fundPrincipal(buyer, '60');
  const contractId = unique('contract-release-idem');
  await lockEscrow(prisma, {
    contractId,
    buyerPrincipalId: buyer.principal.id,
    amount: '20',
  });

  const first = await releaseEscrow(prisma, {
    contractId,
    recipientPrincipalId: supplier.principal.id,
  });
  const second = await releaseEscrow(prisma, {
    contractId,
    recipientPrincipalId: supplier.principal.id,
  });

  assert.equal(second.ledgerTransaction.id, first.ledgerTransaction.id);
  assert.equal(await transactionCount('escrow_release', contractId), 1);

  await assert.rejects(
    releaseEscrow(prisma, {
      contractId,
      recipientPrincipalId: other.principal.id,
    }),
    (error) => error?.code === 'IDEMPOTENCY_CONFLICT',
  );
});

test('M2-04: refund atomically returns locked Credit to buyer available with refund provenance', async () => {
  const buyer = await createPrincipal('refund-buyer');
  await fundPrincipal(buyer, '90');
  const contractId = unique('contract-refund');
  const locked = await lockEscrow(prisma, {
    contractId,
    buyerPrincipalId: buyer.principal.id,
    amount: '35',
  });

  const result = await refundEscrow(prisma, { contractId });

  assert.equal(result.escrow.status, 'refunded');
  assert.equal(result.ledgerTransaction.type, 'refund');
  assert.equal(await accountBalance(buyer.accounts.principal_available.id), '90.00000000');
  assert.equal(await accountBalance(buyer.accounts.principal_locked.id), '0.00000000');
  const creditEntry = result.ledgerTransaction.entries.find((entry) => entry.side === 'credit');
  assert.equal(creditEntry.provenance.kind, 'refund');
  assert.equal(creditEntry.provenance.beneficiaryPrincipalId, buyer.principal.id);
  assert.equal(
    creditEntry.provenance.originalLedgerTransactionId,
    locked.ledgerTransaction.id,
  );
});

test('M2-04: refund retry is idempotent', async () => {
  const buyer = await createPrincipal('refund-idem');
  await fundPrincipal(buyer, '40');
  const contractId = unique('contract-refund-idem');
  await lockEscrow(prisma, {
    contractId,
    buyerPrincipalId: buyer.principal.id,
    amount: '15',
  });

  const first = await refundEscrow(prisma, { contractId });
  const second = await refundEscrow(prisma, { contractId });
  assert.equal(second.ledgerTransaction.id, first.ledgerTransaction.id);
  assert.equal(await transactionCount('escrow_refund', contractId), 1);
});

test('M2-04: release and refund race resolves to exactly one terminal Escrow outcome', async () => {
  const buyer = await createPrincipal('terminal-race-buyer');
  const supplier = await createPrincipal('terminal-race-supplier');
  await fundPrincipal(buyer, '70');
  const contractId = unique('contract-terminal-race');
  await lockEscrow(prisma, {
    contractId,
    buyerPrincipalId: buyer.principal.id,
    amount: '25',
  });

  const settled = await Promise.allSettled([
    releaseEscrow(prisma, {
      contractId,
      recipientPrincipalId: supplier.principal.id,
    }),
    refundEscrow(prisma, { contractId }),
  ]);

  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  const rejected = settled.find((item) => item.status === 'rejected');
  assert.ok(rejected);
  assert.equal(rejected.reason?.code, 'ESCROW_TERMINAL_CONFLICT');

  const escrow = await prisma.escrow.findUnique({ where: { contractId } });
  assert.ok(['released', 'refunded'].includes(escrow.status));
  assert.equal(
    (await transactionCount('escrow_release', contractId))
      + (await transactionCount('escrow_refund', contractId)),
    1,
  );
});

test('M2-04: earned Agent attribution must belong to release recipient Principal', async () => {
  const buyer = await createPrincipal('agent-attribution-buyer');
  const supplier = await createPrincipal('agent-attribution-supplier');
  const other = await createPrincipal('agent-attribution-other');
  await fundPrincipal(buyer, '30');
  const otherAgent = await prisma.agentIdentity.create({
    data: { principalId: other.principal.id, name: `Other Agent ${other.suffix}` },
  });
  const contractId = unique('contract-agent-attribution');
  await lockEscrow(prisma, {
    contractId,
    buyerPrincipalId: buyer.principal.id,
    amount: '10',
  });

  await expectEscrowError(
    releaseEscrow(prisma, {
      contractId,
      recipientPrincipalId: supplier.principal.id,
      earnedByAgentIdentityId: otherAgent.id,
    }),
    'ESCROW_AGENT_ATTRIBUTION_INVALID',
  );

  const escrow = await prisma.escrow.findUnique({ where: { contractId } });
  assert.equal(escrow.status, 'locked');
  assert.equal(await transactionCount('escrow_release', contractId), 0);
});

test('M2-04: database rejects posted lock transaction whose entries do not match Escrow amount movement', async () => {
  const buyer = await createPrincipal('db-evidence');
  await fundPrincipal(buyer, '50');
  const contractId = unique('contract-db-evidence');

  const malformedLock = await postLedgerTransaction(prisma, {
    type: 'contract_escrow',
    referenceType: 'escrow_lock',
    referenceId: contractId,
    idempotencyKey: `malformed-lock:${contractId}`,
    entries: [
      {
        accountId: buyer.accounts.principal_available.id,
        side: 'debit',
        amount: '5',
      },
      {
        accountId: buyer.accounts.principal_locked.id,
        side: 'credit',
        amount: '5',
      },
    ],
  });

  await assert.rejects(
    prisma.escrow.create({
      data: {
        contractId,
        buyerAccountId: buyer.accounts.principal_available.id,
        amount: '6',
        lockLedgerTransactionId: malformedLock.id,
      },
    }),
  );
  assert.equal(await prisma.escrow.count({ where: { contractId } }), 0);
});
