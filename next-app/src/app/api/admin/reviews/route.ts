/**
 * Admin Content Review API
 *
 * GET /api/admin/reviews — List products pending review
 *   requireRole(['admin', 'opc_team'])
 *   Query: status (pending_review, needs_info, or both by default)
 *
 * PUT /api/admin/reviews — Review a product
 *   Body: { productId, action: 'approve' | 'needs_info' | 'delist', reason? }
 *   Update product status accordingly
 */

import { requireRole } from '@/lib/auth-helpers';
import prisma from '@/lib/db/client';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

const VALID_REVIEW_STATUSES: string[] = ['pending_review', 'needs_info'];

export async function GET(request: Request) {
  try {
    const auth = await requireRole(request, ['admin', 'opc_team']);
    if ('error' in auth) return auth.error;

    const url = new URL(request.url);
    const statusFilter = url.searchParams.get('status');

    // By default show both pending_review and needs_info
    const statuses = statusFilter
      ? [statusFilter]
      : VALID_REVIEW_STATUSES;

    const products = await prisma.product.findMany({
      where: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        status: { in: statuses as any },
      },
      include: {
        organization: {
          select: { id: true, name: true, logo: true },
        },
      },
      orderBy: { createdAt: 'asc' }, // Oldest first for review queue
    });

    const items = products.map((p) => ({
      id: p.id,
      name: p.name,
      summary: p.summary,
      category: p.category,
      status: p.status,
      company: p.organization?.name ?? '',
      companyLogo: p.organization?.logo ?? null,
      createdAt: p.createdAt.toISOString(),
    }));

    return apiSuccess(items);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireRole(request, ['admin', 'opc_team']);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const { productId, action, reason } = body;

    if (!productId || !action) {
      return Response.json(
        { error: '缺少必要字段：productId, action' },
        { status: 400 },
      );
    }

    // Validate action
    const statusMap: Record<string, string> = {
      approve: 'published',
      needs_info: 'needs_info',
      delist: 'delisted',
    };

    const newStatus = statusMap[action];
    if (!newStatus) {
      return Response.json(
        { error: '无效的操作类型，支持: approve, needs_info, delist' },
        { status: 400 },
      );
    }

    // Check product exists
    const product = await prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      return Response.json(
        { error: '产品不存在' },
        { status: 404 },
      );
    }

    // Update product status
    const updated = await prisma.product.update({
      where: { id: productId },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { status: newStatus as any },
      include: {
        organization: {
          select: { id: true, name: true },
        },
      },
    });

    // Create notification for the product owner's org members
    try {
      const orgMembers = await prisma.organizationMember.findMany({
        where: { orgId: updated.orgId },
        select: { userId: true },
      });

      const actionLabels: Record<string, string> = {
        approve: '已通过审核',
        needs_info: '需要补充信息',
        delist: '已被下架',
      };

      for (const member of orgMembers) {
        await prisma.notification.create({
          data: {
            userId: member.userId,
            type: 'system',
            title: `产品审核结果: ${updated.name}`,
            content: `您的产品「${updated.name}」${actionLabels[action]}。${reason ? `原因: ${reason}` : ''}`,
            link: `/products/${updated.id}`,
          },
        });
      }
    } catch {
      // Notification creation should not block the main operation
    }

    return apiSuccess({
      id: updated.id,
      name: updated.name,
      status: updated.status,
      company: updated.organization?.name ?? '',
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
