import { NextRequest } from 'next/server';
import { searchAll } from '@/lib/db/search';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const q = sp.get('q') ?? '';
    const type = sp.get('type') as 'all' | 'products' | 'demands' | 'companies' | 'solutions' | null;
    const industry = sp.get('industry') ?? undefined;
    const category = sp.get('category') ?? undefined;
    const status = sp.get('status') ?? undefined;

    const result = await searchAll(q, {
      type: type ?? undefined,
      industry,
      category,
      status,
    });

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
