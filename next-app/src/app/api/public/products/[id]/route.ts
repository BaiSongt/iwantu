import { PRODUCTS } from '@/lib/constants';

export async function GET(
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

  return Response.json(
    { data: product },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
