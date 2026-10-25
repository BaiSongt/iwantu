import { bindAuthorityToAuthentication } from '../agent-auth-context-core.mjs';
import { resolveAuthority } from '../authority/authority.mjs';
import { sha256Evidence } from '../authority/authority-snapshot.mjs';
import {
  INCENTIVE_AWARD_ISSUE_ACTION_DRAFT,
  INCENTIVE_POLICY_PUBLISH_ACTION_DRAFT,
} from './incentive-authorization-intent-draft.mjs';
import {
  inspectIncentiveAwardCredentialDraft,
  inspectIncentivePolicyCredentialDraft,
} from './incentive-credential-preflight-draft.mjs';

// P1e 只检查候选签名对应的实时 Mandate action，不核准经济额度或政策治理资格。
// 此模块严禁直接作为政策发布、Ledger 发奖、Nonce 消费或处罚操作的授权入口。
export const INCENTIVE_MANDATE_PREFLIGHT_DRAFT_VERSION = 'iwantu.incentive-mandate-preflight/0.1';

export class IncentiveMandatePreflightDraftError extends Error {
  constructor(field, reason) {
    super(`${field}: ${reason}`);
    this.name = 'IncentiveMandatePreflightDraftError';
    this.code = 'INCENTIVE_MANDATE_PREFLIGHT_DRAFT_INVALID';
    this.field = field;
  }
}

const deny = (field, reason) => { throw new IncentiveMandatePreflightDraftError(field, reason); };

async function inspect(input, action) {
  // 必须先由 P1d 校验已认证访问身份、存储的签名公钥及候选命令签名。
  // P1d 同时拒绝多余字段及调用方自行提供的“授权成功”状态。
  const credential = action === INCENTIVE_AWARD_ISSUE_ACTION_DRAFT
    ? await inspectIncentiveAwardCredentialDraft(input)
    : await inspectIncentivePolicyCredentialDraft(input);

  if (!input.tx?.mandate || typeof input.tx.mandate.findUnique !== 'function') {
    deny('tx.mandate', 'requires the server-side Prisma Mandate read adapter');
  }

  // 复用 M1 实时 Resolver 的撤销、期限、委托收窄、Principal 及 Agent 状态门禁。
  // 仅检查 action，不传递尚未冻结模型的经济限额或政策治理权限。
  const authority = await resolveAuthority(input.tx, {
    mandateId: input.commandEvidence.mandateId,
    subjectAgentIdentityId: input.authentication.agent.id,
    action,
    at: input.now,
  });
  bindAuthorityToAuthentication(input.authentication, authority);

  // 激励操作敏感：候选阶段只承认叶子 Mandate 的精确 action，不以 * 或 incentive.* 代替。
  if (!Array.isArray(authority.effective?.actionScopes) ||
      !authority.effective.actionScopes.includes(action)) {
    deny('mandate.actionScopes', 'requires an explicit action grant; wildcard grants are insufficient');
  }
  const last = authority.mandateChain?.at(-1);
  if (!last || last.id !== input.commandEvidence.mandateId) {
    deny('mandateId', 'resolved Mandate chain does not end at the signed Mandate');
  }

  // 该返回值绝不提供 authorized=true 或可写经济状态；后续必须在同一事务重做活性检查。
  return {
    protocol: INCENTIVE_MANDATE_PREFLIGHT_DRAFT_VERSION,
    action,
    economicCommandHash: credential.economicCommandHash,
    intentPayloadHash: credential.intentPayloadHash,
    principalId: authority.principalId,
    agentIdentityId: authority.subjectAgentIdentityId,
    mandateId: last.id,
    mandateChainHash: sha256Evidence(authority.mandateChain),
    accessCredentialId: credential.accessCredentialId,
    signingCredentialId: credential.signingCredentialId,
    storedCredentialSignatureCheck: credential.storedCredentialSignatureCheck,
    mandateActionStatus: 'matched_live_explicit_action_scope',
    authorizationStatus: 'incomplete',
    economicLimitStatus: 'not_checked',
    policyGovernanceStatus: 'not_checked',
    nonceReplayStatus: 'not_checked',
    immutableReceiptStatus: 'not_written',
    r8RiskEvaluationEligible: false,
  };
}

export async function inspectIncentivePolicyMandateDraft(input) {
  return inspect(input, INCENTIVE_POLICY_PUBLISH_ACTION_DRAFT);
}

export async function inspectIncentiveAwardMandateDraft(input) {
  return inspect(input, INCENTIVE_AWARD_ISSUE_ACTION_DRAFT);
}
