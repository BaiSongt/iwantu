import { getSolutionById } from '@/lib/db/solutions';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const solution = await getSolutionById(id);

    if (!solution) {
      return Response.json(
        { error: '解决方案不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    return apiSuccess(solution);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
