import { getProductById } from '@/lib/db/products';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const product = await getProductById(id);

    if (!product) {
      return Response.json(
        { error: '产品不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    return apiSuccess(product);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
