import { SOLUTIONS } from '@/lib/constants';
import type { Solution } from '@/types';

export async function GET() {
  return Response.json(
    { data: SOLUTIONS satisfies Solution[] },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
