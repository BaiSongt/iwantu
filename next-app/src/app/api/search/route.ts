import { NextRequest } from 'next/server';
import { searchAll } from '@/lib/db/search';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  try {
    const q = request.nextUrl.searchParams.get('q') ?? '';
    const result = await searchAll(q);

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
