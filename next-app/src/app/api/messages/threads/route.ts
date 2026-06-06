import { requireAuth } from '@/lib/auth-helpers';
import { getThreads, createThread } from '@/lib/db/messages';
import { apiSuccess, handleApiError } from '@/lib/api-utils';

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const threads = await getThreads(auth.user.id);
    return apiSuccess(threads);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const { title, type, relatedId, participantIds } = body;

    if (!title || !type || !participantIds?.length) {
      return Response.json(
        { error: '缺少必要字段：title, type, participantIds' },
        { status: 400 },
      );
    }

    const thread = await createThread({
      title,
      type,
      relatedId,
      participantIds,
    });

    if (!thread) {
      return Response.json(
        { error: '创建线程失败' },
        { status: 500 },
      );
    }

    return apiSuccess(thread, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
