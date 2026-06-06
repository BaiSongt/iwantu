import { NextResponse } from 'next/server';
import { getProductById, updateProduct } from '@/lib/db/products';
import { requireAuth, requireRole } from '@/lib/auth-helpers';
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
    const product = await getProductById(id);

    if (!product) {
      return NextResponse.json(
        { error: '产品不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    // 验证产品属于当前用户的组织
    if ((product as Record<string, unknown>).orgId !== auth.user.orgId) {
      return NextResponse.json(
        { error: '无权限访问该产品' },
        { status: 403, headers: corsHeaders() },
      );
    }

    return apiSuccess(product);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRole(request, ['supplier']);
    if ('error' in auth) return auth.error;

    const { id } = await params;

    // 先验证产品存在且属于当前组织
    const existing = await getProductById(id);
    if (!existing) {
      return NextResponse.json(
        { error: '产品不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    if ((existing as Record<string, unknown>).orgId !== auth.user.orgId) {
      return NextResponse.json(
        { error: '无权限修改该产品' },
        { status: 403, headers: corsHeaders() },
      );
    }

    const body = await request.json();
    const updated = await updateProduct(id, body);

    if (!updated) {
      return NextResponse.json(
        { error: '更新产品失败' },
        { status: 500, headers: corsHeaders() },
      );
    }

    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
