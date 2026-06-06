import prisma from '@/lib/db/client';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError } from '@/lib/api-utils';
import { Prisma } from '@prisma/client';

/**
 * GET /api/organizations/[id]/members — List org members
 * requireAuth + verify membership
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;

    // Verify requester is a member
    const membership = await prisma.organizationMember.findUnique({
      where: { userId_orgId: { userId: auth.user.id, orgId: id } },
    });

    if (!membership) {
      return Response.json({ error: '您不是该组织的成员' }, { status: 403 });
    }

    const members = await prisma.organizationMember.findMany({
      where: { orgId: id },
      select: {
        id: true,
        role: true,
        createdAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            avatar: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    return apiSuccess(members);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/organizations/[id]/members — Invite/add member
 * requireAuth + verify admin/owner role
 * Body: { email: string, role?: 'admin' | 'member' }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;
    const body = await request.json();
    const { email, role } = body;

    if (!email?.trim()) {
      return Response.json({ error: '请输入邮箱地址' }, { status: 400 });
    }

    const memberRole = role === 'admin' ? 'admin' : 'member';

    // Verify requester is admin/owner
    const requesterMembership = await prisma.organizationMember.findUnique({
      where: { userId_orgId: { userId: auth.user.id, orgId: id } },
    });

    if (!requesterMembership || !['owner', 'admin'].includes(requesterMembership.role)) {
      return Response.json({ error: '无权限邀请成员' }, { status: 403 });
    }

    // Find target user by email
    const targetUser = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    if (!targetUser) {
      return Response.json({ error: '未找到该邮箱对应的用户' }, { status: 404 });
    }

    // Add member + increment memberCount in a transaction
    const member = await prisma.$transaction(async (tx) => {
      const newMember = await tx.organizationMember.create({
        data: {
          userId: targetUser.id,
          orgId: id,
          role: memberRole,
        },
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              avatar: true,
            },
          },
        },
      });

      await tx.organization.update({
        where: { id },
        data: { memberCount: { increment: 1 } },
      });

      return newMember;
    });

    return apiSuccess(member, 201);
  } catch (error) {
    // Handle unique constraint (user already a member)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return Response.json({ error: '该用户已是组织成员' }, { status: 409 });
    }
    return handleApiError(error);
  }
}

/**
 * DELETE /api/organizations/[id]/members — Remove member
 * requireAuth + verify admin/owner
 * Body: { userId: string }
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;
    const body = await request.json();
    const { userId } = body;

    if (!userId) {
      return Response.json({ error: '请指定要移除的成员' }, { status: 400 });
    }

    // Verify requester is admin/owner
    const requesterMembership = await prisma.organizationMember.findUnique({
      where: { userId_orgId: { userId: auth.user.id, orgId: id } },
    });

    if (!requesterMembership || !['owner', 'admin'].includes(requesterMembership.role)) {
      return Response.json({ error: '无权限移除成员' }, { status: 403 });
    }

    // Find the target member
    const targetMember = await prisma.organizationMember.findUnique({
      where: { userId_orgId: { userId, orgId: id } },
    });

    if (!targetMember) {
      return Response.json({ error: '该用户不是组织成员' }, { status: 404 });
    }

    // Cannot remove last owner
    if (targetMember.role === 'owner') {
      const ownerCount = await prisma.organizationMember.count({
        where: { orgId: id, role: 'owner' },
      });

      if (ownerCount <= 1) {
        return Response.json({ error: '无法移除最后一个所有者，请先转让所有权' }, { status: 400 });
      }
    }

    // Remove member + decrement memberCount in a transaction
    await prisma.$transaction(async (tx) => {
      await tx.organizationMember.delete({
        where: { id: targetMember.id },
      });

      await tx.organization.update({
        where: { id },
        data: { memberCount: { decrement: 1 } },
      });
    });

    return apiSuccess({ success: true });
  } catch (error) {
    return handleApiError(error);
  }
}
