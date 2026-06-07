/**
 * API Key Management — Revoke (Delete)
 *
 * DELETE /api/api-keys/[id] — Revoke an API key
 */

import { requireAuth } from '@/lib/auth-helpers';
import prisma from '@/lib/db/client';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;

    // Verify the key exists and belongs to this user
    const apiKey = await prisma.apiKey.findUnique({
      where: { id },
      select: { id: true, userId: true, name: true },
    });

    if (!apiKey) {
      return apiSuccess({ error: 'API Key 不存在' }, 404);
    }

    if (apiKey.userId !== auth.user.id) {
      return apiSuccess({ error: '无权操作此 API Key' }, 403);
    }

    await prisma.apiKey.delete({ where: { id } });

    return apiSuccess({ success: true, message: `API Key "${apiKey.name}" 已撤销` });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
