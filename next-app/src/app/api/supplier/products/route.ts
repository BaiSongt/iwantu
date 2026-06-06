import { NextResponse } from 'next/server';
import { getProducts, createProduct } from '@/lib/db/products';
import { requireRole } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  try {
    const auth = await requireRole(request, ['supplier']);
    if ('error' in auth) return auth.error;

    const products = await getProducts({ orgId: auth.user.orgId });

    return apiSuccess(products);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireRole(request, ['supplier']);
    if ('error' in auth) return auth.error;

    const body = await request.json();

    const product = await createProduct({
      orgId: auth.user.orgId,
      name: body.name ?? '',
      summary: body.summary ?? '',
      description: body.description,
      coverImage: body.coverImage,
      category: body.category ?? '',
      industryTags: body.industryTags,
      capabilityTags: body.capabilityTags,
      deploymentModes: body.deploymentModes,
      pricingModel: body.pricingModel,
      price: body.price,
      supportPoc: body.supportPoc,
      supportPrivateDeployment: body.supportPrivateDeployment,
      accent: body.accent,
      shot: body.shot,
      tags: body.tags,
    });

    if (!product) {
      return NextResponse.json(
        { error: '创建产品失败' },
        { status: 500, headers: corsHeaders() },
      );
    }

    return apiSuccess(product, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
