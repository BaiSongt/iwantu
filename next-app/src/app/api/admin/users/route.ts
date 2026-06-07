/**
 * Admin User Management API
 *
 * GET /api/admin/users — List all users (paginated)
 *   requireRole(['admin'])
 *   Query: search, role, page, limit
 *   Return users without passwordHash
 */

import { requireRole } from '@/lib/auth-helpers';
import prisma from '@/lib/db/client';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(request: Request) {
  try {
    const auth = await requireRole(request, ['admin']);
    if ('error' in auth) return auth.error;

    const url = new URL(request.url);
    const search = url.searchParams.get('search');
    const role = url.searchParams.get('role');
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));

    // Build where clause
    const where: Record<string, unknown> = {};

    if (role) {
      where.role = role;
    }

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
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
      }),
    ]);

    const items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      email: row.email,
      avatar: row.avatar,
      role: row.role,
      orgId: row.orgId,
      orgName: row.organization?.name ?? null,
      orgLogo: row.organization?.logo ?? null,
      phone: row.phone,
      emailVerified: row.emailVerified ? row.emailVerified.toISOString() : null,
      createdAt: row.createdAt.toISOString(),
    }));

    return apiSuccess({
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
