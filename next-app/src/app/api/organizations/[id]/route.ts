import prisma from '@/lib/db/client';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError } from '@/lib/api-utils';

/**
 * GET /api/organizations/[id] — Get org details with members
 * Members' emails are only visible to org members or admins.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;

    // Check if the requester is an org member or admin
    let isMember = false;
    try {
      const auth = await requireAuth(request);
      if (!('error' in auth)) {
        const membership = await prisma.organizationMember.findUnique({
          where: { userId_orgId: { userId: auth.user.id, orgId: id } },
        });
        if (membership) isMember = true;
        if (['admin', 'operator'].includes(auth.user.role)) isMember = true;
      }
    } catch {
      // Not authenticated — isMember stays false
    }

    // If member, include full member details with email; otherwise hide email
    const userSelect = isMember
      ? { id: true, name: true, email: true, avatar: true }
      : { id: true, name: true, avatar: true };

    const organization = await prisma.organization.findUnique({
      where: { id },
      include: {
        members: {
          select: {
            id: true,
            role: true,
            createdAt: true,
            user: { select: userSelect },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!organization) {
      return Response.json({ error: '组织不存在' }, { status: 404 });
    }

    return apiSuccess(organization);
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/organizations/[id] — Update org
 * requireAuth + verify user is org admin/owner
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;

    // Verify membership with admin/owner role
    const membership = await prisma.organizationMember.findUnique({
      where: {
        userId_orgId: {
          userId: auth.user.id,
          orgId: id,
        },
      },
    });

    if (!membership || !['owner', 'admin'].includes(membership.role)) {
      return Response.json({ error: '无权限修改此组织' }, { status: 403 });
    }

    const body = await request.json();
    const { name, industry, description, logo } = body;

    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name.trim() || undefined;
    if (industry !== undefined) data.industry = industry;
    if (description !== undefined) data.description = description;
    if (logo !== undefined) data.logo = logo;

    const updated = await prisma.organization.update({
      where: { id },
      data,
    });

    return apiSuccess(updated);
  } catch (error) {
    return handleApiError(error);
  }
}
