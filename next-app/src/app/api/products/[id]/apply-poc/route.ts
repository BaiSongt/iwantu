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

    if (!product.supportPoc) {
      return Response.json(
        { error: '该产品不支持 POC' },
        { status: 400, headers: corsHeaders() },
      );
    }

    const body = await request.json();

    return apiSuccess(
      {
        success: true,
        message: `POC application submitted for "${product.name}" by ${product.company}`,
        poc: {
          id: `poc-${Date.now()}`,
          productId: product.id,
          productName: product.name,
          company: product.company,
          status: 'not_started',
          description: body.description ?? '',
        },
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
