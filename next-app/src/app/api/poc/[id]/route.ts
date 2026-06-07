import { getPocById, updatePocStatus, updateSampleDataStatus, isValidTransition } from '@/lib/db/poc';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';
import prisma from '@/lib/db/client';
import type { UserRole } from '@/types';
import type { PocStatus } from '@prisma/client';

const ADMIN_ROLES: UserRole[] = ['admin', 'opc_team', 'operator'];

/**
 * GET /api/poc/[id] — Get POC detail
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;
    const poc = await getPocById(id);

    if (!poc) {
      return Response.json(
        { error: 'POC 不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    // Verify user has access
    const isAdmin = ADMIN_ROLES.includes(auth.user.role as UserRole);
    if (!isAdmin) {
      const isParticipant = poc.participants.some(
        (p) => p.userId === auth.user.id,
      );
      if (!isParticipant) {
        return Response.json(
          { error: '无权查看此 POC' },
          { status: 403, headers: corsHeaders() },
        );
      }
    }

    return apiSuccess(poc);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/poc/[id] — Update POC (status transition, test metrics, criteria)
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;

    // Fetch existing POC
    const existing = await getPocById(id);
    if (!existing) {
      return Response.json(
        { error: 'POC 不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    // Verify user is a participant or admin
    const isAdmin = ADMIN_ROLES.includes(auth.user.role as UserRole);
    const isParticipant = existing.participants.some(
      (p) => p.userId === auth.user.id,
    );
    if (!isAdmin && !isParticipant) {
      return Response.json(
        { error: '无权修改此 POC' },
        { status: 403, headers: corsHeaders() },
      );
    }

    const body = await request.json();

    // Handle status transition
    if (body.status && body.status !== existing.status) {
      const newStatus = body.status as PocStatus;

      if (!isValidTransition(existing.status, newStatus)) {
        return Response.json(
          { error: `不允许从 "${existing.status}" 变更为 "${newStatus}"` },
          { status: 400, headers: corsHeaders() },
        );
      }

      const updated = await updatePocStatus(id, newStatus);
      if (!updated) {
        return Response.json(
          { error: '更新 POC 状态失败' },
          { status: 500, headers: corsHeaders() },
        );
      }
      return apiSuccess(updated);
    }

    // Handle sample data status update
    if (body.sampleDataStatus) {
      const updated = await updateSampleDataStatus(
        id,
        body.sampleDataStatus,
      );
      if (!updated) {
        return Response.json(
          { error: '更新样例数据状态失败' },
          { status: 500, headers: corsHeaders() },
        );
      }
      return apiSuccess(updated);
    }

    // Handle test metrics / acceptance criteria update
    if (body.testMetrics !== undefined || body.acceptanceCriteria !== undefined) {
      const updateData: Record<string, unknown> = {};
      if (body.testMetrics !== undefined) {
        updateData.testMetrics = body.testMetrics;
      }
      if (body.acceptanceCriteria !== undefined) {
        updateData.acceptanceCriteria = body.acceptanceCriteria;
      }

      await prisma.pocProject.update({
        where: { id },
        data: updateData,
      });

      // Reuse getPocById for consistent mapping
      const updated = await getPocById(id);
      return apiSuccess(updated);
    }

    // No actionable fields
    return Response.json(
      { error: '请提供需要更新的字段' },
      { status: 400, headers: corsHeaders() },
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
