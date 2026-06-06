import prisma from '@/lib/db/client';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError } from '@/lib/api-utils';
import { hashPassword, comparePassword } from '@/lib/auth';

/**
 * PUT /api/users/me/password — Change password
 */
export async function PUT(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return Response.json(
        { error: '当前密码和新密码不能为空' },
        { status: 400 },
      );
    }

    if (newPassword.length < 6) {
      return Response.json(
        { error: '新密码长度不能少于6位' },
        { status: 400 },
      );
    }

    // Fetch user with passwordHash for verification
    const user = await prisma.user.findUnique({
      where: { id: auth.user.id },
    });
    if (!user) {
      return Response.json({ error: '用户不存在' }, { status: 404 });
    }

    const isValid = await comparePassword(currentPassword, user.passwordHash);
    if (!isValid) {
      return Response.json(
        { error: '当前密码不正确' },
        { status: 400 },
      );
    }

    const newHash = await hashPassword(newPassword);
    await prisma.user.update({
      where: { id: auth.user.id },
      data: { passwordHash: newHash },
    });

    return apiSuccess({ message: '密码修改成功' });
  } catch (error) {
    return handleApiError(error);
  }
}
