import { getPocProjects, getPocForUser, createPocFromProposal } from '@/lib/db/poc';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';
import type { UserRole } from '@/types';

const ADMIN_ROLES: UserRole[] = ['admin', 'operator'];

/**
 * GET /api/poc — List POC projects
 * Filtered by user participation (or all for admin/opc_team)
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { searchParams } = new URL(request.url);
    const isAdmin = ADMIN_ROLES.includes(auth.user.role as UserRole);

    if (isAdmin) {
      // Admin / OPC team can see all POCs with optional filters
      const filters: Parameters<typeof getPocProjects>[0] = {};
      const status = searchParams.get('status');
      const demandId = searchParams.get('demandId');
      const supplierOrgId = searchParams.get('supplierOrgId');

      if (status) filters.status = status;
      if (demandId) filters.demandId = demandId;
      if (supplierOrgId) filters.supplierOrgId = supplierOrgId;

      const pocs = await getPocProjects(filters);
      return apiSuccess(pocs);
    }

    // Regular users see only their POCs
    const pocs = await getPocForUser(auth.user.id);
    return apiSuccess(pocs);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/poc — Create a POC project (from accepted proposal)
 * Body: { demandId, productId?, supplierOrgId?, acceptanceCriteria? }
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();

    if (!body.demandId) {
      return Response.json(
        { error: 'demandId 为必填项' },
        { status: 400, headers: corsHeaders() },
      );
    }

    // Verify user owns the demand or is admin
    const isAdmin = ADMIN_ROLES.includes(auth.user.role as UserRole);
    if (!isAdmin) {
      const prisma = (await import('@/lib/db/client')).default;
      const demand = await prisma.demand.findUnique({
        where: { id: body.demandId },
      });
      if (!demand) {
        return Response.json(
          { error: '需求不存在' },
          { status: 404, headers: corsHeaders() },
        );
      }
      if (demand.ownerUserId !== auth.user.id) {
        return Response.json(
          { error: '只有需求创建者可以发起 POC' },
          { status: 403, headers: corsHeaders() },
        );
      }
    }

    const poc = await createPocFromProposal({
      demandId: body.demandId,
      productId: body.productId,
      supplierOrgId: body.supplierOrgId,
      acceptanceCriteria: body.acceptanceCriteria,
      buyerUserId: auth.user.id,
      buyerOrgId: auth.user.orgId ?? undefined,
    });

    if (!poc) {
      return Response.json(
        { error: '创建 POC 失败' },
        { status: 500, headers: corsHeaders() },
      );
    }

    return apiSuccess(poc, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
