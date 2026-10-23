import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';

import {
  fundProtocolIncentivePool,
  issueGenesisCredit,
  issuePurchasedCredit,
} from '../src/lib/ledger/credit-foundation.mjs';
import { awardProtocolIncentive } from '../src/lib/ledger/incentive-awards.mjs';
import {
  GENESIS_ISSUANCE_PROVENANCE_VERSION,
  readGenesisIssuanceFacts,
} from '../src/lib/integrity/genesis-issuance-facts.mjs';

const prisma = new PrismaClient();

// 防止误用生产库：本 Gate 只允许在独立测试数据库内创建测试 Principal 和账本事实。
before(async () => {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('R7 PostgreSQL Gate 需要显式设置 DATABASE_URL');
  const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ''));
  if (!/(^|[_-])test($|[_-])/i.test(databaseName)) {
    throw new Error('R7 PostgreSQL Gate 仅允许测试数据库，实际数据库名为：' + databaseName);
  }
  await prisma.$connect();
});

after(async () => prisma.$disconnect());

function unique(label) {
  return label + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

async function createPrincipal(label) {
  const organization = await prisma.organization.create({
    data: { name: unique('r7-' + label), type: 'buyer' },
  });
  return prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
}

function getSubject(facts, principalId) {
  const subject = facts.principals.find((row) => row.principalId === principalId);
  assert.ok(subject, '应返回全部三个 Principal 的有序结果');
  return subject;
}

test('R7 真库：仅计入截止时间前已 POSTED 的 Genesis，排除 Purchased 和 Incentive，并保留哈希', async () => {
  const [genesisOwner, incentiveOwner, purchasedOwner] = await Promise.all([
    createPrincipal('genesis'),
    createPrincipal('incentive'),
    createPrincipal('purchased'),
  ]);
  const runId = unique('issuance');
  const genesis = await issueGenesisCredit(prisma, {
    principalId: genesisOwner.id,
    amount: '80.00000000',
    allocationVersion: runId,
  });
  assert.equal(genesis.status, 'posted');
  assert.match(genesis.transactionHash, /^[0-9a-f]{64}$/);

  // 与真实资金发放路径相同；但 R7 只允许将 Genesis 纳入发行事实。
  await fundProtocolIncentivePool(prisma, { budgetRef: runId, amount: '100' });
  await awardProtocolIncentive(prisma, {
    principalId: incentiveOwner.id,
    programId: runId,
    awardId: 'one',
    amount: '20',
  });
  await issuePurchasedCredit(prisma, {
    principalId: purchasedOwner.id,
    purchaseRef: runId,
    amount: '40',
  });

  const principalIds = [purchasedOwner.id, genesisOwner.id, incentiveOwner.id];
  const beforeFirstPost = await readGenesisIssuanceFacts(prisma, {
    principalIds,
    before: genesis.postedAt,
  });
  assert.equal(getSubject(beforeFirstPost, genesisOwner.id).issuanceCount, 0,
    '严格小于截止时间，恰好相等的 POSTED Genesis 必须排除');

  const cutoff = new Date(Date.now() + 60_000);
  const ledgerCountBeforeRead = await prisma.ledgerTransaction.count();
  const result = await readGenesisIssuanceFacts(prisma, { principalIds, before: cutoff });
  const replay = await readGenesisIssuanceFacts(prisma, {
    principalIds: [...principalIds].reverse(),
    before: cutoff,
  });
  const ledgerCountAfterRead = await prisma.ledgerTransaction.count();

  assert.deepEqual(result, replay, '重复读取和 Principal 入参排列不得改变证据');
  assert.deepEqual(result.principals.map((row) => row.principalId),
    [...principalIds].sort());
  assert.equal(result.provenanceVersion, GENESIS_ISSUANCE_PROVENANCE_VERSION);
  assert.equal(result.capitalLineageTraced, false);
  const genesisFact = getSubject(result, genesisOwner.id);
  assert.equal(genesisFact.issuanceCount, 1);
  assert.equal(genesisFact.issuedAmount, '80.00000000');
  assert.deepEqual(genesisFact.transactionHashes, [genesis.transactionHash]);

  for (const excludedId of [incentiveOwner.id, purchasedOwner.id]) {
    assert.deepEqual(getSubject(result, excludedId), {
      principalId: excludedId,
      issuanceCount: 0,
      issuedAmount: '0.00000000',
      transactionHashes: [],
    });
  }
  assert.equal(ledgerCountBeforeRead, ledgerCountAfterRead, '事实读取不能写账本');

  const replayedIssuance = await issueGenesisCredit(prisma, {
    principalId: genesisOwner.id,
    amount: '80.00000000',
    allocationVersion: runId,
  });
  assert.equal(replayedIssuance.id, genesis.id, '重复发行命令必须幂等');
  const afterIdempotentReplay = await readGenesisIssuanceFacts(prisma, {
    principalIds,
    before: cutoff,
  });
  assert.deepEqual(afterIdempotentReplay, result);
});
