import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIncentiveTriggerBindingDraft, validateIncentiveTriggerBindingDraft,
  INCENTIVE_TRIGGER_BINDING_DRAFT_VERSION, IncentiveTriggerBindingDraftError } from '../src/lib/integrity/incentive-trigger-binding-draft.mjs';

const h = (symbol) => symbol.repeat(64);
const fixture = () => ({
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
const reject = (f) => assert.throws(f, IncentiveTriggerBindingDraftError);

test('B1：重排对象字段后仍产生同一规范收据，精确重放幂等', () => {
  const input = fixture();
  const first = buildIncentiveTriggerBindingDraft(input);
  const reversed = Object.fromEntries(Object.entries(input).reverse());
  reversed.authorityEvidence = Object.fromEntries(Object.entries(input.authorityEvidence).reverse());
  assert.deepEqual(buildIncentiveTriggerBindingDraft(reversed), first);
  assert.deepEqual(validateIncentiveTriggerBindingDraft(first), first);
  assert.match(first.receiptHash, /^[0-9a-f]{64}$/);
});

test('B1：金额/哈希/结算/政策/受益人变更均改变收据哈希', () => {
  const original = buildIncentiveTriggerBindingDraft(fixture()).receiptHash;
  for (const update of [
    {amountIwc:'12.00000001'}, {settlementHash:h('f')}, {programPolicyHash:h('f')},
    {awardTransactionHash:h('f')}, {awardId:'award.002'}, {settlementId:'terminal-settlement-2'},
    {beneficiaryPrincipalId:'principal-buyer'},
  ]) {
    const x = fixture(); Object.assign(x,update);
    if (update.programPolicyHash) x.authorityEvidence.programPolicyHash=update.programPolicyHash;
    if (update.beneficiaryPrincipalId) x.authorityEvidence.beneficiaryPrincipalId=update.beneficiaryPrincipalId;
    assert.notEqual(buildIncentiveTriggerBindingDraft(x).receiptHash,original);
  }
});

test('B1：不允许有歧义的 programId/awardId，不重解释旧幂等键', () => {
  for (const field of ['programId','awardId']) for (const id of ['a:b',' a','中 文','', 'a'.repeat(129)]) {
    reject(()=>buildIncentiveTriggerBindingDraft({...fixture(),[field]:id}));
  }
});

test('B1：跨主体、跨政策的自述授权引用即使字段格式合法，也应拒绝', () => {
  reject(()=>buildIncentiveTriggerBindingDraft({...fixture(),authorityEvidence:{...fixture().authorityEvidence,beneficiaryPrincipalId:'other'}}));
  reject(()=>buildIncentiveTriggerBindingDraft({...fixture(),authorityEvidence:{...fixture().authorityEvidence,programPolicyHash:h('f')}}));
  reject(()=>buildIncentiveTriggerBindingDraft({...fixture(),authorityEvidence:{...fixture().authorityEvidence,type:'unverified_claim'}}));
});

test('B1：拒绝不规范金额、时间、哈希和协议版本，不接受浮点自动舍入', () => {
  for (const amountIwc of ['0.00000000','01.00000000','1','1.1','1e3',1.00000001,'-1.00000000','1'.repeat(29) + '.00000000']) {
    reject(()=>buildIncentiveTriggerBindingDraft({...fixture(),amountIwc}));
  }
  for (const createdAt of ['2026-10-24','2026-02-30T00:00:00.000Z','2026-10-24T08:00:00+08:00']) {
    reject(()=>buildIncentiveTriggerBindingDraft({...fixture(),createdAt}));
  }
  reject(()=>buildIncentiveTriggerBindingDraft({...fixture(),settlementHash:h('A')}));
  reject(()=>buildIncentiveTriggerBindingDraft({...fixture(),protocol:'iwantu.incentive-trigger-binding/0.2'}));
});

test('B1：未知字段、污染对象原型、任意触发类型、伪造哈希拒绝', () => {
  reject(()=>buildIncentiveTriggerBindingDraft({...fixture(),isAuthorized:true}));
  reject(()=>buildIncentiveTriggerBindingDraft({...fixture(),authorityEvidence:{...fixture().authorityEvidence,verified:true}}));
  reject(()=>buildIncentiveTriggerBindingDraft(Object.assign(Object.create(null),fixture())));
  reject(()=>buildIncentiveTriggerBindingDraft({...fixture(),triggerType:'account_registration'}));
  const receipt=buildIncentiveTriggerBindingDraft(fixture());
  reject(()=>validateIncentiveTriggerBindingDraft({...receipt,receiptHash:h('f')}));
  reject(()=>validateIncentiveTriggerBindingDraft({...receipt,evidence:{...receipt.evidence,amountIwc:'20.00000000'}}));
});

test('B1：输出只含纯数据和候选哈希，不伪造已验证权限、完整性信号或经济处罚', () => {
  const draft=buildIncentiveTriggerBindingDraft(fixture());
  assert.deepEqual(Object.keys(draft),['evidence','receiptHash']);
  for (const k of ['verified','signals','integrityVerdict','reputationScore','economicRestriction','authorizationGranted']) {
    assert.equal(Object.hasOwn(draft,k),false);
  }
});
