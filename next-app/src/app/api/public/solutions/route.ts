import { NextRequest } from 'next/server';
import { getSolutions } from '@/lib/db/solutions';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const filters = {
      industry: searchParams.get('industry') ?? undefined,
      supportPoc: searchParams.get('supportPoc') === 'true' ? true : undefined,
      search: searchParams.get('search') ?? undefined,
    };

    const solutions = await getSolutions(filters);
    return apiSuccess(solutions);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
