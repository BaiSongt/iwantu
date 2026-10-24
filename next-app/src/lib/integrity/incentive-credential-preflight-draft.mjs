import {
  inspectIncentiveAwardIssueSignatureDraft,
  inspectIncentivePolicyPublicationSignatureDraft,
} from './incentive-signature-preflight-draft.mjs';

// P1d 仅通过服务端 Prisma 读取记录并以存储公钥验签；不授予 Mandate 权限，也不消费 Nonce。
export const INCENTIVE_CREDENTIAL_PREFLIGHT_DRAFT_VERSION = 'iwantu.incentive-credential-preflight/0.1';

export class IncentiveCredentialPreflightDraftError extends Error {
  constructor(field, reason) {
    super(\`\${field}: \${reason}\`);
    this.name = 'IncentiveCredentialPreflightDraftError';
    this.code = 'INCENTIVE_CREDENTIAL_PREFLIGHT_DRAFT_INVALID';
    this.field = field;
  }
}

const deny = (field, reason) => { throw new IncentiveCredentialPreflightDraftError(field, reason); };

function exactFields(value, fields, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).length !== fields.length ||
      fields.some((key) => !Object.hasOwn(value, key)) ||
      Object.keys(value).some((key) => !fields.includes(key))) {
    deny(field, 'missing, unexpected or unsafe field');
  }
}

function validAt(record, now, field) {
  if (!(record.validFrom instanceof Date) || !Number.isFinite(record.validFrom.getTime()) ||
      record.validFrom.getTime() > now.getTime() ||
      (record.expiresAt !== null && record.expiresAt !== undefined &&
        (!(record.expiresAt instanceof Date) || !Number.isFinite(record.expiresAt.getTime()) ||
          record.expiresAt.getTime() <= now.getTime()))) {
    deny(field, 'credential is outside its valid time interval');
  }
}

async function inspectCredentialSources(input, evidence) {
  const { tx, authentication, now } = input;
  if (!tx || !tx.agentCredential || !tx.principal || !tx.agentIdentity ||
      typeof tx.agentCredential.findUnique !== 'function' ||
      typeof tx.principal.findUnique !== 'function' ||
      typeof tx.agentIdentity.findUnique !== 'function') {
    deny('tx', 'requires the server-side Prisma read adapter');
  }
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    deny('now', 'requires a valid server-supplied Date');
  }
  if (authentication?.kind !== 'v2_agent_credential' ||
      authentication.canResolveProtocolAuthority !== true ||
      !authentication.principal?.id || !authentication.agent?.id ||
      !authentication.credential?.id || !authentication.credential?.keyId) {
    deny('authentication', 'requires an existing v2 access-authentication context');
  }
  if (evidence.principalId !== authentication.principal.id ||
      evidence.agentIdentityId !== authentication.agent.id) {
    deny('commandEvidence', 'signer identity differs from authenticated access context');
  }

  // 不使用呈交的 JWK。签名验证所需公钥仅从当前数据库签名凭据读取。
  const [access, signing, principal, agent] = await Promise.all([
    tx.agentCredential.findUnique({ where: { id: authentication.credential.id }, select: {
      id: true, keyId: true, agentIdentityId: true, kind: true, status: true,
      validFrom: true, expiresAt: true,
    } }),
    tx.agentCredential.findUnique({ where: { keyId: evidence.signingKeyId }, select: {
      id: true, keyId: true, agentIdentityId: true, kind: true, status: true,
      algorithm: true, publicKeyJwk: true, validFrom: true, expiresAt: true,
    } }),
    tx.principal.findUnique({ where: { id: authentication.principal.id }, select: { id: true, status: true } }),
    tx.agentIdentity.findUnique({ where: { id: authentication.agent.id }, select: {
      id: true, principalId: true, status: true,
    } }),
  ]);

  if (!principal || principal.id !== authentication.principal.id || principal.status !== 'active' ||
      !agent || agent.id !== authentication.agent.id || agent.status !== 'active' ||
      agent.principalId !== principal.id) {
    deny('identity', 'Principal or AgentIdentity is missing, inactive or not owned by signer');
  }
  if (!access || access.id !== authentication.credential.id ||
      access.keyId !== authentication.credential.keyId ||
      access.agentIdentityId !== agent.id || access.kind !== 'api' || access.status !== 'active') {
    deny('accessCredential', 'access credential is missing, inactive or does not match authenticated Agent');
  }
  validAt(access, now, 'accessCredential');
  if (!signing || !signing.id || signing.keyId !== evidence.signingKeyId ||
      signing.agentIdentityId !== agent.id || signing.kind !== 'signing' ||
      signing.status !== 'active' || signing.algorithm !== 'EdDSA') {
    deny('signingCredential', 'stored signing credential is missing, inactive or belongs to another Agent');
  }
  validAt(signing, now, 'signingCredential');
  return { access, signing };
}

async function inspect(input, action) {
  const common = ['tx', 'authentication', 'now', 'policyCandidate', 'commandEvidence', 'signature'];
  const award = ['trigger', 'beneficiaryPrincipalId', 'awardId'];
  exactFields(input, action === 'award' ? [...common, ...award] : common, 'input');
  const { access, signing } = await inspectCredentialSources(input, input.commandEvidence);
  const candidate = {
    policyCandidate: input.policyCandidate,
    commandEvidence: input.commandEvidence,
    signature: input.signature,
    presentedPublicKeyJwk: signing.publicKeyJwk,
    now: input.now,
    ...(action === 'award' ? {
      trigger: input.trigger,
      beneficiaryPrincipalId: input.beneficiaryPrincipalId,
      awardId: input.awardId,
    } : {}),
  };
  const proof = action === 'award'
    ? inspectIncentiveAwardIssueSignatureDraft(candidate)
    : inspectIncentivePolicyPublicationSignatureDraft(candidate);

  // 即使凭据与签名均匹配，Mandate/政策治理资格/Nonce/真实经济事实仍未审核。
  return {
    protocol: INCENTIVE_CREDENTIAL_PREFLIGHT_DRAFT_VERSION,
    economicCommandHash: proof.economicCommandHash,
    intentPayloadHash: proof.intentPayloadHash,
    accessCredentialId: access.id,
    signingCredentialId: signing.id,
    storedCredentialSignatureCheck: 'matched_current_database_record',
    authorizationStatus: 'not_checked',
    nonceReplayStatus: 'not_checked',
    policyGovernanceStatus: 'not_checked',
    immutableReceiptStatus: 'not_written',
    r8RiskEvaluationEligible: false,
  };
}

export async function inspectIncentiveAwardCredentialDraft(input) {
  return inspect(input, 'award');
}

export async function inspectIncentivePolicyCredentialDraft(input) {
  return inspect(input, 'policy');
}
