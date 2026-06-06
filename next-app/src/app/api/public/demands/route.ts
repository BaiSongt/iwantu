import { getDemands } from '@/lib/db/demands';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET() {
  try {
    const demands = await getDemands({ status: 'collecting_proposals' });

    // Return only public-safe fields for each demand
    const publicDemands = demands.map(({ ownerUser, ownerOrg, ...rest }) => rest);

    return apiSuccess(publicDemands);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
