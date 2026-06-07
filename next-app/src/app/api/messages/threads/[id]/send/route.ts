import { requireAuth } from '@/lib/auth-helpers';
import prisma from '@/lib/db/client';
import { sendMessage } from '@/lib/db/messages';
import { apiSuccess, handleApiError } from '@/lib/api-utils';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id: threadId } = await params;

    // Verify the user is a participant of this thread
    const participant = await prisma.threadParticipant.findUnique({
      where: { threadId_userId: { threadId, userId: auth.user.id } },
    });
    if (!participant) {
      return Response.json(
        { error: '无权在此会话中发送消息' },
        { status: 403 },
      );
    }

    const body = await request.json();
    const { content, isAiGenerated } = body;

    if (!content) {
      return Response.json(
        { error: '缺少必要字段：content' },
        { status: 400 },
      );
    }

    const message = await sendMessage(
      threadId,
      auth.user.id,
      content,
      isAiGenerated ?? false,
    );

    if (!message) {
      return Response.json(
        { error: '发送消息失败' },
        { status: 500 },
      );
    }

    return apiSuccess(message, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
