import assert from 'node:assert/strict';
import test from 'node:test';

import { INTEGRITY_RULE_CODES } from '../src/lib/integrity/integrity-signal.mjs';
import {
  GENESIS_CREDIT_LOOP_POLICY,
  GENESIS_CREDIT_LOOP_RULE_VERSION,
  classifyGenesisCreditLoop,
  evaluateGenesisCreditLoop,
} from '../src/lib/integrity/genesis-credit-loop.mjs';

const START = new Date('2026-09-20T00:00:00.000Z');
const END = new Date('2026-09-24T00:00:00.000Z');
const GENESIS_HASH = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

function facts(overrides = {}) {
  return {
    principalAId: 'a', principalBId: 'b', principalCId: 'c',
    aToBSettlementCount: 1, bToCSettlementCount: 1, cToASettlementCount: 1,
    aToBAmount: '50.00000000', bToCAmount: '40.00000000', cToAAmount: '30.00000000',
    basisStart: START, basisEnd: END,
    ...overrides,
  };
}

function issuance(principals = [
  { principalId: 'a', issuanceCount: 1, issuedAmount: '80.00000000' },
  { principalId: 'b', issuanceCount: 0, issuedAmount: '0.00000000' },
  { principalId: 'c', issuanceCount: 0, issuedAmount: '0.00000000' },
]) {
  return {
    sourceFactLayer: ['ledger_transactions', 'ledger_entries', 'ledger_accounts'],
    provenanceVersion: 'iwantu-credit-provenance/0.1',
    capitalLineageTraced: false,
    before: START,
    principals: principals.map((row) => ({ ...row,
      transactionHashes: row.issuanceCount > 0 ? [GENESIS_HASH] : [],
    })),
  };
}

function sqlText(query) {
  return Array.isArray(query?.strings) ? query.strings.join(' ') : String(query);
}

function fakePrisma(cycle, postedGenesis = [
  { principalId: 'a', issuanceCount: 1, issuedAmount: '80.00000000', transactionHashes: [GENESIS_HASH] },
]) {
  const calls = [];
  return {
    calls,
    async $queryRaw(query) {
      const text = sqlText(query);
      const values = [...(query.values ?? [])];
      calls.push({ text, values });
      if (text.includes('FROM "reputation_evidence"')) return [cycle];
      if (text.includes('FROM "ledger_entries"')) return postedGenesis;
      if (text.includes('"iwantu_emit_integrity_signal"')) return [{ id: 'intsig:r7:' + values[0] }];
      throw Error('Unexpected R7 query: ' + text);
    },
  };
}

test('R7: 显式版本和 Genesis 收款主体共现阈值，复用 R5 环形交易口径', () => {
  assert.equal(GENESIS_CREDIT_LOOP_RULE_VERSION, 'iwantu.integrity-rule.r7/0.1');
  assert.deepEqual(GENESIS_CREDIT_LOOP_POLICY, {
    minEdgeSettlements: 1,
    minTotalSettlements: 3,
    minGrossAmount: '100.00000000',
    minEdgeShareBps: 2000,
    minGenesisPrincipals: 1,
    minGenesisIssuedAmount: '1.00000000',
  });
});

test('R7: Genesis 发行在先且三方真实结算形成定向闭环时，仅产生观察性判定', () => {
  const result = classifyGenesisCreditLoop(facts(), issuance());
  assert.equal(result.ruleCode, INTEGRITY_RULE_CODES.GENESIS_CREDIT_LOOP);
  assert.equal(result.scope, 'principal');
  assert.equal(result.signalClass, 'economic_flow');
  assert.equal(result.grossAmount, '120.00000000');
  assert.equal(result.genesisPrincipalCount, 1);
  assert.equal(result.genesisIssuedAmount, '80.00000000');
  assert.deepEqual(result.genesisIssuance[0].transactionHashes, [GENESIS_HASH]);
  assert.equal(result.capitalLineageTraced, false);
  assert.equal(result.relationshipType, 'genesis_recipient_in_circular_settlement_flow');
  assert.deepEqual(result.principalIds, ['a', 'b', 'c']);
});

test('R7: 交易环、发行条件缺失或严重偏向单边时不产生风险信号', () => {
  assert.equal(classifyGenesisCreditLoop(facts({ cToASettlementCount: 0 }), issuance()), null);
  assert.equal(classifyGenesisCreditLoop(facts({ aToBAmount: '15', bToCAmount: '10', cToAAmount: '10' }), issuance()), null);
  assert.equal(classifyGenesisCreditLoop(facts({
    aToBAmount: '90', bToCAmount: '5', cToAAmount: '5',
  }), issuance()), null);
  assert.equal(classifyGenesisCreditLoop(facts(), issuance([
    { principalId: 'a', issuanceCount: 0, issuedAmount: '0.00000000' },
    { principalId: 'b', issuanceCount: 0, issuedAmount: '0.00000000' },
    { principalId: 'c', issuanceCount: 0, issuedAmount: '0.00000000' },
  ])), null);
  assert.equal(classifyGenesisCreditLoop(facts(), issuance([
    { principalId: 'a', issuanceCount: 1, issuedAmount: '0.50000000' },
    { principalId: 'b', issuanceCount: 0, issuedAmount: '0.00000000' },
    { principalId: 'c', issuanceCount: 0, issuedAmount: '0.00000000' },
  ])), null);
});

test('R7: 三方有向循环旋转不影响确定性证据，反向环保留不同有向边', () => {
  const first = classifyGenesisCreditLoop(facts(), issuance());
  const rotated = classifyGenesisCreditLoop(facts({
    principalAId: 'b', principalBId: 'c', principalCId: 'a',
    aToBSettlementCount: 1, bToCSettlementCount: 1, cToASettlementCount: 1,
    aToBAmount: '40', bToCAmount: '30', cToAAmount: '50',
  }), issuance());
  assert.deepEqual(first, rotated);
  const backwards = classifyGenesisCreditLoop(facts({
    principalAId: 'a', principalBId: 'c', principalCId: 'b',
    aToBAmount: '50', bToCAmount: '40', cToAAmount: '30',
  }), issuance());
  assert.notDeepEqual(first.edges, backwards.edges);
});

test('R7: 真实 Ledger 发放事实 + 供应方经济证据，逐主体写入可解释 IntegritySignal', async () => {
  const prisma = fakePrisma(facts());
  const result = await evaluateGenesisCreditLoop(prisma, {
    principalAId: 'b', principalBId: 'c', principalCId: 'a',
  });
  assert.equal(result.matched, true);
  assert.equal(result.signals.length, 3);
  assert.deepEqual(result.signals.map((signal) => signal.id), [
    'intsig:r7:a', 'intsig:r7:b', 'intsig:r7:c',
  ]);
  const settlementQuery = prisma.calls[0].text;
  const ledgerQuery = prisma.calls[1].text;
  assert.match(settlementQuery, /FROM "reputation_evidence"/);
  assert.match(settlementQuery, /"evidenceClass" = 'economic'/);
  assert.match(settlementQuery, /"subjectRole" = 'supplier'/);
  assert.doesNotMatch(settlementQuery, /genesisOriginAmount/);
  assert.match(ledgerQuery, /FROM "ledger_entries"/);
  assert.match(ledgerQuery, /t\."type" = 'genesis'/);
  assert.match(ledgerQuery, /t\."status" = 'posted'/);
  const emissions = prisma.calls.filter((call) => call.text.includes('"iwantu_emit_integrity_signal"'));
  assert.equal(emissions.length, 3);
  const evidence = JSON.parse(emissions[0].values[6]);
  const metrics = JSON.parse(emissions[0].values[7]);
  assert.equal(evidence.capitalLineageTraced, false);
  assert.equal(evidence.provenanceVersion, 'iwantu-credit-provenance/0.1');
  assert.match(evidence.interpretation, /observation_only/);
  assert.equal(metrics.genesisPrincipalCount, 1);
  assert.equal(metrics.genesisIssuedAmount, '80.00000000');
  assert.deepEqual(metrics.genesisIssuance[0].transactionHashes, [GENESIS_HASH]);
  assert.equal(metrics.automaticPunishmentApplied, false);
  assert.equal(metrics.capitalLineageTraced, false);
});

test('R7: 只有 Incentive/后发 Genesis 不构成判定，查询过程不可变更账本和信誉', async () => {
  const prisma = fakePrisma(facts(), []);
  const result = await evaluateGenesisCreditLoop(prisma, {
    principalAId: 'a', principalBId: 'b', principalCId: 'c',
  });
  assert.equal(result.matched, false);
  assert.equal(result.signals.length, 0);
  assert.equal(prisma.calls.some((call) =>
    /\b(UPDATE|DELETE|TRUNCATE)\b|INSERT INTO "ledger_|INSERT INTO "reputation_evidence"/i.test(call.text)), false);
});

test('R7: 精确重放应生成一致的信号输入（数据库级幂等仍需 PostgreSQL gate）', async () => {
  const prisma = fakePrisma(facts());
  const input = { principalAId: 'a', principalBId: 'b', principalCId: 'c' };
  await evaluateGenesisCreditLoop(prisma, input);
  await evaluateGenesisCreditLoop(prisma, input);
  const writes = prisma.calls.filter((call) => call.text.includes('"iwantu_emit_integrity_signal"'));
  assert.deepEqual(writes.slice(0, 3), writes.slice(3, 6));
});

test('R7: 不合法主体、伪造发放记录和不一致的观察时点一律拒绝', async () => {
  assert.throws(() => classifyGenesisCreditLoop(facts({ principalCId: 'a' }), issuance()), /three distinct Principals/);
  assert.throws(() => classifyGenesisCreditLoop(facts(), issuance([
    { principalId: 'a', issuanceCount: 1, issuedAmount: '5' },
    { principalId: 'a', issuanceCount: 0, issuedAmount: '0' },
    { principalId: 'c', issuanceCount: 0, issuedAmount: '0' },
  ])), /subjects must match/);
  assert.throws(() => classifyGenesisCreditLoop(facts(), { ...issuance(), before: END }), /prior Genesis ledger/);
  assert.throws(() => classifyGenesisCreditLoop(facts(), { ...issuance(), capitalLineageTraced: true }), /prior Genesis ledger/);
  assert.throws(() => classifyGenesisCreditLoop(facts(), issuance(), {
    ...GENESIS_CREDIT_LOOP_POLICY, minGenesisPrincipals: 4,
  }), /thresholds are inconsistent/);
  const prisma = fakePrisma(facts());
  await assert.rejects(() => evaluateGenesisCreditLoop(prisma, {
    principalAId: 'a', principalBId: 'a', principalCId: 'c',
  }), /three distinct Principals/);
  assert.equal(prisma.calls.length, 0);
});
