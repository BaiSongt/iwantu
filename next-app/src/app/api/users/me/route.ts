import prisma from '@/lib/db/client';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError } from '@/lib/api-utils';

/**
 * GET /api/users/me — Get current authenticated user profile
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    let orgName: string | undefined;
    if (auth.user.orgId) {
      const org = await prisma.organization.findUnique({
        where: { id: auth.user.orgId },
        select: { name: true },
      });
      orgName = org?.name;
    }

    return apiSuccess({ ...auth.user, orgName });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/users/me — Update current user profile
 */
export async function PUT(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const { name, phone, avatar } = body;

    const data: { name?: string; phone?: string; avatar?: string } = {};
    if (typeof name === 'string') data.name = name;
    if (typeof phone === 'string') data.phone = phone;
    if (typeof avatar === 'string') data.avatar = avatar;

    const updatedUser = await prisma.user.update({
      where: { id: auth.user.id },
      data,
    });

    // Fetch orgName if applicable
    let orgName: string | undefined;
    if (updatedUser.orgId) {
      const org = await prisma.organization.findUnique({
        where: { id: updatedUser.orgId },
        select: { name: true },
      });
      orgName = org?.name;
    }

    // Exclude passwordHash from response
    const { passwordHash: _ph, ...safeUser } = updatedUser;
    return apiSuccess({ ...safeUser, orgName });
  } catch (error) {
    return handleApiError(error);
  }
}
