import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { requireR8PostgresTestTarget } from './helpers/r8-postgres-test-target.mjs';
import {
  fundProtocolIncentivePool,
  issueGenesisCredit,
  issuePurchasedCredit,
} from '../src/lib/ledger/credit-foundation.mjs';
import { awardProtocolIncentive } from '../src/lib/ledger/incentive-awards.mjs';
import {
  INCENTIVE_AWARD_FACTS_VERSION,
  readIncentiveAwardFacts,
} from '../src/lib/integrity/incentive-award-facts.mjs';

const prisma = new PrismaClient();
let connected = false;

// 必须显式确认本地独立测试库：不在生产数据库中创建任何测试经济事实。
// 此测试不会清库、删除用户记录或更新已有 Ledger / ReputationEvidence。
before(async () => {
  requireR8PostgresTestTarget();
  await prisma.$connect();
  connected = true;
});

after(async () => {
  if (connected) await prisma.$disconnect();
});

function unique(prefix) {
  return prefix + '-' + process.pid + '-' + Date.now() + '-' +
    Math.random().toString(16).slice(2);
}

async function createPrincipal(label) {
  const organization = await prisma.organization.create({
    data: { name: unique('r8-' + label), type: 'buyer' },
  });
  return prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
}

test('R8 真库：M2 奖励池入账事实可追溯、跨来源隔离、时间边界及幂等读取', async () => {
  const [beneficiary, genesisOwner, purchasedOwner] = await Promise.all([
    createPrincipal('award'), createPrincipal('genesis'), createPrincipal('purchased'),
  ]);
  const programId = unique('r8-program');
  const firstInput = {
    principalId: beneficiary.id, programId, awardId: 'award-1', amount: '5.00000000',
  };
  const secondInput = {
    principalId: beneficiary.id, programId, awardId: 'award-2', amount: '7.00000000',
  };
  await fundProtocolIncentivePool(prisma, {
    budgetRef: unique('r8-budget'), amount: '12.00000000',
  });

  const first = await awardProtocolIncentive(prisma, firstInput);
  const second = await awardProtocolIncentive(prisma, secondInput);
  assert.equal(first.status, 'posted');
  assert.equal(second.status, 'posted');
  assert.match(first.transactionHash, /^[0-9a-f]{64}$/);
  assert.match(second.transactionHash, /^[0-9a-f]{64}$/);
  for (const posted of [first, second]) {
    const entries = await prisma.ledgerEntry.findMany({ where: { transactionId: posted.id } });
    assert.equal(entries.length, 2, 'M2发奖应当恰好具有两条账本分录');
    assert.deepEqual(entries.map((entry) => entry.side).sort(), ['credit', 'debit']);
    const orderedEntries = [...entries].sort((left, right) => left.entryIndex - right.entryIndex);
    assert.deepEqual(orderedEntries.map(({ entryIndex, side }) => [entryIndex, side]),
      [[0, 'debit'], [1, 'credit']], 'M2奖励分录序号必须符合协议顺序');
    assert.equal(posted.idempotencyKey, 'credit:incentive-award:' + posted.referenceId);
  }

  // 其他来源同样已入账，但绝不能被读取为 Incentive Award。
  await issueGenesisCredit(prisma, {
    principalId: genesisOwner.id, amount: '6', allocationVersion: unique('r8-genesis'),
  });
  await issuePurchasedCredit(prisma, {
    principalId: purchasedOwner.id, amount: '8', purchaseRef: unique('r8-purchase'),
  });

  const principalIds = [purchasedOwner.id, beneficiary.id, genesisOwner.id];
  const windowStart = new Date(first.postedAt.getTime() - 60_000);
  const windowEnd = new Date(Date.now() + 60_000);
  const readInput = { principalIds, windowStart, windowEnd };
  const beforeRead = await prisma.ledgerTransaction.count();

  const facts = await readIncentiveAwardFacts(prisma, readInput);
  const replay = await readIncentiveAwardFacts(prisma, {
    ...readInput, principalIds: [...principalIds].reverse(),
  });
  assert.deepEqual(facts, replay, '重复查询不得依赖 Principal 入参顺序');
  assert.equal(facts.factsVersion, INCENTIVE_AWARD_FACTS_VERSION);
  assert.equal(facts.automaticPunishmentApplied, false);
  assert.equal(facts.capitalLineageTraced, false);
  assert.equal(facts.triggerEventAttribution, 'unavailable');
  assert.equal(facts.r8RiskEvaluationEligible, false);
  assert.equal(facts.records.length, 2);
  assert.deepEqual(
    new Set(facts.records.map((record) => record.transactionHash)),
    new Set([first.transactionHash, second.transactionHash]),
  );
  assert.deepEqual(
    new Set(facts.records.map((record) => record.awardId)),
    new Set(['award-1', 'award-2']),
  );
  assert.ok(facts.records.every((record) => record.principalId === beneficiary.id));

  // The same UTC observation window must work on non-UTC PostgreSQL sessions.
  for (const timeZone of ['UTC', 'Asia/Shanghai', 'America/New_York']) {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT set_config('TimeZone', ${timeZone}, true)`;
      assert.deepEqual(await readIncentiveAwardFacts(tx, readInput), facts, timeZone);
      assert.equal((await readIncentiveAwardFacts(tx, {
        ...readInput, windowEnd: first.postedAt,
      })).records.length, 0, timeZone + ': exclusive upper bound');
      assert.equal((await readIncentiveAwardFacts(tx, {
        ...readInput, windowStart: first.postedAt,
      })).records.length, 2, timeZone + ': inclusive lower bound');
    });
  }

  const beforeFirst = await readIncentiveAwardFacts(prisma, {
    ...readInput, windowEnd: first.postedAt,
  });
  assert.equal(beforeFirst.records.length, 0, '上界排除恰好在上界入账的奖励');

  const fromFirst = await readIncentiveAwardFacts(prisma, {
    ...readInput, windowStart: first.postedAt,
  });
  assert.equal(fromFirst.records.length, 2, '下界包含恰好在下界入账的奖励');

  await assert.rejects(
    readIncentiveAwardFacts(prisma, { ...readInput, limit: 1 }),
    (error) => error.code === 'INTEGRITY_INCENTIVE_FACT_INVALID',
    '截断后的事实集合不得被当作完整观察结果',
  );
  assert.equal(await prisma.ledgerTransaction.count(), beforeRead, '事实查询不能写入账本');

  const replayedAward = await awardProtocolIncentive(prisma, firstInput);
  assert.equal(replayedAward.id, first.id, 'M2 发奖命令必须按原始经济凭证幂等');
  assert.equal(await prisma.ledgerTransaction.count(), beforeRead);
  assert.deepEqual(await readIncentiveAwardFacts(prisma, readInput), facts);
});
