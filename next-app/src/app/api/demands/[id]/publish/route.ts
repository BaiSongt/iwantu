import { publishDemand } from '@/lib/db/demands';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError } from '@/lib/api-utils';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;
    const demand = await publishDemand(id);

    if (!demand) {
      return Response.json({ error: '需求不存在' }, { status: 404 });
    }

    return apiSuccess(demand);
  } catch (error) {
    return handleApiError(error);
  }
}
