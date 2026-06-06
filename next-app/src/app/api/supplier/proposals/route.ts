import { NextResponse } from 'next/server';
import { getProposals, createProposal } from '@/lib/db/proposals';
import { requireRole } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  try {
    const auth = await requireRole(request, ['supplier']);
    if ('error' in auth) return auth.error;

    const proposals = await getProposals({
      supplierOrgId: auth.user.orgId ?? undefined,
    });

    return apiSuccess(proposals);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ['supplier']);
    if ('error' in auth) return auth.error;

    if (!auth.user.orgId) {
      return NextResponse.json(
        { error: '请先创建或加入组织' },
        { status: 403 },
      );
    }

    const body = await request.json();

    const proposal = await createProposal({
      demandId: body.demandId ?? '',
      supplierOrgId: auth.user.orgId,
      title: body.title ?? '',
      scope: body.scope ?? '',
      price: body.price ?? 0,
      currency: body.currency,
      deliveryPeriod: body.deliveryPeriod,
      milestones: body.milestones,
      quoteItems: body.quoteItems,
    });

    if (!proposal) {
      return NextResponse.json(
        { error: '创建提案失败' },
        { status: 500, headers: corsHeaders() },
      );
    }

    return apiSuccess(proposal, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
