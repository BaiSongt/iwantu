import { getProductById } from '@/lib/db/products';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function POST(
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

    const body = await request.json();

    return apiSuccess({
      success: true,
      message: `Contact request sent to ${product.company} for "${product.name}"`,
      contactInfo: {
        company: product.company,
        productId: product.id,
        productName: product.name,
        note: body.message ?? '',
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
