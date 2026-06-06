import { getCompanyById } from '@/lib/db/companies';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const company = await getCompanyById(id);

    if (!company) {
      return Response.json(
        { error: '公司不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    return apiSuccess(company);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
