import { matchDemand } from '@/lib/db/demands';
import { apiSuccess, handleApiError } from '@/lib/api-utils';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const result = await matchDemand(id);

    if (!result) {
      return Response.json({ error: '需求不存在' }, { status: 404 });
    }

    return apiSuccess(result);
  } catch (error) {
    return handleApiError(error);
  }
}
