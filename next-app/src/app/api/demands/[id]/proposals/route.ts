import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';
import { getDemandById } from '@/lib/db/demands';
import { getProposals } from '@/lib/db/proposals';
import prisma from '@/lib/db/client';
import type { UserRole } from '@/types';

const ADMIN_ROLES: UserRole[] = ['admin', 'operator'];

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/**
 * GET /api/demands/[id]/proposals
 *
 * List proposals for a demand. Only the demand owner or admin can view.
 * Includes supplier organization name.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;

    // Verify demand exists
    const demand = await getDemandById(id);
    if (!demand) {
      return NextResponse.json(
        { error: '需求不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    // Check ownership or admin role
    const isAdmin = ADMIN_ROLES.includes(auth.user.role as UserRole);
    if (!isAdmin) {
      // Fetch raw row for reliable ownerUserId comparison
      const rawRow = await prisma.demand.findUnique({ where: { id } });
      if (!rawRow || rawRow.ownerUserId !== auth.user.id) {
        return NextResponse.json(
          { error: '无权查看该需求的提案' },
          { status: 403, headers: corsHeaders() },
        );
      }
    }

    // Fetch proposals for this demand with supplier org info
    const proposals = await getProposals({ demandId: id });

    // Enrich with supplier org name
    const enriched = await Promise.all(
      proposals.map(async (p) => {
        const org = await prisma.organization.findUnique({
          where: { id: p.supplierId },
          select: { name: true, logo: true },
        });
        return {
          ...p,
          supplierOrgName: org?.name ?? '未知供应商',
          supplierOrgLogo: org?.logo ?? null,
        };
      }),
    );

    return apiSuccess(enriched);
  } catch (error) {
    return handleApiError(error);
  }
}
