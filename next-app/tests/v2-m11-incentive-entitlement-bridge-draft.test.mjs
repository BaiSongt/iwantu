import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256Evidence } from '../src/lib/authority/authority-snapshot.mjs';
import { inspectIncentiveEntitlementBridgeDraft as inspect, IncentiveEntitlementBridgeDraftError as BridgeError } from '../src/lib/integrity/incentive-entitlement-bridge-draft.mjs';

function candidate(patch={}) {
  const payload={
    protocol:'iwantu.incentive-authorization-intent/0.1', action:'incentive.award.issue',
    programId:'m11', policyVersion:'v1', policyHash:'a'.repeat(64), issuerPrincipalId:'principal-issuer',
    settlementId:'settlement-1',settlementHash:'b'.repeat(64),settlementType:'full_settlement',
    triggerEvidenceHash:'c'.repeat(64),beneficiaryPrincipalId:'principal-1',
    beneficiaryRole:'supplier',awardSlot:'completion',awardId:'award-1',
    rewardFormula:{kind:'fixed_amount',amountIwc:'10.00000000'},currency:'IWC',
    deduplicationScope:'program_policy_settlement_role_slot',...patch,
  };
  return { payload, payloadHash:sha256Evidence(payload), deduplicationFingerprint:sha256Evidence({
    protocol:'iwantu.incentive-award-deduplication/0.1',programId:payload.programId,
    policyVersion:payload.policyVersion,policyHash:payload.policyHash,
    settlementId:payload.settlementId,beneficiaryRole:payload.beneficiaryRole,awardSlot:payload.awardSlot,
  })};
}
const reject = (v) => assert.throws(()=>inspect(v),BridgeError);

test('P1h：已有政策版本哈希保持原值，Program 权益键单独形成',()=>{
  const c=candidate(),r=inspect(c);
  assert.equal(r.policyScopedFingerprint,c.deduplicationFingerprint);
  assert.match(r.programEntitlementFingerprint,/^[0-9a-f]{64}$/);
  assert.notEqual(r.policyScopedFingerprint,r.programEntitlementFingerprint);
  assert.equal(r.economicWritePermitted,false);
});
test('P1h：更换政策版本或哈希不得变更跨版本权益键',()=>{
  const old=inspect(candidate()),next=inspect(candidate({policyVersion:'v2',policyHash:'d'.repeat(64)}));
  assert.notEqual(old.policyScopedFingerprint,next.policyScopedFingerprint);
  assert.equal(old.programEntitlementFingerprint,next.programEntitlementFingerprint);
});
test('P1h：更换收款 Principal、awardId 或金额不得绕过稳定权益身份',()=>{
  const old=inspect(candidate()),next=inspect(candidate({beneficiaryPrincipalId:'other',awardId:'award-2',rewardFormula:{kind:'fixed_amount',amountIwc:'9.00000000'}}));
  assert.equal(old.programEntitlementFingerprint,next.programEntitlementFingerprint);
});
test('P1h：不同的 Program / Settlement / role / slot 必须有不同权益键',()=>{
  const baseline=inspect(candidate()).programEntitlementFingerprint;
  for(const patch of [{programId:'m12'},{settlementId:'settlement-2'},{beneficiaryRole:'buyer'},{awardSlot:'review'}]){
    assert.notEqual(inspect(candidate(patch)).programEntitlementFingerprint,baseline);
  }
});
test('P1h：拒绝 payload 篡改及伪造的两个摘要',()=>{
  const c=candidate();reject({...c,payload:{...c.payload,awardId:'evil'}});
  reject({...c,payloadHash:'f'.repeat(64)});
  reject({...c,deduplicationFingerprint:'f'.repeat(64)});
  reject({...c,payload:{...c.payload,settlementHash:'e'.repeat(64)},payloadHash:c.payloadHash});
});
test('P1h：错误动作、作用域、版本及扩展字段均拒绝',()=>{
  for(const patch of [{action:'incentive.policy.publish'},{protocol:'other'},{deduplicationScope:'program_settlement_role_slot'}, {currency:'USD'},{unexpected:'yes'}])reject(candidate(patch));
  reject({...candidate(),signed:true});
  reject(Object.assign(Object.create(null),candidate()));
});
test('P1h：拒绝浮点/非法金额、越界标识、伪造角色与非终局结算',()=>{
  for(const patch of [
    {rewardFormula:{kind:'fixed_amount',amountIwc:1.5}},
    {rewardFormula:{kind:'fixed_amount',amountIwc:'0.00000000'}},
    {programId:'a:b'},{awardSlot:'a:b'},{beneficiaryRole:'root'},
    {settlementType:'pending'}, {policyHash:'INVALID'},
  ]) reject(candidate(patch));
});
test('P1h：候选桥接绝不变成签名认证或经济批准',()=>{
  const r=inspect(candidate());
  assert.equal(r.policyScopeCompatibility,'legacy_scope_does_not_enforce_cross_version_uniqueness');
  assert.equal(r.authorizationStatus,'not_checked');
  assert.equal(r.policySnapshotStatus,'not_verified');
  assert.equal(r.databaseUniquenessStatus,'not_checked');
  assert.equal(r.r8RiskEvaluationEligible,false);
  for(const k of ['authorized','verified','signed','receiptPersisted','punishment'])assert.equal(Object.hasOwn(r,k),false);
});
