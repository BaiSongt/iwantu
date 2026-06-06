import { NextResponse } from 'next/server';
import { getProposalById } from '@/lib/db/proposals';
import { requireRole } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRole(request, ['supplier']);
    if ('error' in auth) return auth.error;

    const { id } = await params;
    const proposal = await getProposalById(id);

    if (!proposal) {
      return NextResponse.json(
        { error: '提案不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    // 验证提案属于当前供应商组织
    if (proposal.supplierId !== auth.user.orgId) {
      return NextResponse.json(
        { error: '无权限访问该提案' },
        { status: 403, headers: corsHeaders() },
      );
    }

    return apiSuccess(proposal);
  } catch (error) {
    return handleApiError(error);
  }
}
