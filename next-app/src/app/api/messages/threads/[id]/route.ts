import { requireAuth } from '@/lib/auth-helpers';
import { getThreadById } from '@/lib/db/messages';
import { apiSuccess, handleApiError } from '@/lib/api-utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;
    const result = await getThreadById(id);

    if (!result) {
      return Response.json(
        { error: '线程不存在' },
        { status: 404 },
      );
    }

    return apiSuccess({ ...result.thread, messages: result.messages });
  } catch (error) {
    return handleApiError(error);
  }
}
