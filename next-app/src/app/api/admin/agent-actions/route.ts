/**
 * Agent Action Audit — Admin API
 *
 * GET /api/admin/agent-actions — List agent action logs with pagination
 *   Requires role: admin or opc_team
 *   Query params: userId, action, riskLevel, page, limit
 */

import { requireRole } from '@/lib/auth-helpers';
import prisma from '@/lib/db/client';
import { apiSuccess, handleApiError, corsHeaders, paginateResults } from '@/lib/api-utils';

export async function GET(request: Request) {
  try {
    const auth = await requireRole(request, ['admin', 'opc_team']);
    if ('error' in auth) return auth.error;

    const url = new URL(request.url);
    const userId = url.searchParams.get('userId');
    const action = url.searchParams.get('action');
    const riskLevel = url.searchParams.get('riskLevel');
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));

    // Build where clause
    const where: Record<string, unknown> = {};

    if (userId) {
      where.delegatorUserId = userId;
    }
    if (action) {
      where.actionType = action;
    }
    if (riskLevel) {
      where.riskLevel = riskLevel;
    }

    const [total, rows] = await Promise.all([
      prisma.agentAction.count({ where }),
      prisma.agentAction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          delegator: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      }),
    ]);

    const items = rows.map((row) => ({
      id: row.id,
      agentId: row.agentId,
      userId: row.delegatorUserId,
      userName: row.delegator?.name ?? null,
      userEmail: row.delegator?.email ?? null,
      userRole: row.delegator?.role ?? null,
      organizationId: row.organizationId,
      actionType: row.actionType,
      targetType: row.targetType,
      targetId: row.targetId,
      riskLevel: row.riskLevel,
      decision: row.decision,
      approvalStatus: row.approvalStatus,
      createdAt: row.createdAt.toISOString(),
    }));

    return apiSuccess({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
