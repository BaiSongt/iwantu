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

  const body = await request.json();

  return Response.json(
    {
      data: {
        success: true,
        message: `Contact request sent to ${product.company} for "${product.name}"`,
        contactInfo: {
          company: product.company,
          productId: product.id,
          productName: product.name,
          note: body.message ?? '',
        },
      },
    },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
