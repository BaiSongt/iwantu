import { PRODUCTS } from '@/lib/constants';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const agent = PRODUCTS.find(
    (p) => p.id === id && p.tags.some((t) => t.toLowerCase().includes('agent')),
  );

  if (!agent) {
    return Response.json(
      { error: 'Agent not found' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  return Response.json(
    { data: agent },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
