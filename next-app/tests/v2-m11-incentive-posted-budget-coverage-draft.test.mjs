import assert from 'node:assert/strict';
import test from 'node:test';
import {
  inspectPostedIncentiveBudgetCoverageDraft as inspect,
  IncentivePostedBudgetCoverageDraftError as BudgetError,
} from '../src/lib/integrity/incentive-posted-budget-coverage-draft.mjs';

const empty = () => ({
  postedCandidateCount: '0', recognizedAwardCount: '0',
  unclassifiedCandidateCount: '0', allPoolDebitIwc: '0', programPostedSpendIwc: '0',
});

function mock(row = empty()) {
  const calls = [];
  const db = {$queryRaw: async (parts, ...values) => {
    calls.push({sql: parts.join('?'), values});
    return [row];
  }};
  return {db, calls};
}

const reject = async (db, input = {programId: 'program-1'}) => {
  await assert.rejects(() => inspect(db, input), BudgetError);
};

test('P1i：空历史全量账本返回零金额，不将结果提升为预算授权', async () => {
  const result = await inspect(mock().db, {programId: 'program-1'});
  assert.equal(result.programPostedSpendIwc, '0.00000000');
  assert.equal(result.protocol, 'iwantu.incentive-posted-budget-coverage/0.4');
  assert.equal(result.allPoolDebitIwc, '0.00000000');
  assert.equal(result.auditStatus, 'no_unclassified_posted_candidates_in_query_snapshot');
  assert.equal(result.budgetAuthorityStatus, 'not_checked');
  assert.equal(result.programGovernanceStatus, 'not_checked');
  assert.equal(result.immutableTriggerAttributionStatus, 'unavailable');
  assert.equal(result.economicWritePermitted, false);
  assert.equal(result.r8RiskEvaluationEligible, false);
  assert.equal(result.automaticPunishmentApplied, false);
});

test('P1i：跨奖励和 Program 的真实 posted 金额以精确字符串返回', async () => {
  const result = await inspect(mock({
    postedCandidateCount: '3', recognizedAwardCount: '3', unclassifiedCandidateCount: '0',
    allPoolDebitIwc: '200.00000001', programPostedSpendIwc: '102.40000001',
  }).db, {programId: 'program-1'});
  assert.equal(result.programPostedSpendIwc, '102.40000001');
  assert.equal(result.allPoolDebitIwc, '200.00000001');
  assert.equal(result.recognizedAwardCount, '3');
});

test('P1k：SQL 全量覆盖 POSTED 激励、奖池借方及伪造来源，不采用观察窗、用户过滤、LIMIT', async () => {
  const {db, calls} = mock();
  await inspect(db, {programId: 'program-1'});
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, ['program-1']);
  const sql = calls[0].sql;
  assert.match(sql, /FROM "ledger_transactions" t/);
  assert.match(sql, /FROM "ledger_entries" e/);
  assert.match(sql, /a\."type" = 'system_incentive'/);
  assert.match(sql, /t\."status" = 'posted'/);
  assert.match(sql, /t\."type" = 'incentive' OR t\."referenceType" = 'protocol_incentive_award'/);
  assert.match(sql, /t\."metadata" ->> 'creditSource' = 'incentive'/);
  assert.match(sql, /p\."poolDebitCount" > 0 OR p\."incentiveProvenanceCreditCount" > 0/);
  assert.match(sql, /e\."provenance" ->> 'kind' = 'incentive'/);
  assert.match(sql, /e\."provenance" ->> 'sourceReferenceType' = 'protocol_incentive_award'/);
  assert.match(sql, /COUNT\(\*\) FILTER \(WHERE NOT COALESCE\("recognized", FALSE\)\)/);
  assert.match(sql, /WHERE "recognized" AND "programId" = \?/);
  for (const forbidden of [/\bLIMIT\b/i, /\bOFFSET\b/i, /\bINSERT\b/i, /\bUPDATE\b/i, /\bDELETE\b/i, /windowStart/, /principalIds/]) {
    assert.doesNotMatch(sql, forbidden);
  }
  assert.ok(!sql.includes('program-1'), 'Program 必须通过参数绑定');
});

test('P1i：SQL 逐笔检查 M2 双分录、provenance、哈希和 idempotency', async () => {
  const {db, calls} = mock();
  await inspect(db, {programId: 'program-1'});
  const sql = calls[0].sql;
  assert.match(sql, /"entryCount" = 2/);
  assert.match(sql, /"poolDebitCount" = 1 AND c\."poolValidCount" = 1/);
  assert.match(sql, /"matchedCreditCount" = 1/);
  assert.match(sql, /"incentiveProvenanceCreditCount" = 1/);
  assert.match(sql, /"matchedCreditAmount" = c\."poolDebitAmount"/);
  assert.match(sql, /"idempotencyKey" = 'credit:incentive-award:' \|\| c\."referenceId"/);
  assert.match(sql, /"transactionHash" ~ '\^\[0-9a-f\]\{64\}\$'/);
  assert.match(sql, /"provenance" ->> 'schemaVersion'/);
  assert.match(sql, /c\."programId" ~ '\^\[A-Za-z0-9\]/);
  assert.match(sql, /c\."awardId" ~ '\^\[A-Za-z0-9\]/);
});

test('P1i：历史激励归属缺失、奖池异常转出或其他未分类交易全部 Fail-Closed', async () => {
  for (const count of ['1', '3']) {
    await reject(mock({
      postedCandidateCount: count, recognizedAwardCount: '0', unclassifiedCandidateCount: count,
      allPoolDebitIwc: '100.00000000', programPostedSpendIwc: '0',
    }).db);
  }
});

test('P1k：伪造激励来源但未借记 Incentive 奖池的非激励交易必须 Fail-Closed', async () => {
  const {db, calls} = mock({
    postedCandidateCount: '1', recognizedAwardCount: '0', unclassifiedCandidateCount: '1',
    allPoolDebitIwc: '0', programPostedSpendIwc: '0',
  });
  await assert.rejects(() => inspect(db, {programId: 'program-1'}),
    (error) => error instanceof BudgetError && error.field === 'unclassifiedCandidateCount');
  const sql = calls[0].sql;
  assert.match(sql, /t\."referenceType" = 'protocol_incentive_award'/);
  assert.match(sql, /p\."incentiveProvenanceCreditCount" > 0/);
  assert.match(sql, /c\."incentiveProvenanceCreditCount" = 1/);
});


test('P1l：非奖励交易仅在 metadata.creditSource 自称 incentive 时也纳入未分类审计', async () => {
  const { db, calls } = mock({
    postedCandidateCount: '1', recognizedAwardCount: '0',
    unclassifiedCandidateCount: '1', allPoolDebitIwc: '0', programPostedSpendIwc: '0',
  });
  await assert.rejects(() => inspect(db, { programId: 'program-1' }),
    (error) => error instanceof BudgetError && error.field === 'unclassifiedCandidateCount');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /t\."metadata" ->> 'creditSource' = 'incentive'/);
  assert.deepEqual(calls[0].values, ['program-1']);
});

test('P1i：拒绝行数错误、缺失结果和伪造计数', async () => {
  const input = {programId: 'program-1'};
  await reject({$queryRaw: async () => []}, input);
  await reject({$queryRaw: async () => [empty(), empty()]}, input);
  await reject({$queryRaw: async () => null}, input);
  await reject({$queryRaw: async () => [null]}, input);
  for (const patch of [
    {postedCandidateCount: 0}, {postedCandidateCount: '-1'},
    {postedCandidateCount: '1e5'}, {postedCandidateCount: '01'},
    {postedCandidateCount: '2', recognizedAwardCount: '3'},
    {postedCandidateCount: '2', recognizedAwardCount: '1', unclassifiedCandidateCount: '0'},
  ]) await reject(mock({...empty(), ...patch}).db, input);
});

test('P1i：金额绝不经 JS Number，异常精度、指数或越界一律拒绝', async () => {
  for (const patch of [
    {programPostedSpendIwc: '0.000000001'},
    {allPoolDebitIwc: '1e8'},
    {programPostedSpendIwc: 0.1},
    {allPoolDebitIwc: '-1.00000000'},
    {allPoolDebitIwc: '10000000000000000000000000000.00000000'},
    {programPostedSpendIwc: '2.00000000', allPoolDebitIwc: '1.00000000'},
  ]) await reject(mock({...empty(),...patch}).db);
});

test('P1i：非法 Program、污染对象与缺失查询客户端一律拒绝', async () => {
  const {db} = mock();
  for (const input of [null, {}, {programId:'a:b'}, {programId:'x;DROP TABLE'},
    {programId:' program-1'}, {programId:'program-1', verified:true},
    Object.assign(Object.create(null),{programId:'program-1'}),
    {programId:123}]) await reject(db, input);
  await reject({}, {programId: 'program-1'});
});

test('P1i：账本读失败不会退化成空预算/零历史支出', async () => {
  await assert.rejects(
    () => inspect({$queryRaw: async () => {throw new Error('database unavailable');}},
      {programId:'program-1'}),
    /database unavailable/,
  );
});


test('P1n：标准 Incentive Credit provenance 必须精确匹配 v0.1 字段集，拒绝附加授权伪字段', async () => {
  const { db, calls } = mock();
  const result = await inspect(db, { programId: 'program-1' });
  assert.equal(result.economicWritePermitted, false);
  const sql = calls[0].sql;
  // 匹配分录数量与金额的两处条件均不能接受自述的额外权限字段。
  const strictObjects = [...sql.matchAll(/e\."provenance"\s*=\s*jsonb_build_object\(([\s\S]*?)\n\s*\)/g)];
  assert.equal(strictObjects.length, 2);
  for (const [, argumentsText] of strictObjects) {
    // 仅对 jsonb_build_object 的键名逐项校验，避免误数其它 SQL 表达式中的 programId。
    const keys = [...argumentsText.matchAll(/^\s*'([A-Za-z]+)',/gm)].map((match) => match[1]);
    assert.deepEqual(keys, [
      'schemaVersion', 'kind', 'beneficiaryPrincipalId', 'sourceReferenceType',
      'sourceReferenceId', 'programId', 'awardId',
    ]);
  }
  assert.deepEqual(calls[0].values, ['program-1']);
});
