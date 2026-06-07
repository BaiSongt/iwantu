import { NextResponse } from 'next/server';
import { getProducts } from '@/lib/db/products';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/**
 * GET /api/products — Public product listing.
 *
 * Query params:
 *   category  - filter by product category
 *   search    - text search on name / summary / description
 *   industry  - filter by industry tag
 *   status    - filter by status (defaults to 'published')
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const category = searchParams.get('category') || undefined;
    const search = searchParams.get('search') || undefined;
    const industry = searchParams.get('industry') || undefined;
    const status = searchParams.get('status') || 'published';

    const products = await getProducts({
      category,
      search,
      industry,
      status,
    });

    return apiSuccess(products);
  } catch (error) {
    return handleApiError(error);
  }
}
