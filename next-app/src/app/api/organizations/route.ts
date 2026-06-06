import prisma from '@/lib/db/client';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError } from '@/lib/api-utils';

/**
 * GET /api/organizations — List organizations with optional filters
 * Query params: type, industry, search, page, limit
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const type = searchParams.get('type');
    const industry = searchParams.get('industry');
    const search = searchParams.get('search');
    const page = Math.max(1, Number(searchParams.get('page')) || 1);
    const limit = Math.min(50, Math.max(1, Number(searchParams.get('limit')) || 20));

    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (industry) where.industry = industry;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [organizations, total] = await Promise.all([
      prisma.organization.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.organization.count({ where }),
    ]);

    return apiSuccess({
      items: organizations,
      total,
      page,
      pageSize: limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * POST /api/organizations — Create a new organization
 * Body: { name, type, industry?, description? }
 */
export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const { name, type, industry, description } = body;

    if (!name?.trim()) {
      return Response.json({ error: '组织名称不能为空' }, { status: 400 });
    }
    if (!type || !['buyer', 'supplier', 'opc_team'].includes(type)) {
      return Response.json({ error: '请选择有效的组织类型' }, { status: 400 });
    }

    const organization = await prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({
        data: {
          name: name.trim(),
          type,
          industry: industry || null,
          description: description || null,
          memberCount: 1,
        },
      });

      await tx.organizationMember.create({
        data: {
          userId: auth.user.id,
          orgId: org.id,
          role: 'owner',
        },
      });

      await tx.user.update({
        where: { id: auth.user.id },
        data: { orgId: org.id },
      });

      return org;
    });

    return apiSuccess(organization, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
