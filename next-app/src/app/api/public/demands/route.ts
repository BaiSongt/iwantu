import { DEMANDS } from '@/lib/constants';
import type { Demand } from '@/types';

export async function GET() {
  // Return only public-safe fields for each demand
  const publicDemands: Partial<Demand>[] = DEMANDS.map(
    ({ ownerUser, ownerOrg, ...rest }) => rest,
  );

  return Response.json(
    { data: publicDemands },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
