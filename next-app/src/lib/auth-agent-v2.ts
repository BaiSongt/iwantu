import prisma from '@/lib/db/client';
import { authenticateAgentApiToken } from '@/lib/agent-auth-core.mjs';

export interface V2PrincipalIdentity {
  id: string;
  type: 'individual' | 'organization';
  status: 'active' | 'suspended';
}

export interface V2AgentIdentity {
  id: string;
  name: string;
  status: 'active' | 'suspended' | 'retired';
}

export interface V2AgentCredentialIdentity {
  id: string;
  keyId: string;
  kind: 'api';
  status: 'active';
}

export interface V2AgentAuthResult {
  principal: V2PrincipalIdentity;
  agent: V2AgentIdentity;
  credential: V2AgentCredentialIdentity;
}

function errorResponse(message: string, status: number) {
  return { error: Response.json({ error: message }, { status }) };
}

/**
 * Authenticate a v2 Agent request using an AgentCredential.
 *
 * This abstraction answers only identity: which credential, AgentIdentity and
 * Principal are acting. It grants no economic authority. Any state-changing
 * v2 economic command must subsequently pass Mandate/Delegation/Policy checks.
 *
 * The current legacy authenticateAgent()/MCP path remains unchanged during M1.
 */
export async function authenticateV2Agent(
  request: Request,
): Promise<V2AgentAuthResult | { error: Response }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse(
      '缺少 Authorization 头，格式: Bearer iwantu_ac_xxx',
      401,
    );
  }

  const rawToken = authHeader.slice('Bearer '.length).trim();

  try {
    const result = await authenticateAgentApiToken(prisma, rawToken);
    if (!result.ok) {
      switch (result.reason) {
        case 'agent_inactive':
          return errorResponse('Agent Identity 当前不可用于新请求', 403);
        case 'principal_inactive':
          return errorResponse('Principal 当前不可用于新请求', 403);
        case 'credential_expired':
          return errorResponse('Agent API Credential 已过期', 401);
        case 'credential_not_yet_valid':
          return errorResponse('Agent API Credential 尚未生效', 401);
        case 'credential_inactive':
          return errorResponse('Agent API Credential 已停用', 401);
        case 'malformed':
          return errorResponse('无效的 v2 Agent API Credential 格式', 401);
        default:
          return errorResponse('Agent API Credential 无效', 401);
      }
    }

    return {
      principal: result.principal,
      agent: result.agent,
      credential: result.credential,
    } as V2AgentAuthResult;
  } catch (error) {
    console.error('[auth-agent-v2] authenticateV2Agent failed:', error);
    return errorResponse('认证失败', 500);
  }
}