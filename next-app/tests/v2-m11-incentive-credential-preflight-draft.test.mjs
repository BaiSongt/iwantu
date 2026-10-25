import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  IncentiveCredentialPreflightDraftError,
  inspectIncentiveAwardCredentialDraft,
  inspectIncentivePolicyCredentialDraft,
} from '../src/lib/integrity/incentive-credential-preflight-draft.mjs';

const NOW = new Date('2026-10-24T01:00:00.000Z');
const policy = {
  protocol: 'iwantu.incentive-program-policy/0.1',
  programId: 'settlement-incentive', policyVersion: 'v1', issuerPrincipalId: 'principal-governance',
  triggerType: 'terminal_settlement', eligibleSettlementTypes: ['mutual_split', 'full_settlement'],
  beneficiaryRole: 'supplier', awardSlot: 'completion',
  rewardFormula: { kind: 'fixed_amount', amountIwc: '12.00000000' },
  effectiveFrom: '2026-10-24T00:00:00.000Z', effectiveUntil: '2026-12-01T00:00:00.000Z',
  deduplicationScope: 'program_policy_settlement_role_slot',
};
const POLICY_HASH = '63566eaefba6f45cc822e32c200f25852b6e31fa2e5362ed4ee09da52dfb03f3';
const AWARD_PAYLOAD_HASH = '8f0e6de969ceefb2d8f4caec6229beec583af7ec36f02d804e6a697ec444200d';
const TRIGGER = { settlementId: 'settlement-1', settlementHash: 'a'.repeat(64),
  settlementType: 'full_settlement', triggerEvidenceHash: 'b'.repeat(64) };
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
const sha = (value) => createHash('sha256').update(JSON.stringify(canonical(value)), 'utf8').digest('hex');

function setup(kind = 'award') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const issuer = kind === 'policy' ? 'principal-governance' : 'principal-incentive-operator';
  const payloadHash = kind === 'award' ? AWARD_PAYLOAD_HASH : sha({
    protocol: 'iwantu.incentive-authorization-intent/0.1',
    action: 'incentive.policy.publish',
    programId: policy.programId, policyVersion: policy.policyVersion,
    policyHash: POLICY_HASH, issuerPrincipalId: policy.issuerPrincipalId,
  });
  const commandEvidence = {
    protocolVersion: 'iwantu-economic-command/0.1',
    action: kind === 'award' ? 'incentive.award.issue' : 'incentive.policy.publish',
    principalId: issuer, agentIdentityId: 'agent-operator', mandateId: 'mandate-specific',
    payloadHash, nonce: 'nonce-1', issuedAt: '2026-10-24T00:59:00.000Z',
    expiresAt: '2026-10-24T01:04:00.000Z', signingKeyId: 'signing-key-1',
    signatureAlgorithm: 'EdDSA',
  };
  const records = {
    access: { id: 'access-1', keyId: 'access-key-1', agentIdentityId: 'agent-operator',
      kind: 'api', status: 'active', validFrom: new Date('2026-10-01T00:00:00.000Z'), expiresAt: null },
    signing: { id: 'signing-1', keyId: 'signing-key-1', agentIdentityId: 'agent-operator',
      kind: 'signing', status: 'active', algorithm: 'EdDSA',
      publicKeyJwk: publicKey.export({ format: 'jwk' }),
      validFrom: new Date('2026-10-01T00:00:00.000Z'), expiresAt: null },
    principal: { id: issuer, status: 'active' },
    agent: { id: 'agent-operator', principalId: issuer, status: 'active' },
  };
  const queries = [];
  const tx = {
    agentCredential: { async findUnique({ where }) {
      queries.push(['agentCredential.findUnique', where]);
      return where.id ? records.access : records.signing;
    } },
    principal: { async findUnique({ where }) {
      queries.push(['principal.findUnique', where]); return records.principal;
    } },
    agentIdentity: { async findUnique({ where }) {
      queries.push(['agentIdentity.findUnique', where]); return records.agent;
    } },
  };
  const input = {
    tx,
    authentication: { kind: 'v2_agent_credential', canResolveProtocolAuthority: true,
      principal: { id: issuer }, agent: { id: 'agent-operator' },
      credential: { id: 'access-1', keyId: 'access-key-1' } },
    now: NOW, policyCandidate: { policy, policyHash: POLICY_HASH }, commandEvidence,
    signature: sign(null, Buffer.from(sha(commandEvidence), 'hex'), privateKey).toString('base64url'),
    ...(kind === 'award' ? { trigger: TRIGGER,
      beneficiaryPrincipalId: 'supplier-principal', awardId: 'completion-1' } : {}),
  };
  return { input, records, queries, tx };
}

const deny = (fn) => assert.rejects(fn, IncentiveCredentialPreflightDraftError);

test('P1d：从存储的签名凭据公钥进行验签，不允许调用方注入呈交公钥', async () => {
  const { input, queries } = setup();
  const result = await inspectIncentiveAwardCredentialDraft(input);
  assert.equal(result.storedCredentialSignatureCheck, 'matched_current_database_record');
  assert.equal(result.accessCredentialId, 'access-1');
  assert.equal(result.signingCredentialId, 'signing-1');
  assert.equal(result.economicCommandHash, sha(input.commandEvidence));
  assert.equal(result.authorizationStatus, 'not_checked');
  assert.equal(result.nonceReplayStatus, 'not_checked');
  assert.equal(result.policyGovernanceStatus, 'not_checked');
  assert.equal(result.immutableReceiptStatus, 'not_written');
  assert.equal(result.r8RiskEvaluationEligible, false);
  assert.deepEqual(queries.map(([method]) => method).sort(), [
    'agentCredential.findUnique', 'agentCredential.findUnique',
    'agentIdentity.findUnique', 'principal.findUnique',
  ].sort());
  await deny(() => inspectIncentiveAwardCredentialDraft({ ...input, presentedPublicKeyJwk: {} }));
});

test('P1d：政策发布只在独立命令 action 下校验，仍不意味着治理权限', async () => {
  const { input } = setup('policy');
  const result = await inspectIncentivePolicyCredentialDraft(input);
  assert.equal(result.storedCredentialSignatureCheck, 'matched_current_database_record');
  assert.equal(result.policyGovernanceStatus, 'not_checked');
  assert.equal(result.r8RiskEvaluationEligible, false);
});

test('P1d：停用、错主体、错类别或过期的访问凭据拒绝', async () => {
  for (const patch of [
    { status: 'revoked' }, { agentIdentityId: 'agent-other' },
    { kind: 'signing' }, { keyId: 'wrong-access-key' },
    { validFrom: new Date('2026-10-25T00:00:00.000Z') },
    { expiresAt: new Date('2026-10-24T01:00:00.000Z') },
  ]) {
    const { input, records } = setup();
    Object.assign(records.access, patch);
    await deny(() => inspectIncentiveAwardCredentialDraft(input));
  }
});

test('P1d：停用、错主体、错算法或过期的签名凭据拒绝', async () => {
  for (const patch of [
    { status: 'inactive' }, { agentIdentityId: 'agent-other' },
    { kind: 'api' }, { algorithm: 'RSA' },
    { validFrom: new Date('2026-10-25T00:00:00.000Z') },
    { expiresAt: new Date('2026-10-24T01:00:00.000Z') },
  ]) {
    const { input, records } = setup();
    Object.assign(records.signing, patch);
    await deny(() => inspectIncentiveAwardCredentialDraft(input));
  }
});

test('P1d：攻击者的自签公钥不能替换数据库受信公钥', async () => {
  const { input, records } = setup();
  records.signing.publicKeyJwk = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
  await assert.rejects(() => inspectIncentiveAwardCredentialDraft(input));
});

test('P1d：Principal/Agent 实时失效或所有权不匹配均拒绝', async () => {
  for (const [target, patch] of [
    ['principal', { status: 'suspended' }],
    ['agent', { status: 'retired' }],
    ['agent', { principalId: 'principal-other' }],
  ]) {
    const { input, records } = setup();
    Object.assign(records[target], patch);
    await deny(() => inspectIncentiveAwardCredentialDraft(input));
  }
});

test('P1d：拒绝 Legacy 身份及签名 Principal/Agent 与认证身份分离', async () => {
  const { input } = setup();
  await deny(() => inspectIncentiveAwardCredentialDraft({ ...input,
    authentication: { ...input.authentication, kind: 'legacy_user_api_key' } }));
  for (const patch of [{ principalId: 'principal-other' }, { agentIdentityId: 'agent-other' }]) {
    await deny(() => inspectIncentiveAwardCredentialDraft({ ...input,
      commandEvidence: { ...input.commandEvidence, ...patch } }));
  }
});

test('P1d：签名载荷改动、非法时间及缺失 Prisma 只读接口拒绝', async () => {
  const { input } = setup();
  await assert.rejects(() => inspectIncentiveAwardCredentialDraft({ ...input,
    beneficiaryPrincipalId: 'other-beneficiary' }));
  await deny(() => inspectIncentiveAwardCredentialDraft({ ...input, now: new Date('invalid') }));
  await deny(() => inspectIncentiveAwardCredentialDraft({ ...input, tx: {} }));
});
