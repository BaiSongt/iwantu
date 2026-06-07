import { getProductById } from '@/lib/db/products';
import { createPocFromProposal, addPocParticipant } from '@/lib/db/poc';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id: productId } = await params;
    const product = await getProductById(productId);

    if (!product) {
      return Response.json(
        { error: '产品不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    if (!product.supportPoc) {
      return Response.json(
        { error: '该产品不支持 POC' },
        { status: 400, headers: corsHeaders() },
      );
    }

    const body = await request.json();

    if (!body.demandId) {
      return Response.json(
        { error: 'demandId 为必填项' },
        { status: 400, headers: corsHeaders() },
      );
    }

    // Create the POC project in the database
    const poc = await createPocFromProposal({
      demandId: body.demandId,
      productId: product.id,
      supplierOrgId: product.orgId,
      acceptanceCriteria: body.acceptanceCriteria ?? [],
      buyerUserId: auth.user.id,
      buyerOrgId: auth.user.orgId ?? undefined,
    });

    if (!poc) {
      return Response.json(
        { error: '创建 POC 失败' },
        { status: 500, headers: corsHeaders() },
      );
    }

    // Add supplier as participant if orgId is available
    if (product.orgId) {
      const prisma = (await import('@/lib/db/client')).default;
      // Find a supplier user from the product's org
      const supplierMember = await prisma.organizationMember.findFirst({
        where: { orgId: product.orgId },
        include: { user: true },
      });
      if (supplierMember) {
        await addPocParticipant(
          poc.id,
          supplierMember.userId,
          'supplier',
          product.orgId,
        );
      }
    }

    // Re-fetch to include the supplier participant
    const { getPocById } = await import('@/lib/db/poc');
    const updatedPoc = await getPocById(poc.id);

    return apiSuccess(
      {
        success: true,
        message: `POC application submitted for "${product.name}"`,
        poc: updatedPoc ?? poc,
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
