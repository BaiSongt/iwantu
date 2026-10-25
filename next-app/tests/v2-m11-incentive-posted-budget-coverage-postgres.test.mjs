import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { requireR8PostgresTestTarget } from './helpers/r8-postgres-test-target.mjs';
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
  requireR8PostgresTestTarget();
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


test('R8-P1k 真库：非激励交易伪造 Incentive Credit 来源必须完整扫描并拒绝', async () => {
  const programId = unique('r8-p1k-forged-program');
  const sourceReferenceId = unique('r8-p1k-forged-award');
  const idempotencyKey = unique('credit:r8-p1k-forged-provenance');
  const rollback = new Error('R8_P1K_ROLLBACK_ONLY');
  let exercised = false;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const baseline = await inspectPostedIncentiveBudgetCoverageDraft(tx, { programId });
      assert.equal(baseline.programPostedSpendIwc, '0.00000000');

      const organization = await tx.organization.create({
        data: { name: unique('R8 P1k rollback org'), type: 'buyer' },
      });
      const principal = await tx.principal.create({
        data: { type: 'organization', organizationId: organization.id },
      });
      const accounts = await ensurePrincipalLedgerAccounts(tx, principal.id);
      const system = await ensureSystemLedgerAccounts(tx);

      // 故意使用普通 reserve 交易和 Reserve 借方，不能让伪造的来源冒充真实 Incentive 发奖。
      // 当前 M2 只负责通用双分录入账，R8 候选审计必须独立拒绝此类 Credit provenance。
      await postLedgerTransactionInTransaction(tx, {
        type: 'reserve',
        referenceType: 'r8_audit_forged_source',
        referenceId: sourceReferenceId,
        idempotencyKey,
        metadata: { creditSource: 'r8_audit_forged_source', details: null },
        entries: [
          { accountId: system.system_reserve.id, side: 'debit', amount: '0.00000001' },
          {
            accountId: accounts.principal_available.id,
            side: 'credit',
            amount: '0.00000001',
            provenance: buildCreditProvenance({
              kind: 'incentive',
              beneficiaryPrincipalId: principal.id,
              sourceReferenceType: 'protocol_incentive_award',
              sourceReferenceId,
              programId,
              awardId: 'forged-credit',
            }),
          },
        ],
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

  assert.equal(exercised, true, '伪造来源拒绝断言必须在回滚前完成');
  assert.equal(await prisma.ledgerTransaction.count({ where: { idempotencyKey } }), 0,
    '回滚后不得保留伪造来源的经济记录');
});

test('R8-P1j/P1l 真库：奖池异常借方、来源类型及元数据激励伪造均拒绝覆盖', async () => {
  // 每个负例使用单独回滚事务，避免前一异常掩盖另一条检测条件。
  for (const scenario of ['pool_debit_without_award', 'forged_source_type_only', 'metadata_incentive_origin_only']) {
    const programId = unique('r8-p1j-' + scenario);
    const idempotencyKey = unique('credit:r8-p1j-' + scenario);
    const rollback = new Error('R8_P1J_NEGATIVE_ROLLBACK_ONLY');
    let exercised = false;

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const baseline = await inspectPostedIncentiveBudgetCoverageDraft(tx, { programId });
        assert.equal(baseline.unclassifiedCandidateCount, '0');
        const organization = await tx.organization.create({
          data: { name: unique('R8 P1j rollback org'), type: 'buyer' },
        });
        const principal = await tx.principal.create({
          data: { type: 'organization', organizationId: organization.id },
        });
        const accounts = await ensurePrincipalLedgerAccounts(tx, principal.id);
        const system = await ensureSystemLedgerAccounts(tx);
        let debitAccountId = system.system_reserve.id;
        let provenance;

        if (scenario === 'pool_debit_without_award') {
          // 从有限奖池挪出非发奖交易，必须作为未分类支出拒绝。
          await postLedgerTransactionInTransaction(tx, {
            type: 'reserve', referenceType: 'protocol_incentive_budget',
            referenceId: unique('r8-p1j-funding'),
            idempotencyKey: unique('credit:r8-p1j-funding'),
            metadata: { creditSource: 'protocol_incentive_pool', details: null },
            entries: [
              { accountId: system.system_reserve.id, side: 'debit', amount: '0.00000001' },
              { accountId: system.system_incentive.id, side: 'credit', amount: '0.00000001' },
            ],
          });
          debitAccountId = system.system_incentive.id;
        } else if (scenario === 'forged_source_type_only') {
          // kind=earned，但仅 sourceReferenceType 冒充协议奖励来源。
          provenance = buildCreditProvenance({
            kind: 'earned', beneficiaryPrincipalId: principal.id,
            sourceReferenceType: 'protocol_incentive_award',
            sourceReferenceId: unique('r8-p1j-fake-source'),
            contractId: unique('r8-p1j-fake-contract'),
          });
        }

        await postLedgerTransactionInTransaction(tx, {
          type: 'reserve', referenceType: 'r8_audit_negative_' + scenario,
          referenceId: unique('r8-p1j-negative'), idempotencyKey,
          // 第三负例不造假 Credit provenance，仅通过 metadata.creditSource 冒充发奖。
          metadata: {
            creditSource: scenario === 'metadata_incentive_origin_only'
              ? 'incentive' : 'r8_audit_negative_test',
            details: null,
          },
          entries: [
            { accountId: debitAccountId, side: 'debit', amount: '0.00000001' },
            { accountId: accounts.principal_available.id, side: 'credit',
              amount: '0.00000001', ...(provenance ? { provenance } : {}) },
          ],
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
    assert.equal(exercised, true, scenario + ' 必须执行审计拒绝断言');
    assert.equal(await prisma.ledgerTransaction.count({ where: { idempotencyKey } }), 0,
      scenario + ' 回滚后不得留下经济事实');
  }
});


test('R8-P1n 真库：格式完整但额外携带伪授权字段的 Incentive provenance 必须拒绝', async () => {
  const programId = unique('r8-p1n-program');
  const awardId = 'award-1';
  const referenceId = programId + ':' + awardId;
  const idempotencyKey = 'credit:incentive-award:' + referenceId;
  const rollback = new Error('R8_P1N_ROLLBACK_ONLY');
  let exercised = false;

  await assert.rejects(
    prisma.$transaction(async (tx) => {
      const baseline = await inspectPostedIncentiveBudgetCoverageDraft(tx, { programId });
      assert.equal(baseline.unclassifiedCandidateCount, '0');
      const organization = await tx.organization.create({
        data: { name: unique('R8 P1n rollback org'), type: 'buyer' },
      });
      const principal = await tx.principal.create({
        data: { type: 'organization', organizationId: organization.id },
      });
      const accounts = await ensurePrincipalLedgerAccounts(tx, principal.id);
      const system = await ensureSystemLedgerAccounts(tx);
      await postLedgerTransactionInTransaction(tx, {
        type: 'reserve', referenceType: 'protocol_incentive_budget',
        referenceId: unique('r8-p1n-funding'),
        idempotencyKey: unique('credit:r8-p1n-funding'),
        metadata: { creditSource: 'protocol_incentive_pool', details: null },
        entries: [
          { accountId: system.system_reserve.id, side: 'debit', amount: '0.00000001' },
          { accountId: system.system_incentive.id, side: 'credit', amount: '0.00000001' },
        ],
      });
      // M2 通用 Ledger 允许携带额外 JSON 键，但 R8 v0.1 来源认证不得采信此类伪造授权。
      await postLedgerTransactionInTransaction(tx, {
        type: 'incentive', referenceType: 'protocol_incentive_award',
        referenceId, idempotencyKey,
        metadata: { programId, awardId, beneficiaryPrincipalId: principal.id, details: null },
        entries: [
          { accountId: system.system_incentive.id, side: 'debit', amount: '0.00000001' },
          { accountId: accounts.principal_available.id, side: 'credit', amount: '0.00000001',
            provenance: {
              ...buildCreditProvenance({
                kind: 'incentive', beneficiaryPrincipalId: principal.id,
                sourceReferenceType: 'protocol_incentive_award', sourceReferenceId: referenceId,
                programId, awardId,
              }),
              policyAuthorityVerified: true,
            },
          },
        ],
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
  assert.equal(exercised, true, '附加伪授权字段的真实账本拒绝断言必须执行');
  assert.equal(await prisma.ledgerTransaction.count({ where: { idempotencyKey } }), 0,
    '回滚后不得留下测试发奖事实');
});
