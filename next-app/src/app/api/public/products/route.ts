import { PRODUCTS } from '@/lib/constants';
import type { Product } from '@/types';

export async function GET() {
  return Response.json(
    { data: PRODUCTS satisfies Product[] },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
