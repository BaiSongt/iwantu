import { PRODUCTS } from '@/lib/constants';

export async function GET() {
  // "Agents" are products that have 'Agent' in their tags
  const agents = PRODUCTS.filter(
    (p) => p.tags.some((t) => t.toLowerCase().includes('agent')),
  );

  return Response.json(
    { data: agents },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
