import { NextRequest } from 'next/server';
import { getCompanies } from '@/lib/db/companies';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const filters = {
      industry: searchParams.get('industry') ?? undefined,
      certified: searchParams.get('certified') === 'true' ? true : searchParams.get('certified') === 'false' ? false : undefined,
      search: searchParams.get('search') ?? undefined,
    };

    const companies = await getCompanies(filters);
    return apiSuccess(companies);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
