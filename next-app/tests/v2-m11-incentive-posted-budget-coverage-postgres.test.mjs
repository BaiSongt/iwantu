import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { buildCreditProvenance, ensurePrincipalLedgerAccounts, ensureSystemLedgerAccounts } from '../src/lib/ledger/credit-foundation.mjs';
import { postLedgerTransactionInTransaction } from '../src/lib/ledger/ledger-posting.mjs';
import {
  inspectPostedIncentiveBudgetCoverageDraft,
  IncentivePostedBudgetCoverageDraftError,
} from '../src/lib/integrity/incentive-posted-budget-coverage-draft.mjs';

const prisma = new PrismaClient();
let connected = false;

// 此测试只允许显式指定的本机独立测试库；所有账本写入均在同一个回滚事务中。
before(async () => {
  const rawUrl = process.env.DATABASE_URL;
  if (!rawUrl || process.env.IWANTU_R8_POSTGRES_TEST !== 'iwantu_test') {
    throw new Error('R8-P1j 需显式设置 DATABASE_URL 与 IWANTU_R8_POSTGRES_TEST=iwantu_test');
  }
  const url = new URL(rawUrl);
  const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
      !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
      databaseName !== 'iwantu_test' || url.searchParams.has('schema')) {
    throw new Error('R8-P1j 仅允许本机 iwantu_test 数据库的默认测试 schema');
  }
  await prisma.$connect();
  connected = true;
});

after(async () => {
  if (connected) await prisma.$disconnect();
});

function unique(label) {
  return label + '-' + process.pid + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

function units(value) {
  const match = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/.exec(value);
  assert.ok(match, '测试中的金额必须是精确 Decimal(36,8) 字符串');
  return BigInt(match[1]) * 100_000_000n + BigInt((match[2] ?? '').padEnd(8, '0'));
}

async function awardInRollbackTransaction(tx, { system, available, principalId, programId, awardId, amount }) {
  const referenceId = programId + ':' + awardId;
  return postLedgerTransactionInTransaction(tx, {
    type: 'incentive',
    referenceType: 'protocol_incentive_award',
    referenceId,
    idempotencyKey: 'credit:incentive-award:' + referenceId,
    metadata: { programId, awardId, beneficiaryPrincipalId: principalId, details: null },
    entries: [
      { accountId: system.system_incentive.id, side: 'debit', amount },
      {
        accountId: available.id,
        side: 'credit',
        amount,
        provenance: buildCreditProvenance({
          kind: 'incentive', beneficiaryPrincipalId: principalId,
          sourceReferenceType: 'protocol_incentive_award', sourceReferenceId: referenceId,
          programId, awardId,
        }),
      },
    ],
  });
}

test('R8-P1j 真库：全历史支出、跨 Program 隔离、幂等与异常归属均在回滚事务内验证', async () => {
  const programId = unique('r8-p1j-program');
  const otherProgramId = unique('r8-p1j-other');
  const rollback = new Error('R8_P1J_ROLLBACK_ONLY');
  let exercised = false;
  let fixtureKey;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      // 先核对测试库原有账本：若含不可归属历史交易，立即拒绝并回滚。
      const baseline = await inspectPostedIncentiveBudgetCoverageDraft(tx, { programId });
      assert.equal(baseline.programPostedSpendIwc, '0.00000000');

      const organization = await tx.organization.create({
        data: { name: unique('R8 P1j rollback org'), type: 'buyer' },
      });
      const principal = await tx.principal.create({
        data: { type: 'organization', organizationId: organization.id },
      });
      const accounts = await ensurePrincipalLedgerAccounts(tx, principal.id);
      const system = await ensureSystemLedgerAccounts(tx);

      // M2 全局账本锁和双分录由 canonical posting engine 维护，不另造入账路径。
      await postLedgerTransactionInTransaction(tx, {
        type: 'reserve',
        referenceType: 'protocol_incentive_budget',
        referenceId: unique('r8-p1j-budget'),
        idempotencyKey: unique('credit:r8-p1j-pool'),
        metadata: { creditSource: 'protocol_incentive_pool', details: null },
        entries: [
          { accountId: system.system_reserve.id, side: 'debit', amount: '6.00000004' },
          { accountId: system.system_incentive.id, side: 'credit', amount: '6.00000004' },
        ],
      });

      const common = {
        system, available: accounts.principal_available, principalId: principal.id, programId,
      };
      const first = await awardInRollbackTransaction(tx, {
        ...common, awardId: 'award-1', amount: '1.00000001',
      });
      await awardInRollbackTransaction(tx, {
        ...common, awardId: 'award-2', amount: '2.00000002',
      });
      await awardInRollbackTransaction(tx, {
        ...common, programId: otherProgramId, awardId: 'award-3', amount: '3.00000000',
      });
      fixtureKey = first.idempotencyKey;

      const summary = await inspectPostedIncentiveBudgetCoverageDraft(tx, { programId });
      assert.equal(summary.programPostedSpendIwc, '3.00000003');
      assert.equal(summary.recognizedAwardCount,
        (BigInt(baseline.recognizedAwardCount) + 3n).toString());
      assert.equal(summary.postedCandidateCount,
        (BigInt(baseline.postedCandidateCount) + 3n).toString());
      assert.equal(units(summary.allPoolDebitIwc) - units(baseline.allPoolDebitIwc),
        units('6.00000003'));
      assert.equal(summary.economicWritePermitted, false);
      assert.equal(summary.r8RiskEvaluationEligible, false);
      assert.equal((await inspectPostedIncentiveBudgetCoverageDraft(tx, {
        programId: otherProgramId,
      })).programPostedSpendIwc, '3.00000000');

      const replay = await awardInRollbackTransaction(tx, {
        ...common, awardId: 'award-1', amount: '1.00000001',
      });
      assert.equal(replay.id, first.id, '重复奖励命令应命中原始 M2 幂等事实');
      assert.deepEqual(await inspectPostedIncentiveBudgetCoverageDraft(tx, { programId }), summary);

      // 旧 M2 允许分隔符歧义的 Award ID，但 P1i 必须拒绝把它计算成可信预算。
      await awardInRollbackTransaction(tx, {
        ...common, awardId: 'ambiguous:legacy', amount: '0.00000001',
      });
      await assert.rejects(
        () => inspectPostedIncentiveBudgetCoverageDraft(tx, { programId }),
        (error) => error instanceof IncentivePostedBudgetCoverageDraftError &&
          error.field === 'unclassifiedCandidateCount',
      );
      exercised = true;
      throw rollback;
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 60_000 }),
    (error) => error === rollback,
  );

  assert.equal(exercised, true, '所有 PostgreSQL 断言均应在回滚前执行');
  assert.equal(await prisma.ledgerTransaction.count({ where: { idempotencyKey: fixtureKey } }), 0,
    '回滚后不得留存测试经济事实');
});
