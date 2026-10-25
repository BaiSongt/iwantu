import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { sha256Evidence } from '../src/lib/authority/authority-snapshot.mjs';
import {
  buildIncentiveAwardIssueIntentDraft,
  buildIncentivePolicyPublicationIntentDraft,
} from '../src/lib/integrity/incentive-authorization-intent-draft.mjs';
import {
  buildIncentiveProgramPolicyDraft,
  INCENTIVE_PROGRAM_POLICY_DRAFT_VERSION,
} from '../src/lib/integrity/incentive-program-policy-draft.mjs';
import {
  IncentiveSignaturePreflightDraftError,
  inspectIncentiveAwardIssueSignatureDraft,
  inspectIncentivePolicyPublicationSignatureDraft,
} from '../src/lib/integrity/incentive-signature-preflight-draft.mjs';

const NOW = new Date('2026-10-24T01:00:00.000Z');
const policyCandidate = () => buildIncentiveProgramPolicyDraft({
  protocol: INCENTIVE_PROGRAM_POLICY_DRAFT_VERSION,
  programId: 'settlement-incentive', policyVersion: 'v1', issuerPrincipalId: 'principal-governance',
  triggerType: 'terminal_settlement', eligibleSettlementTypes: ['mutual_split', 'full_settlement'],
  beneficiaryRole: 'supplier', awardSlot: 'completion',
  rewardFormula: { kind: 'fixed_amount', amountIwc: '12.00000000' },
  effectiveFrom: '2026-10-24T00:00:00.000Z', effectiveUntil: '2026-12-01T00:00:00.000Z',
  deduplicationScope: 'program_policy_settlement_role_slot',
});
const awardData = () => ({
  policyCandidate: policyCandidate(),
  trigger: { settlementId: 'settlement-1', settlementHash: 'a'.repeat(64),
    settlementType: 'full_settlement', triggerEvidenceHash: 'b'.repeat(64) },
  beneficiaryPrincipalId: 'supplier-principal', awardId: 'completion-1',
});

function fixture(kind = 'award') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const input = kind === 'award' ? awardData() : { policyCandidate: policyCandidate() };
  const intent = kind === 'award'
    ? buildIncentiveAwardIssueIntentDraft(input)
    : buildIncentivePolicyPublicationIntentDraft(input);
  const commandEvidence = {
    protocolVersion: 'iwantu-economic-command/0.1',
    action: intent.payload.action,
    principalId: kind === 'award' ? 'principal-incentive-operator' : 'principal-governance',
    agentIdentityId: 'agent-operator',
    mandateId: 'mandate-specific',
    payloadHash: intent.payloadHash,
    nonce: 'nonce-1',
    issuedAt: '2026-10-24T00:59:00.000Z',
    expiresAt: '2026-10-24T01:04:00.000Z',
    signingKeyId: 'signing-key-1',
    signatureAlgorithm: 'EdDSA',
  };
  const signature = sign(null, Buffer.from(sha256Evidence(commandEvidence), 'hex'), privateKey).toString('base64url');
  return {
    ...input, commandEvidence, signature, presentedPublicKeyJwk: publicKey.export({ format: 'jwk' }),
    now: NOW, privateKey,
  };
}
const inspectAward = (value) => inspectIncentiveAwardIssueSignatureDraft(value);
const inspectPublish = (value) => inspectIncentivePolicyPublicationSignatureDraft(value);
const deny = (fn) => assert.throws(fn, IncentiveSignaturePreflightDraftError);

test('P1c：真实 Ed25519 签名在候选公钥下可校验，但不宣称授权或 Nonce 防重放', () => {
  const data = fixture();
  const { privateKey: ignored, ...input } = data;
  assert.ok(ignored);
  const result = inspectAward(input);
  assert.equal(result.signatureCheck, 'valid_for_presented_key_only');
  assert.equal(result.authorizationStatus, 'not_checked');
  assert.equal(result.nonceReplayStatus, 'not_checked');
  assert.equal(result.r8RiskEvaluationEligible, false);
  assert.equal(result.economicCommandHash, sha256Evidence(data.commandEvidence));
  assert.equal(result.intentPayloadHash, data.commandEvidence.payloadHash);
  // 独立冻结 P1b -> M3 economic-command/0.1 的跨模块黄金摘要。
  assert.equal(result.intentPayloadHash, '8f0e6de969ceefb2d8f4caec6229beec583af7ec36f02d804e6a697ec444200d');
  assert.equal(result.economicCommandHash, '4501ae84d5b5d2d929a9f573d0b3b519ab7178b750ab3af72cc91ad48c8f75ac');
  assert.equal(Object.hasOwn(result, 'verified'), false);
  assert.equal(Object.hasOwn(result, 'authorized'), false);
  // 纯函数重复调用仍通过，证明这里从未伪造 Nonce 消费能力。
  assert.deepEqual(inspectAward(input), result);
});

test('P1c：政策发布使用独立 action，且签名 Principal 必须等于候选政策发布者', () => {
  const data = fixture('policy');
  const { privateKey: ignored, ...input } = data;
  assert.ok(ignored);
  assert.equal(inspectPublish(input).signatureCheck, 'valid_for_presented_key_only');
  deny(() => inspectPublish({ ...input, commandEvidence: { ...input.commandEvidence,
    principalId: 'principal-pretender' } }));
  deny(() => inspectPublish({ ...input, commandEvidence: { ...input.commandEvidence,
    action: 'incentive.award.issue' } }));
});

test('P1c：篡改奖励事实、政策金额或政策哈希不能复用已签名命令', () => {
  const { privateKey: ignored, ...data } = fixture();
  assert.ok(ignored);
  deny(() => inspectAward({ ...data, beneficiaryPrincipalId: 'different-beneficiary' }));
  deny(() => inspectAward({ ...data, trigger: { ...data.trigger,
    settlementHash: 'c'.repeat(64) } }));
  const revised = buildIncentiveProgramPolicyDraft({
    ...data.policyCandidate.policy,
    rewardFormula: { kind: 'fixed_amount', amountIwc: '13.00000000' },
  });
  deny(() => inspectAward({ ...data, policyCandidate: revised }));
  assert.throws(() => inspectAward({ ...data, policyCandidate: { ...data.policyCandidate,
    policyHash: 'c'.repeat(64) } }));
});

test('P1c：命令 Nonce、Agent、Mandate、签名键或过期时间的修改使原签名失效', () => {
  const { privateKey: ignored, ...data } = fixture();
  assert.ok(ignored);
  for (const patch of [
    { nonce: 'nonce-2' }, { agentIdentityId: 'agent-other' },
    { mandateId: 'mandate-other' }, { signingKeyId: 'signing-key-other' },
    { expiresAt: '2026-10-24T01:05:00.000Z' }, { principalId: 'principal-other' },
  ]) deny(() => inspectAward({ ...data, commandEvidence: { ...data.commandEvidence, ...patch } }));
});

test('P1c：拒绝错误密钥、签名扰动及非规范 Base64url', () => {
  const { privateKey: ignored, ...data } = fixture();
  assert.ok(ignored);
  const otherKey = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
  deny(() => inspectAward({ ...data, presentedPublicKeyJwk: otherKey }));
  const sig = Buffer.from(data.signature, 'base64url');
  sig[0] ^= 1;
  deny(() => inspectAward({ ...data, signature: sig.toString('base64url') }));
  deny(() => inspectAward({ ...data, signature: `${data.signature}=` }));
  deny(() => inspectAward({ ...data, signature: Buffer.from('a').toString('base64url') }));
  deny(() => inspectAward({ ...data, presentedPublicKeyJwk: { ...data.presentedPublicKeyJwk,
    d: 'fake-private-key' } }));
  deny(() => inspectAward({ ...data, presentedPublicKeyJwk: {
    kty: 'RSA', crv: 'Ed25519', x: data.presentedPublicKeyJwk.x } }));
});

test('P1c：过期、过长 TTL、未来签发与非法时间格式拒绝', () => {
  const { privateKey: ignored, ...data } = fixture();
  assert.ok(ignored);
  deny(() => inspectAward({ ...data, now: new Date('2026-10-24T01:04:00.000Z') }));
  deny(() => inspectAward({ ...data, now: new Date('2026-10-24T00:57:00.000Z') }));
  for (const patch of [
    { issuedAt: '2026-10-24T00:00:00.000Z' },
    { issuedAt: '2026-10-24T01:04:00.000Z' },
    { issuedAt: '2026-10-24T00:59:00Z' },
    { expiresAt: '2026-10-24T00:59:00.000Z' },
    { expiresAt: 'bad' },
  ]) deny(() => inspectAward({ ...data, commandEvidence: { ...data.commandEvidence, ...patch } }));
  deny(() => inspectAward({ ...data, now: new Date('invalid') }));
});

test('P1c：拒绝未知字段、冒充已授权字段及非标准协议版本', () => {
  const { privateKey: ignored, ...data } = fixture();
  assert.ok(ignored);
  deny(() => inspectAward({ ...data, authorized: true }));
  deny(() => inspectAward({ ...data, commandEvidence: { ...data.commandEvidence,
    authoritySnapshotId: 'fabricated' } }));
  deny(() => inspectAward({ ...data, commandEvidence: { ...data.commandEvidence,
    protocolVersion: 'iwantu-economic-command/0.2' } }));
  deny(() => inspectAward({ ...data, commandEvidence: { ...data.commandEvidence,
    signatureAlgorithm: 'RS256' } }));
  deny(() => inspectAward(Object.assign(Object.create(null), data)));
});

test('P1c：展示的公钥可以自签通过但不证明凭据受信或授权', () => {
  // 此例刻意使用未注册于数据库的临时密钥，防止将数学验签误用为鉴权。
  const { privateKey: ignored, ...data } = fixture();
  assert.ok(ignored);
  const result = inspectAward(data);
  assert.equal(result.signatureCheck, 'valid_for_presented_key_only');
  assert.equal(result.authorizationStatus, 'not_checked');
  assert.equal(result.nonceReplayStatus, 'not_checked');
  assert.equal(result.r8RiskEvaluationEligible, false);
});
