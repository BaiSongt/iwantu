import { requireAuth } from '@/lib/auth-helpers';
import prisma from '@/lib/db/client';
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

    // Verify the user is a participant of this thread
    const participant = await prisma.threadParticipant.findUnique({
      where: { threadId_userId: { threadId: id, userId: auth.user.id } },
    });
    if (!participant) {
      return Response.json(
        { error: '无权查看此会话' },
        { status: 403 },
      );
    }

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
