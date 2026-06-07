import { getDemandById, updateDemand, deleteDemand } from '@/lib/db/demands';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError } from '@/lib/api-utils';
import type { UserRole } from '@/types';

/** Roles that can bypass ownership checks. */
const ADMIN_ROLES: UserRole[] = ['admin', 'opc_team', 'operator'];

/** Valid status transitions: from -> set of allowed to. */
const STATUS_TRANSITIONS: Record<string, Set<string>> = {
  draft: new Set(['clarifying', 'collecting_proposals', 'closed']),
  clarifying: new Set(['collecting_proposals', 'draft', 'closed']),
  awaiting_quote: new Set(['collecting_proposals', 'closed']),
  collecting_proposals: new Set(['in_poc', 'closed']),
  in_poc: new Set(['closed_deal', 'closed']),
  closed_deal: new Set(['closed']),
  closed: new Set(),
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const demand = await getDemandById(id);

    if (!demand) {
      return Response.json({ error: '需求不存在' }, { status: 404 });
    }

    return apiSuccess(demand);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;

    // Fetch existing demand for ownership & status checks
    const existing = await getDemandById(id);
    if (!existing) {
      return Response.json({ error: '需求不存在' }, { status: 404 });
    }

    // Ownership check via raw row (ownerUser in toDemandShape is just a name string)
    const isAdmin = ADMIN_ROLES.includes(auth.user.role as UserRole);
    const prisma = (await import('@/lib/db/client')).default;
    const rawRow = await prisma.demand.findUnique({ where: { id } });
    if (!rawRow) {
      return Response.json({ error: '需求不存在' }, { status: 404 });
    }
    if (!isAdmin && rawRow.ownerUserId !== auth.user.id) {
      return Response.json({ error: '无权修改此需求' }, { status: 403 });
    }

    const body = await request.json();

    // Status transition validation
    if (body.status && body.status !== existing.status) {
      const currentStatus = existing.status as string;
      const newStatus = body.status as string;
      const allowed = STATUS_TRANSITIONS[currentStatus];
      if (!allowed || !allowed.has(newStatus)) {
        return Response.json(
          { error: `不允许从 "${currentStatus}" 变更为 "${newStatus}"` },
          { status: 400 },
        );
      }
    }

    // Only pass allowed fields to update
    const updateData: Record<string, unknown> = {};
    const allowedFields = [
      'title', 'industry', 'budgetRange', 'budgetMin', 'budgetMax',
      'deliveryPeriod', 'dataTypes', 'deploymentRequirement',
      'description', 'painPoints', 'existingSystems',
      'supportPoc', 'allowAiSupplier', 'allowAiAutoBid',
    ];
    for (const field of allowedFields) {
      if (field in body) {
        updateData[field] = body[field];
      }
    }
    if (body.status) {
      updateData['status'] = body.status;
    }

    const demand = await updateDemand(id, updateData);
    if (!demand) {
      return Response.json({ error: '更新需求失败' }, { status: 500 });
    }

    return apiSuccess(demand);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;

    // Fetch existing demand
    const existing = await getDemandById(id);
    if (!existing) {
      return Response.json({ error: '需求不存在' }, { status: 404 });
    }

    // Ownership check
    const isAdmin = ADMIN_ROLES.includes(auth.user.role as UserRole);
    const prisma = (await import('@/lib/db/client')).default;
    const rawRow = await prisma.demand.findUnique({ where: { id } });
    if (!rawRow) {
      return Response.json({ error: '需求不存在' }, { status: 404 });
    }
    if (!isAdmin && rawRow.ownerUserId !== auth.user.id) {
      return Response.json({ error: '无权删除此需求' }, { status: 403 });
    }

    // Only allow delete if status is draft
    if (existing.status !== 'draft' && !isAdmin) {
      return Response.json(
        { error: '仅草稿状态的需求可以删除' },
        { status: 400 },
      );
    }

    const ok = await deleteDemand(id);
    if (!ok) {
      return Response.json({ error: '删除需求失败' }, { status: 500 });
    }

    return apiSuccess({ deleted: true });
  } catch (error) {
    return handleApiError(error);
  }
}
