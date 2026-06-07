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
 *   category       - filter by product category
 *   search         - text search on name / summary / description
 *   industry       - filter by industry tag
 *   status         - filter by status (defaults to 'published')
 *   deploymentMode - filter by deployment mode (saas, private_cloud, on_premise, hybrid)
 *   pricingModel   - filter by pricing model
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const category = searchParams.get('category') || undefined;
    const search = searchParams.get('search') || undefined;
    const industry = searchParams.get('industry') || undefined;
    const status = searchParams.get('status') || 'published';
    const deploymentMode = searchParams.get('deploymentMode') || undefined;
    const pricingModel = searchParams.get('pricingModel') || undefined;

    const products = await getProducts({
      category,
      search,
      industry,
      status,
      deploymentMode,
      pricingModel,
    });

    return apiSuccess(products);
  } catch (error) {
    return handleApiError(error);
  }
}
