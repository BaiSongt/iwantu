import prisma from '@/lib/db/client';
import {
  extractAgentCredentialKeyId,
  verifyAgentApiCredential,
} from '@/lib/agent-credential-core.mjs';

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
  kind: 'api' | 'signing' | 'oauth_a2a';
  status: 'active' | 'retired' | 'revoked';
}

export interface V2AgentAuthResult {
  principal: V2PrincipalIdentity;
  agent: V2AgentIdentity;
  credential: V2AgentCredentialIdentity;
  accessScopes: string[];
}

function authError(message: string, status = 401) {
  return { error: Response.json({ error: message }, { status }) };
}

/**
 * Authenticate a v2 Agent API credential without granting economic authority.
 *
 * Access credential authentication answers only "who is calling" and which
 * access-layer scopes were attached to this credential. Economic actions must
 * still pass Mandate/Authority resolution before execution.
 *
 * This is intentionally parallel to the legacy authenticateAgent() path. No
 * existing MCP/v1 route is cut over in M1-03.
 */
export async function authenticateV2Agent(
  request: Request,
): Promise<V2AgentAuthResult | { error: Response }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return authError('缺少 Authorization 头，格式: Bearer iwantu_v2_xxx');
  }

  const rawKey = authHeader.slice('Bearer '.length).trim();
  const keyId = extractAgentCredentialKeyId(rawKey);
  if (!keyId) return authError('无效的 v2 Agent API Credential 格式');

  try {
    const credential = await prisma.agentCredential.findUnique({
      where: { keyId },
      include: {
        agentIdentity: {
          include: { principal: true },
        },
      },
    });

    if (
      !credential ||
      credential.kind !== 'api' ||
      credential.status !== 'active' ||
      !credential.secretHash ||
      !verifyAgentApiCredential(rawKey, credential.secretHash)
    ) {
      return authError('Agent API Credential 无效');
    }

    if (credential.expiresAt && credential.expiresAt < new Date()) {
      return authError('Agent API Credential 已过期');
    }

    const agent = credential.agentIdentity;
    if (agent.status !== 'active') {
      return authError('Agent Identity 当前不可用于新请求', 403);
    }

    const principal = agent.principal;
    if (principal.status !== 'active') {
      return authError('Principal 当前不可用于新请求', 403);
    }

    prisma.agentCredential
      .update({
        where: { id: credential.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        // Authentication success must not depend on telemetry timestamp writes.
      });

    return {
      principal: {
        id: principal.id,
        type: principal.type,
        status: principal.status,
      },
      agent: {
        id: agent.id,
        name: agent.name,
        status: agent.status,
      },
      credential: {
        id: credential.id,
        keyId: credential.keyId,
        kind: credential.kind,
        status: credential.status,
      },
      accessScopes: credential.accessScopes,
    };
  } catch (error) {
    console.error('[auth-agent-v2] authenticateV2Agent failed:', error);
    return authError('认证失败', 500);
  }
}

/**
 * Access-scope gate only. This does not authorize economic commands; those
 * require a separate Mandate/Authority pipeline.
 */
export async function requireV2AccessScope(
  request: Request,
  scope: string,
): Promise<V2AgentAuthResult | { error: Response }> {
  const auth = await authenticateV2Agent(request);
  if ('error' in auth) return auth;

  if (auth.accessScopes.includes(scope)) return auth;
  return authError(`缺少所需访问权限: ${scope}`, 403);
}