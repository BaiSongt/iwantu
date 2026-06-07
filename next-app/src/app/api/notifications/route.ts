import { getNotifications, getUnreadCount, markAsRead, markAllAsRead } from '@/lib/db/notifications';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError, paginateResults } from '@/lib/api-utils';

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { searchParams } = new URL(request.url);
    const readParam = searchParams.get('read');
    const type = searchParams.get('type') || undefined;
    const page = Number(searchParams.get('page')) || 1;
    const limit = Number(searchParams.get('limit')) || 20;

    const filters: { read?: boolean; type?: string } = {};
    if (readParam !== null) {
      filters.read = readParam === 'true';
    }
    if (type) {
      filters.type = type;
    }

    const [notifications, unreadCount] = await Promise.all([
      getNotifications(auth.user.id, filters),
      getUnreadCount(auth.user.id),
    ]);

    const paginated = paginateResults(notifications, page, limit);

    return apiSuccess({
      ...paginated,
      unreadCount,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const { id, all } = body as { id?: string; all?: boolean };

    if (all) {
      const success = await markAllAsRead(auth.user.id);
      return success
        ? apiSuccess({ message: '全部标记已读' })
        : apiSuccess({ error: '操作失败' }, 500);
    }

    if (id) {
      const success = await markAsRead(id);
      return success
        ? apiSuccess({ message: '已标记已读' })
        : apiSuccess({ error: '通知不存在' }, 404);
    }

    return apiSuccess({ error: '参数错误' }, 400);
  } catch (error) {
    return handleApiError(error);
  }
}
