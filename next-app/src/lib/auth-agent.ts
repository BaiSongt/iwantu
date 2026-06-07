/**
 * Agent Authentication Middleware
 *
 * Authenticates AI agents via API keys in the Authorization header.
 * Extracts "Bearer iwantu_xxx" tokens, validates against the database,
 * checks expiry and scopes, and updates lastUsedAt on success.
 */

import prisma from '@/lib/db/client';

export interface AgentUser {
  id: string;
  name: string;
  email: string;
  role: string;
  orgId?: string;
}

export interface AgentAuthResult {
  user: AgentUser;
  scopes: string[];
}

/**
 * Authenticate an agent request by extracting the API key from the
 * Authorization header ("Bearer iwantu_xxx"), looking it up in the database,
 * verifying it hasn't expired, and updating lastUsedAt.
 *
 * @param request - The incoming Request object
 * @returns AgentAuthResult on success, or { error: Response } on failure
 */
export async function authenticateAgent(
  request: Request,
): Promise<AgentAuthResult | { error: Response }> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      error: Response.json(
        { error: '缺少 Authorization 头，格式: Bearer iwantu_xxx' },
        { status: 401 },
      ),
    };
  }

  const key = authHeader.slice('Bearer '.length).trim();
  if (!key.startsWith('iwantu_')) {
    return {
      error: Response.json(
        { error: '无效的 API Key 格式' },
        { status: 401 },
      ),
    };
  }

  try {
    const apiKey = await prisma.apiKey.findUnique({
      where: { key },
      include: { user: true },
    });

    if (!apiKey) {
      return {
        error: Response.json(
          { error: 'API Key 不存在' },
          { status: 401 },
        ),
      };
    }

    // Check expiry
    if (apiKey.expiresAt && apiKey.expiresAt < new Date()) {
      return {
        error: Response.json(
          { error: 'API Key 已过期' },
          { status: 401 },
        ),
      };
    }

    // Update lastUsedAt (fire-and-forget)
    prisma.apiKey
      .update({
        where: { id: apiKey.id },
        data: { lastUsedAt: new Date() },
      })
      .catch(() => {
        // Silently ignore update errors
      });

    return {
      user: {
        id: apiKey.user.id,
        name: apiKey.user.name,
        email: apiKey.user.email,
        role: apiKey.user.role,
        orgId: apiKey.user.orgId ?? undefined,
      },
      scopes: apiKey.scopes,
    };
  } catch (error) {
    console.error('[auth-agent] authenticateAgent failed:', error);
    return {
      error: Response.json(
        { error: '认证失败' },
        { status: 500 },
      ),
    };
  }
}

/**
 * Require a specific scope on the authenticated agent.
 * First authenticates the agent, then checks if the required scope
 * is present in the agent's scopes. Supports wildcard "write:*" matching.
 *
 * @param request - The incoming Request object
 * @param scope - The required scope string (e.g. "read", "write:demand")
 * @returns AgentAuthResult on success, or { error: Response } on failure
 */
export async function requireScope(
  request: Request,
  scope: string,
): Promise<AgentAuthResult | { error: Response }> {
  const auth = await authenticateAgent(request);
  if ('error' in auth) return auth;

  const scopes = auth.scopes;

  // Direct match
  if (scopes.includes(scope)) return auth;

  // Wildcard: "admin" scope grants everything
  if (scopes.includes('admin')) return auth;

  // Wildcard: "write:*" matches any "write:xxx"
  if (scope.startsWith('write:') && scopes.includes('write:*')) return auth;

  // Wildcard: "read" scope covers all read operations
  if (scope === 'read' && scopes.includes('read')) return auth;

  return {
    error: Response.json(
      { error: `缺少所需权限: ${scope}` },
      { status: 403 },
    ),
  };
}
