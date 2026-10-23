import assert from 'node:assert/strict';
import test from 'node:test';
import { readIncentiveAwardFacts, INCENTIVE_AWARD_FACTS_VERSION } from '../src/lib/integrity/incentive-award-facts.mjs';

const START = new Date('2026-09-01T00:00:00.000Z');
const END = new Date('2026-10-01T00:00:00.000Z');
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const input = { principalIds: ['b', 'a'], windowStart: START, windowEnd: END };
function award(overrides = {}) {
  return { principalId: 'a', programId: 'onboarding', awardId: 'award-1',
    referenceId: 'onboarding:award-1', transactionHash: HASH_A,
    postedAt: new Date('2026-09-10T00:00:00.000Z'), amount: '12.00000000', ...overrides };
}
function mock(rows) {
  const calls = [];
  return { calls, async $queryRaw(q) { calls.push(q); return rows; } };
}
function sql(q) { return Array.isArray(q?.strings) ? q.strings.join(' ') : String(q); }

test('R8：真实已入账奖励 + Incentive 池借方约束，查询仅包含 SELECT', async () => {
  const client = mock([award()]);
  const result = await readIncentiveAwardFacts(client, input);
  assert.equal(result.factsVersion, INCENTIVE_AWARD_FACTS_VERSION);
  assert.equal(result.automaticPunishmentApplied, false);
  assert.equal(result.capitalLineageTraced, false);
  assert.equal(result.triggerEventAttribution, 'unavailable');
  assert.equal(result.r8RiskEvaluationEligible, false);
  assert.equal(result.records.length, 1);
  assert.deepEqual(result.principalIds, ['a', 'b']);
  const statement = sql(client.calls[0]);
  assert.match(statement, /FROM "ledger_transactions"/);
  assert.match(statement, /JOIN "ledger_entries"/);
  assert.match(statement, /t\."type" = 'incentive'/);
  assert.match(statement, /t\."status" = 'posted'/);
  assert.match(statement, /e\."provenance" ->> 'kind' = 'incentive'/);
  assert.match(statement, /e\."provenance" ->> 'programId' = t\."metadata" ->> 'programId'/);
  assert.match(statement, /e\."provenance" ->> 'awardId' = t\."metadata" ->> 'awardId'/);
  assert.match(statement, /pool\."type" = 'system_incentive'/);
  assert.match(statement, /pool\."principalId" IS NULL/);
  assert.ok(statement.includes("t.\"idempotencyKey\" = 'credit:incentive-award:' || t.\"referenceId\""));
  assert.ok(statement.includes('COUNT(*) FROM "ledger_entries" legs'));
  assert.match(statement, /LIMIT/);
  assert.doesNotMatch(statement, /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b/i);
});

test('R8：合法重复奖励仍为独立事实且结果按时间和哈希稳定排序', async () => {
  const second = award({awardId:'award-2', referenceId:'onboarding:award-2',transactionHash:HASH_B,
    postedAt: new Date('2026-09-20T00:00:00.000Z')});
  const one = await readIncentiveAwardFacts(mock([second, award()]), input);
  const two = await readIncentiveAwardFacts(mock([award(), second]), {...input, principalIds:['a','b']});
  assert.deepEqual(one, two);
  assert.deepEqual(one.records.map(x=>x.awardId), ['award-1','award-2']);
});

test('R8：非法筛选范围必须在 SQL 执行前拒绝', async () => {
  const client = mock([]);
  for (const bad of [
    {...input, principalIds:['a','a']},
    {...input, principalIds:[' a','b']},
    {...input, windowEnd: START},
    {...input, windowStart:new Date('invalid')},
    {...input, limit:501},
    {...input, limit:0},
  ]) await assert.rejects(()=>readIncentiveAwardFacts(client,bad));
  assert.equal(client.calls.length, 0);
});

test('R8：伪造凭证、跨主体、时间越界、零额及超上限均 Fail-Closed', async () => {
  const bad = [
    award({principalId:'x'}),
    award({programId:'other'}),
    award({transactionHash:'NOT_HASH'}),
    award({postedAt:END}),
    award({postedAt:new Date(START.getTime()-1)}),
    award({amount:'0.00000000'}),
    award({amount:'-1'}),
  ];
  for(const row of bad) await assert.rejects(()=>readIncentiveAwardFacts(mock([row]),input));
  await assert.rejects(()=>readIncentiveAwardFacts(mock([award(), award()]),input));
  await assert.rejects(()=>readIncentiveAwardFacts(mock([award(), award({transactionHash:HASH_B})]),{...input,limit:1}));
});

test('R8：激励事实只读，不将频次、集中度或结算金额写为舞弊裁决', async () => {
  const result = await readIncentiveAwardFacts(mock([award()]), input);
  assert.equal('ruleCode' in result, false);
  assert.equal('signals' in result, false);
  assert.equal('integrityVerdict' in result, false);
  assert.equal(result.triggerEventAttribution, 'unavailable');
  assert.equal(result.r8RiskEvaluationEligible, false);
});
