import { getAgentById } from '@/lib/db/agents';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const agent = await getAgentById(id);

    if (!agent) {
      return Response.json(
        { error: 'Agent 不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    return apiSuccess(agent);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
