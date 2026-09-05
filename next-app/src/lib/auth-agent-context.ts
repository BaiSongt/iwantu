import prisma from '@/lib/db/client';
import { authenticateAgent } from '@/lib/auth-agent';
import { authenticateV2Agent } from '@/lib/auth-agent-v2';
import {
  AuthenticationContextError,
  bindAuthorityToAuthentication,
  classifyAgentBearerToken,
  createLegacyAgentAuthenticationContext,
  createV2AgentAuthenticationContext,
  type AuthenticatedAuthorityContext,
  type UnifiedAgentAuthenticationContext,
} from '@/lib/agent-auth-context-core.mjs';
import {
  AuthorityResolutionError,
  resolveAuthority,
  type AuthorityRequest,
} from '@/lib/authority/authority.mjs';

export type UnifiedAgentAuthResult =
  | UnifiedAgentAuthenticationContext
  | { error: Response };

export type AuthenticatedAuthorityRequest = Omit<
  AuthorityRequest,
  'subjectAgentIdentityId'
> & {
  subjectAgentIdentityId?: string;
};

function errorResponse(message: string, status: number) {
  return { error: Response.json({ error: message }, { status }) };
}

function extractBearerToken(request: Request) {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
  return authHeader.slice('Bearer '.length).trim();
}

/**
 * Compatibility authentication entrypoint for the staged v1 -> v2 migration.
 *
 * Legacy User/ApiKey callers retain their existing control-plane identity and
 * route-level scopes, but are never converted into a protocol AgentIdentity or
 * Principal. v2 AgentCredential callers resolve to stable Principal + Agent.
 * Neither branch grants economic authority at this stage.
 */
export async function authenticateAgentContext(
  request: Request,
): Promise<UnifiedAgentAuthResult> {
  const rawToken = extractBearerToken(request);
  if (!rawToken) {
    return errorResponse('缺少 Authorization 头，格式: Bearer <credential>', 401);
  }

  const credentialFamily = classifyAgentBearerToken(rawToken);

  if (credentialFamily === 'v2_agent_credential') {
    const auth = await authenticateV2Agent(request);
    if ('error' in auth) return auth;
    return createV2AgentAuthenticationContext(auth);
  }

  if (credentialFamily === 'legacy_user_api_key') {
    const auth = await authenticateAgent(request);
    if ('error' in auth) return auth;
    return createLegacyAgentAuthenticationContext(auth);
  }

  return errorResponse('无法识别的 Agent Credential 格式', 401);
}

/**
 * Resolve Mandate/Delegation authority for an already authenticated v2 Agent.
 *
 * The authenticated AgentIdentity is authoritative: callers cannot substitute
 * another subjectAgentIdentityId. The resolved root Principal must also match
 * the Principal reached through the credential. Legacy API keys are rejected
 * regardless of their legacy scope strings.
 *
 * IMPORTANT: the returned context is not yet an executable economic-command
 * authorization. Economic payload signature verification remains a separate
 * required security stage before future protocol state transitions.
 */
export async function resolveAuthenticatedAgentAuthority(
  request: Request,
  authorityRequest: AuthenticatedAuthorityRequest,
): Promise<AuthenticatedAuthorityContext | { error: Response }> {
  const authentication = await authenticateAgentContext(request);
  if ('error' in authentication) return authentication;

  if (authentication.kind !== 'v2_agent_credential') {
    return errorResponse(
      'Legacy API Key 仅兼容 v1 访问，不能建立 v2 协议经济权限',
      403,
    );
  }

  if (
    authorityRequest.subjectAgentIdentityId &&
    authorityRequest.subjectAgentIdentityId !== authentication.agent.id
  ) {
    return errorResponse('认证 Agent 与请求的授权主体不一致', 403);
  }

  try {
    const authority = await resolveAuthority(prisma, {
      ...authorityRequest,
      subjectAgentIdentityId: authentication.agent.id,
    });

    return bindAuthorityToAuthentication(authentication, authority);
  } catch (error) {
    if (
      error instanceof AuthorityResolutionError ||
      error instanceof AuthenticationContextError
    ) {
      return errorResponse(error.message, 403);
    }

    console.error('[auth-agent-context] authority resolution failed:', error);
    return errorResponse('授权解析失败', 500);
  }
}
