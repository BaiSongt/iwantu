import { NextRequest } from 'next/server';
import { getAgents } from '@/lib/db/agents';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const filters = {
      status: searchParams.get('status') ?? undefined,
      riskLevel: searchParams.get('riskLevel') ?? undefined,
      search: searchParams.get('search') ?? undefined,
    };

    const agents = await getAgents(filters);
    return apiSuccess(agents);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
