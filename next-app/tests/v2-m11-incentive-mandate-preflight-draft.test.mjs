import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import {
  IncentiveMandatePreflightDraftError,
  inspectIncentiveAwardMandateDraft,
  inspectIncentivePolicyMandateDraft,
} from '../src/lib/integrity/incentive-mandate-preflight-draft.mjs';

const NOW = new Date('2026-10-24T01:00:00.000Z');
const POLICY_HASH = '63566eaefba6f45cc822e32c200f25852b6e31fa2e5362ed4ee09da52dfb03f3';
const AWARD_PAYLOAD_HASH = '8f0e6de969ceefb2d8f4caec6229beec583af7ec36f02d804e6a697ec444200d';
const policy = {
  protocol: 'iwantu.incentive-program-policy/0.1',
  programId: 'settlement-incentive', policyVersion: 'v1', issuerPrincipalId: 'principal-governance',
  triggerType: 'terminal_settlement', eligibleSettlementTypes: ['mutual_split', 'full_settlement'],
  beneficiaryRole: 'supplier', awardSlot: 'completion',
  rewardFormula: { kind: 'fixed_amount', amountIwc: '12.00000000' },
  effectiveFrom: '2026-10-24T00:00:00.000Z', effectiveUntil: '2026-12-01T00:00:00.000Z',
  deduplicationScope: 'program_policy_settlement_role_slot',
};
const TRIGGER = {
  settlementId: 'settlement-1', settlementHash: 'a'.repeat(64),
  settlementType: 'full_settlement', triggerEvidenceHash: 'b'.repeat(64),
};
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}
const sha = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

function setup(kind = 'award') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const principalId = kind === 'policy' ? 'principal-governance' : 'principal-incentive-operator';
  const action = kind === 'policy' ? 'incentive.policy.publish' : 'incentive.award.issue';
  const payloadHash = kind === 'award' ? AWARD_PAYLOAD_HASH : sha({
    protocol: 'iwantu.incentive-authorization-intent/0.1',
    action, programId: policy.programId, policyVersion: policy.policyVersion,
    policyHash: POLICY_HASH, issuerPrincipalId: policy.issuerPrincipalId,
  });
  const evidence = {
    protocolVersion: 'iwantu-economic-command/0.1', action,
    principalId, agentIdentityId: 'agent-operator', mandateId: 'mandate-specific',
    payloadHash, nonce: 'nonce-1', issuedAt: '2026-10-24T00:59:00.000Z',
    expiresAt: '2026-10-24T01:04:00.000Z', signingKeyId: 'signing-key-1',
    signatureAlgorithm: 'EdDSA',
  };
  const access = {
    id: 'access-1', keyId: 'access-key-1', agentIdentityId: 'agent-operator',
    kind: 'api', status: 'active', validFrom: new Date('2026-10-01T00:00:00.000Z'), expiresAt: null,
  };
  const signing = {
    id: 'signing-1', keyId: 'signing-key-1', agentIdentityId: 'agent-operator',
    kind: 'signing', status: 'active', algorithm: 'EdDSA',
    publicKeyJwk: publicKey.export({ format: 'jwk' }),
    validFrom: new Date('2026-10-01T00:00:00.000Z'), expiresAt: null,
  };
  const principal = { id: principalId, status: 'active' };
  const agent = { id: 'agent-operator', principalId, status: 'active' };
  const mandate = {
    id: 'mandate-specific', version: 1, payloadHash: 'c'.repeat(64),
    issuerPrincipalId: principalId, subjectAgentIdentityId: 'agent-operator',
    actionScopes: [action], capabilityScopes: [], economicLimits: {},
    resourcePolicy: {}, dataPolicy: {}, counterpartyPolicy: {},
    validFrom: new Date('2026-10-01T00:00:00.000Z'), validUntil: null,
    delegationAllowed: false, maxDelegationDepth: 0, delegationDepth: 0,
    parentMandateId: null, delegatingAgentIdentityId: null,
    revocation: null, supersededBy: null,
    issuerPrincipal: { status: 'active' }, subjectAgent: { status: 'active' },
    parentMandate: null,
  };
  const queries = [];
  const tx = {
    agentCredential: { async findUnique({ where }) {
      queries.push(['credential', where]); return where.id ? access : signing;
    } },
    principal: { async findUnique({ where }) {
      queries.push(['principal', where]); return principal;
    } },
    agentIdentity: { async findUnique({ where }) {
      queries.push(['agent', where]); return agent;
    } },
    mandate: { async findUnique({ where }) {
      queries.push(['mandate', where]); return mandate;
    } },
  };
  const input = {
    tx,
    authentication: {
      kind: 'v2_agent_credential', canResolveProtocolAuthority: true,
      principal: { id: principalId }, agent: { id: 'agent-operator' },
      credential: { id: 'access-1', keyId: 'access-key-1' },
    },
    now: NOW,
    policyCandidate: { policy, policyHash: POLICY_HASH },
    commandEvidence: evidence,
    signature: sign(null, Buffer.from(sha(evidence), 'hex'), privateKey).toString('base64url'),
    ...(kind === 'award' ? {
      trigger: TRIGGER, beneficiaryPrincipalId: 'supplier-principal', awardId: 'completion-1',
    } : {}),
  };
  return { input, mandate, access, signing, principal, agent, queries };
}

test('P1e：真实凭据验签与实时精确 action Mandate 连接后仍不具备发奖许可', async () => {
  const { input, queries } = setup();
  const out = await inspectIncentiveAwardMandateDraft(input);
  assert.equal(out.protocol, 'iwantu.incentive-mandate-preflight/0.1');
  assert.equal(out.mandateActionStatus, 'matched_live_explicit_action_scope');
  assert.equal(out.economicCommandHash, sha(input.commandEvidence));
  assert.equal(out.action, 'incentive.award.issue');
  assert.equal(out.mandateId, 'mandate-specific');
  assert.match(out.mandateChainHash, /^[0-9a-f]{64}$/);
  assert.equal(out.authorizationStatus, 'incomplete');
  assert.equal(out.economicLimitStatus, 'not_checked');
  assert.equal(out.policyGovernanceStatus, 'not_checked');
  assert.equal(out.nonceReplayStatus, 'not_checked');
  assert.equal(out.immutableReceiptStatus, 'not_written');
  assert.equal(out.r8RiskEvaluationEligible, false);
  assert.equal(queries.filter(([name]) => name === 'mandate').length, 1);
});

test('P1e：政策发布与发奖动作必须分别授权，不能交叉替代', async () => {
  const { input } = setup('policy');
  const out = await inspectIncentivePolicyMandateDraft(input);
  assert.equal(out.action, 'incentive.policy.publish');
  assert.equal(out.authorizationStatus, 'incomplete');
  await assert.rejects(() => inspectIncentiveAwardMandateDraft(input));
});

test('P1e：未授予 action、星号和通配父命名空间均不升级为精确激励授权', async () => {
  for (const scopes of [['offer.issue'], ['*'], ['incentive.*'], []]) {
    const { input, mandate } = setup();
    mandate.actionScopes = scopes;
    await assert.rejects(() => inspectIncentiveAwardMandateDraft(input));
  }
});

test('P1e：Mandate 已撤销、已过期、Agent 状态停用或主体不一致均拒绝', async () => {
  for (const patch of [
    { revocation: { revokedAt: new Date('2026-10-24T00:00:00.000Z') } },
    { validUntil: new Date('2026-10-24T01:00:00.000Z') },
    { issuerPrincipal: { status: 'suspended' } },
    { subjectAgent: { status: 'retired' } },
    { issuerPrincipalId: 'principal-other' },
    { subjectAgentIdentityId: 'agent-other' },
  ]) {
    const { input, mandate } = setup();
    Object.assign(mandate, patch);
    await assert.rejects(() => inspectIncentiveAwardMandateDraft(input));
  }
});

test('P1e：不能以错误 Principal 的 Mandate 或伪造访问/签名凭据绕过门禁', async () => {
  const { input, mandate } = setup();
  mandate.issuerPrincipalId = 'principal-other';
  await assert.rejects(() => inspectIncentiveAwardMandateDraft(input));
  const second = setup();
  second.signing.status = 'revoked';
  await assert.rejects(() => inspectIncentiveAwardMandateDraft(second.input));
  const third = setup();
  third.access.kind = 'signing';
  await assert.rejects(() => inspectIncentiveAwardMandateDraft(third.input));
});

test('P1e：拒绝缺失 Mandate 读取接口与外部注入的所谓已授权状态', async () => {
  const { input } = setup();
  await assert.rejects(
    () => inspectIncentiveAwardMandateDraft({ ...input, tx: { ...input.tx, mandate: null } }),
    IncentiveMandatePreflightDraftError,
  );
  await assert.rejects(() => inspectIncentiveAwardMandateDraft({ ...input,
    authorizationStatus: 'authorized',
  }));
});

test('P1e：重复只读预检不消费 Nonce，也不生成 AuthoritySnapshot 或奖励 Ledger 记录', async () => {
  const { input, queries } = setup();
  const a = await inspectIncentiveAwardMandateDraft(input);
  const b = await inspectIncentiveAwardMandateDraft(input);
  assert.deepEqual(a, b);
  assert.equal(a.nonceReplayStatus, 'not_checked');
  assert.equal(queries.every(([operation]) => ['credential', 'principal', 'agent', 'mandate'].includes(operation)), true);
  assert.equal(queries.filter(([operation]) => operation === 'mandate').length, 2);
});
