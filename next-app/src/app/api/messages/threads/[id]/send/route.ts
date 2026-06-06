import { requireAuth } from '@/lib/auth-helpers';
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
