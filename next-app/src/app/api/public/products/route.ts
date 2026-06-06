import { NextRequest } from 'next/server';
import { getProducts } from '@/lib/db/products';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl;
    const filters = {
      industry: searchParams.get('industry') ?? undefined,
      category: searchParams.get('category') ?? undefined,
      status: searchParams.get('status') ?? undefined,
      search: searchParams.get('search') ?? undefined,
    };

    const products = await getProducts(filters);
    return apiSuccess(products);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
