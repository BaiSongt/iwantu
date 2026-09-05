import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { LedgerPostingError } from '../src/lib/ledger/ledger-posting.mjs';
import {
  CreditFoundationError,
  bootstrapPrincipalEconomicAccounts,
  buildCreditProvenance,
  ensurePrincipalLedgerAccounts,
  ensureSystemLedgerAccounts,
  fundProtocolIncentivePool,
  issueGenesisCredit,
  issuePurchasedCredit,
} from '../src/lib/ledger/credit-foundation.mjs';

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
    data: { name: `Credit Org ${suffix}`, type: 'buyer' },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  return { organization, principal };
}

function assertCreditError(error, code) {
  assert.ok(error instanceof CreditFoundationError);
  assert.equal(error.code, code);
  return true;
}

function assertPostingError(error, code) {
  assert.ok(error instanceof LedgerPostingError);
  assert.equal(error.code, code);
  return true;
}

test('M2-03: Principal and system economic account bootstrap is idempotent under concurrency', async () => {
  const { principal } = await createPrincipal('bootstrap');

  const results = await Promise.all([
    bootstrapPrincipalEconomicAccounts(prisma, principal.id),
    bootstrapPrincipalEconomicAccounts(prisma, principal.id),
    bootstrapPrincipalEconomicAccounts(prisma, principal.id),
  ]);

  for (const result of results) {
    assert.deepEqual(
      Object.keys(result.principalAccounts).sort(),
      ['principal_available', 'principal_locked', 'principal_pending'],
    );
    assert.deepEqual(
      Object.keys(result.systemAccounts).sort(),
      ['system_clearing', 'system_fee', 'system_incentive', 'system_reserve'],
    );
  }

  const principalAccounts = await prisma.ledgerAccount.findMany({
    where: { principalId: principal.id },
  });
  assert.equal(principalAccounts.length, 3);
  assert.ok(principalAccounts.every((account) => account.currency === 'IWC'));

  const systemAccounts = await ensureSystemLedgerAccounts(prisma);
  assert.ok(Object.values(systemAccounts).every((account) => account.principalId === null));
});

test('M2-03: account bootstrap rejects unknown Principal and never creates Agent-owned accounts', async () => {
  await assert.rejects(
    ensurePrincipalLedgerAccounts(prisma, unique('missing-principal')),
    (error) => assertCreditError(error, 'PRINCIPAL_NOT_FOUND'),
  );

  const schema = await import('node:fs/promises').then(({ readFile }) =>
    readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'));
  const ledgerAccount = schema.match(/model LedgerAccount \{([\s\S]*?)\n\}/)?.[1] ?? '';
  assert.doesNotMatch(ledgerAccount, /agentIdentityId/);
  assert.match(ledgerAccount, /principalId\s+String\?/);
});

test('M2-03: provenance schema supports accepted Credit origins and keeps Agent attribution non-economic', () => {
  const principalId = 'principal-1';
  const genesis = buildCreditProvenance({
    kind: 'genesis',
    beneficiaryPrincipalId: principalId,
    sourceReferenceType: 'principal_genesis_allocation',
    sourceReferenceId: 'principal-1:v1',
    allocationVersion: 'v1',
  });
  const purchased = buildCreditProvenance({
    kind: 'purchased',
    beneficiaryPrincipalId: principalId,
    sourceReferenceType: 'purchased_service_credit',
    sourceReferenceId: 'order-1',
    purchaseRef: 'order-1',
  });
  const earned = buildCreditProvenance({
    kind: 'earned',
    beneficiaryPrincipalId: principalId,
    sourceReferenceType: 'contract_settlement',
    sourceReferenceId: 'contract-1',
    contractId: 'contract-1',
    earnedByAgentIdentityId: 'agent-1',
  });
  const incentive = buildCreditProvenance({
    kind: 'incentive',
    beneficiaryPrincipalId: principalId,
    sourceReferenceType: 'protocol_incentive',
    sourceReferenceId: 'program-1:award-1',
    programId: 'program-1',
    awardId: 'award-1',
  });
  const refund = buildCreditProvenance({
    kind: 'refund',
    beneficiaryPrincipalId: principalId,
    sourceReferenceType: 'contract_refund',
    sourceReferenceId: 'refund-1',
    originalLedgerTransactionId: 'ledger-1',
    contractId: 'contract-1',
  });

  for (const provenance of [genesis, purchased, earned, incentive, refund]) {
    assert.equal(provenance.schemaVersion, 'iwantu-credit-provenance/0.1');
    assert.equal(provenance.beneficiaryPrincipalId, principalId);
  }
  assert.equal(earned.earnedByAgentIdentityId, 'agent-1');
  assert.equal(earned.beneficiaryPrincipalId, principalId);

  assert.throws(
    () => buildCreditProvenance({
      kind: 'airdrop',
      beneficiaryPrincipalId: principalId,
      sourceReferenceType: 'invalid',
      sourceReferenceId: 'invalid',
    }),
    (error) => assertCreditError(error, 'CREDIT_PROVENANCE_KIND_INVALID'),
  );
});

test('M2-03: Genesis allocation credits Principal Available exactly once with structured provenance', async () => {
  const { principal } = await createPrincipal('genesis');
  const input = {
    principalId: principal.id,
    amount: '100',
    allocationVersion: 'v1',
    metadata: { reason: 'cold_start' },
  };

  const first = await issueGenesisCredit(prisma, input);
  const retry = await issueGenesisCredit(prisma, { ...input, amount: '100.00000000' });
  assert.equal(first.id, retry.id);
  assert.equal(first.type, 'genesis');
  assert.equal(first.status, 'posted');

  const accounts = await ensurePrincipalLedgerAccounts(prisma, principal.id);
  const entries = await prisma.ledgerEntry.findMany({
    where: { transactionId: first.id },
    orderBy: { entryIndex: 'asc' },
  });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].side, 'debit');
  assert.equal(entries[0].provenance, null);
  assert.equal(entries[1].side, 'credit');
  assert.equal(entries[1].accountId, accounts.principal_available.id);
  assert.equal(entries[1].provenance.kind, 'genesis');
  assert.equal(entries[1].provenance.beneficiaryPrincipalId, principal.id);
  assert.equal(entries[1].provenance.allocationVersion, 'v1');

  await assert.rejects(
    issueGenesisCredit(prisma, { ...input, amount: '101' }),
    (error) => assertPostingError(error, 'IDEMPOTENCY_CONFLICT'),
  );
});

test('M2-03: Purchased Credit is repeatable only through distinct external purchase references', async () => {
  const { principal } = await createPrincipal('purchase');
  const firstRef = unique('purchase-a');
  const secondRef = unique('purchase-b');

  const first = await issuePurchasedCredit(prisma, {
    principalId: principal.id,
    amount: '20',
    purchaseRef: firstRef,
    metadata: { provider: 'test' },
  });
  const retry = await issuePurchasedCredit(prisma, {
    principalId: principal.id,
    amount: '20.00000000',
    purchaseRef: firstRef,
    metadata: { provider: 'test' },
  });
  const second = await issuePurchasedCredit(prisma, {
    principalId: principal.id,
    amount: '30',
    purchaseRef: secondRef,
  });

  assert.equal(first.id, retry.id);
  assert.notEqual(first.id, second.id);
  assert.equal(first.type, 'purchased_credit');
  assert.equal(second.type, 'purchased_credit');

  const credited = await prisma.ledgerEntry.findFirst({
    where: { transactionId: first.id, side: 'credit' },
  });
  assert.equal(credited.provenance.kind, 'purchased');
  assert.equal(credited.provenance.purchaseRef, firstRef);
  assert.equal(credited.provenance.beneficiaryPrincipalId, principal.id);
});

test('M2-03: purchase reference cannot be replayed to mint Credit for another Principal', async () => {
  const left = await createPrincipal('purchase-left');
  const right = await createPrincipal('purchase-right');
  const purchaseRef = unique('purchase-global');

  await issuePurchasedCredit(prisma, {
    principalId: left.principal.id,
    amount: '15',
    purchaseRef,
  });

  await assert.rejects(
    issuePurchasedCredit(prisma, {
      principalId: right.principal.id,
      amount: '15',
      purchaseRef,
    }),
    (error) => assertPostingError(error, 'IDEMPOTENCY_CONFLICT'),
  );
});

test('M2-03: suspended Principal cannot receive new Genesis or Purchased issuance', async () => {
  const { principal } = await createPrincipal('suspended');
  await prisma.principal.update({
    where: { id: principal.id },
    data: { status: 'suspended', suspendedAt: new Date() },
  });

  await assert.rejects(
    issueGenesisCredit(prisma, { principalId: principal.id, amount: '10' }),
    (error) => assertCreditError(error, 'PRINCIPAL_INACTIVE'),
  );
  await assert.rejects(
    issuePurchasedCredit(prisma, {
      principalId: principal.id,
      amount: '10',
      purchaseRef: unique('suspended-purchase'),
    }),
    (error) => assertCreditError(error, 'PRINCIPAL_INACTIVE'),
  );
});

test('M2-03: protocol incentive budget is funded into finite system pool without awarding a Principal', async () => {
  const budgetRef = unique('incentive-budget');
  const first = await fundProtocolIncentivePool(prisma, {
    budgetRef,
    amount: '250',
    metadata: { program: 'cold-start-quality' },
  });
  const retry = await fundProtocolIncentivePool(prisma, {
    budgetRef,
    amount: '250.00000000',
    metadata: { program: 'cold-start-quality' },
  });
  assert.equal(first.id, retry.id);
  assert.equal(first.type, 'reserve');

  const systemAccounts = await ensureSystemLedgerAccounts(prisma);
  const creditEntry = await prisma.ledgerEntry.findFirst({
    where: { transactionId: first.id, side: 'credit' },
  });
  assert.equal(creditEntry.accountId, systemAccounts.system_incentive.id);
  assert.equal(creditEntry.provenance, null);

  await assert.rejects(
    fundProtocolIncentivePool(prisma, { budgetRef, amount: '251' }),
    (error) => assertPostingError(error, 'IDEMPOTENCY_CONFLICT'),
  );
});
