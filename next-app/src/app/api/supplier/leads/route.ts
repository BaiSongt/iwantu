import { DEMANDS } from '@/lib/constants';
import type { Demand } from '@/types';

export async function GET() {
  // Return all demands as leads for the supplier (mock)
  return Response.json(
    { data: DEMANDS satisfies Demand[] },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
