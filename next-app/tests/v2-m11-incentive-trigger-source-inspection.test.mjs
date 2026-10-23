import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIncentiveTriggerBindingDraft, INCENTIVE_TRIGGER_BINDING_DRAFT_VERSION } from '../src/lib/integrity/incentive-trigger-binding-draft.mjs';
import { inspectIncentiveTriggerSourceFacts, IncentiveTriggerSourceInspectionError } from '../src/lib/integrity/incentive-trigger-source-inspection.mjs';

const h = (symbol) => symbol.repeat(64);
function draft() {
  return buildIncentiveTriggerBindingDraft({
    protocol: INCENTIVE_TRIGGER_BINDING_DRAFT_VERSION,
    awardLedgerTransactionId: 'ledger-award-1', awardTransactionHash: h('a'),
    programId: 'settlement-incentive', programPolicyVersion: 'v1', programPolicyHash: h('b'),
    awardId: 'award.001', beneficiaryPrincipalId: 'principal-supplier',
    amountIwc: '12.00000000', currency: 'IWC', triggerType: 'terminal_settlement',
    settlementId: 'terminal-settlement-1', settlementHash: h('c'), triggerEvidenceHash: h('d'),
    authorityEvidence: { type: 'policy_authorization_reference', receiptId: 'authority-1',
      receiptHash: h('e'), beneficiaryPrincipalId: 'principal-supplier', programPolicyHash: h('b') },
    createdAt: '2026-10-24T00:00:00.000Z',
  });
}
function row() {
  return { ledgerTransactionId: 'ledger-award-1', awardTransactionHash: h('a'),
    awardPostedAt: new Date('2026-10-24T00:00:00.000Z'), settlementId: 'terminal-settlement-1',
    settlementHash: h('c'), settlementCreatedAt: new Date('2026-10-23T23:00:00.000Z'),
    amountIwc: '12.00000000' };
}
function mock(rows = [row()]) {
  const calls = [];
  const db = { $queryRaw: async (parts, ...values) => { calls.push({ sql: parts.join('?'), values }); return rows; } };
  return { db, calls };
}

test('B2预检：只读匹配账本和终局Settlement后仍保持不可归因、无处罚', async () => {
  const { db, calls } = mock();
  const receipt = draft();
  const result = await inspectIncentiveTriggerSourceFacts(db, receipt);
  assert.equal(result.receiptHash, receipt.receiptHash);
  assert.equal(result.sourceFactConsistency, 'matched');
  assert.equal(result.attributionStatus, 'unavailable');
  assert.equal(result.policyAuthorizationVerified, false);
  assert.equal(result.bindingReceiptPersisted, false);
  assert.equal(result.r8RiskEvaluationEligible, false);
  assert.equal(result.automaticPunishmentApplied, false);
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /FROM "ledger_transactions" t/);
  assert.match(calls[0].sql, /JOIN "settlements" s/);
  assert.match(calls[0].sql, /COUNT\(\*\).*"ledger_entries"/s);
  assert.match(calls[0].sql, /s\."createdAt" <= t\."postedAt"/);
  assert.match(calls[0].sql, /CAST\(\? AS numeric\(36,8\)\)/);
  assert.doesNotMatch(calls[0].sql, /\bINSERT\b|\bUPDATE\b|\bDELETE\b/i);
  for (const id of [receipt.evidence.awardLedgerTransactionId, receipt.evidence.settlementId]) {
    assert.ok(calls[0].values.includes(id));
    assert.equal(calls[0].sql.includes(id), false);
  }
});

test('B2预检：零行、重复行、非数组结果均 Fail-Closed', async () => {
  for (const rows of [[], [row(),row()], null, {}]) {
    await assert.rejects(() => inspectIncentiveTriggerSourceFacts(mock(rows).db, draft()), IncentiveTriggerSourceInspectionError);
  }
});

test('B2预检：伪造哈希、金额、结算以及时间倒置拒绝', async () => {
  for (const changes of [
    { awardTransactionHash: h('f') }, { amountIwc: '13.00000000' },
    { settlementHash: h('f') }, { settlementId: 'different-settlement' },
    { awardPostedAt: new Date('2026-10-23T22:00:00.000Z') },
    { awardPostedAt: '2026-10-24T00:00:00.000Z' },
  ]) {
    await assert.rejects(() => inspectIncentiveTriggerSourceFacts(mock([{...row(),...changes}]).db, draft()), IncentiveTriggerSourceInspectionError);
  }
});

test('B2预检：收据哈希篡改和缺失数据库客户端不会被接受', async () => {
  const receipt = draft();
  await assert.rejects(() => inspectIncentiveTriggerSourceFacts(mock().db, {...receipt, receiptHash:h('f')}));
  await assert.rejects(() => inspectIncentiveTriggerSourceFacts({}, receipt), IncentiveTriggerSourceInspectionError);
});

test('B2预检：改变政策引用仍无法冒充数据库验证过的政策授权', async () => {
  const input = draft();
  const altered = buildIncentiveTriggerBindingDraft({
    ...input.evidence,
    programPolicyVersion: 'v2',
    programPolicyHash: h('f'),
    authorityEvidence: {...input.evidence.authorityEvidence, programPolicyHash:h('f')},
  });
  const result = await inspectIncentiveTriggerSourceFacts(mock().db, altered);
  assert.equal(result.policyAuthorizationVerified, false);
  assert.equal(result.attributionStatus, 'unavailable');
  assert.notEqual(result.receiptHash, input.receiptHash);
});
