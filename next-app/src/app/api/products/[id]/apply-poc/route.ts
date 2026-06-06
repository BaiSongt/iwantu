import { PRODUCTS } from '@/lib/constants';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const product = PRODUCTS.find((p) => p.id === id);

  if (!product) {
    return Response.json(
      { error: 'Product not found' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  if (!product.supportPoc) {
    return Response.json(
      { error: 'This product does not support POC' },
      { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  const body = await request.json();

  return Response.json(
    {
      data: {
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
    },
    { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
