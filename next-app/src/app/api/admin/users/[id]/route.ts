/**
 * Admin User Update API
 *
 * PUT /api/admin/users/[id] — Update a user (role change, etc.)
 *   requireRole(['admin'])
 *   Body: { role?: string, name?: string, phone?: string }
 */

import { requireRole } from '@/lib/auth-helpers';
import prisma from '@/lib/db/client';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';
import type { UserRole } from '@/types';

const VALID_ROLES: UserRole[] = [
  'guest',
  'buyer',
  'supplier',
  'opc_team',
  'operator',
  'admin',
];

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireRole(request, ['admin']);
    if ('error' in auth) return auth.error;

    const { id } = await params;
    const body = await request.json();
    const { role, name, phone } = body;

    // Build update data
    const data: Record<string, unknown> = {};
    if (typeof role === 'string') {
      if (!VALID_ROLES.includes(role as UserRole)) {
        return Response.json(
          { error: '无效的角色类型' },
          { status: 400 },
        );
      }
      data.role = role;
    }
    if (typeof name === 'string') data.name = name;
    if (typeof phone === 'string') data.phone = phone;

    if (Object.keys(data).length === 0) {
      return Response.json(
        { error: '没有需要更新的字段' },
        { status: 400 },
      );
    }

    // Verify target user exists
    const targetUser = await prisma.user.findUnique({ where: { id } });
    if (!targetUser) {
      return Response.json(
        { error: '用户不存在' },
        { status: 404 },
      );
    }

    // Prevent admin from demoting themselves
    if (id === auth.user.id && data.role && data.role !== 'admin') {
      return Response.json(
        { error: '不能降级自己的管理员角色' },
        { status: 400 },
      );
    }

    const updatedUser = await prisma.user.update({
      where: { id },
      data,
      select: {
        id: true,
        name: true,
        email: true,
        avatar: true,
        role: true,
        orgId: true,
        phone: true,
        emailVerified: true,
        createdAt: true,
        organization: {
          select: { id: true, name: true, logo: true },
        },
      },
    });

    return apiSuccess({
      id: updatedUser.id,
      name: updatedUser.name,
      email: updatedUser.email,
      avatar: updatedUser.avatar,
      role: updatedUser.role,
      orgId: updatedUser.orgId,
      orgName: updatedUser.organization?.name ?? null,
      orgLogo: updatedUser.organization?.logo ?? null,
      phone: updatedUser.phone,
      emailVerified: updatedUser.emailVerified
        ? updatedUser.emailVerified.toISOString()
        : null,
      createdAt: updatedUser.createdAt.toISOString(),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
