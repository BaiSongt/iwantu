/**
 * Reviews / Rating API
 *
 * POST /api/reviews — Create review (requireAuth, verify POC completion)
 *   Body: { targetType, targetId, rating (1-5), title, content }
 *
 * GET /api/reviews — List reviews
 *   Query: targetType, targetId (filter by product/company/agent)
 */

import { requireAuth } from '@/lib/auth-helpers';
import prisma from '@/lib/db/client';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const { targetType, targetId, rating, title, content } = body;

    // Validate required fields
    if (!targetType || !targetId || !rating || !title || !content) {
      return Response.json(
        { error: '缺少必要字段: targetType, targetId, rating, title, content' },
        { status: 400 },
      );
    }

    // Validate targetType
    const validTypes = ['product', 'agent', 'company'];
    if (!validTypes.includes(targetType)) {
      return Response.json(
        { error: '无效的 targetType，支持: product, agent, company' },
        { status: 400 },
      );
    }

    // Validate rating
    const ratingNum = parseInt(rating, 10);
    if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return Response.json(
        { error: '评分必须在 1-5 之间' },
        { status: 400 },
      );
    }

    // For product reviews, verify the user has a completed POC involving this product
    if (targetType === 'product') {
      const completedPoc = await prisma.pocProject.findFirst({
        where: {
          productId: targetId,
          status: 'completed',
          participants: {
            some: { userId: auth.user.id },
          },
        },
      });

      if (!completedPoc) {
        return Response.json(
          { error: '仅完成 POC 的用户可以评价产品' },
          { status: 403 },
        );
      }
    }

    // Check for existing review by this user on this target
    const existing = await prisma.review.findFirst({
      where: {
        userId: auth.user.id,
        targetType,
        targetId,
      },
    });

    if (existing) {
      return Response.json(
        { error: '您已经评价过该产品' },
        { status: 409 },
      );
    }

    const review = await prisma.review.create({
      data: {
        targetType,
        targetId,
        userId: auth.user.id,
        rating: ratingNum,
        title,
        content,
        status: 'published',
      },
      include: {
        author: {
          select: { id: true, name: true, avatar: true },
        },
      },
    });

    // Update average rating on the target product if applicable
    if (targetType === 'product') {
      try {
        const stats = await prisma.review.aggregate({
          where: { targetType: 'product', targetId, status: 'published' },
          _avg: { rating: true },
          _count: { rating: true },
        });

        await prisma.product.update({
          where: { id: targetId },
          data: {
            rating: stats._avg.rating ?? 0,
          },
        });
      } catch {
        // Rating update should not block review creation
      }
    }

    return apiSuccess(
      {
        id: review.id,
        targetType: review.targetType,
        targetId: review.targetId,
        rating: review.rating,
        title: review.title,
        content: review.content,
        status: review.status,
        author: review.author,
        createdAt: review.createdAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const targetType = url.searchParams.get('targetType');
    const targetId = url.searchParams.get('targetId');
    const page = Math.max(1, parseInt(url.searchParams.get('page') ?? '1', 10));
    const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit') ?? '20', 10)));

    // Build where clause
    const where: Record<string, unknown> = {
      status: 'published',
    };

    if (targetType) {
      where.targetType = targetType;
    }
    if (targetId) {
      where.targetId = targetId;
    }

    const [total, rows] = await Promise.all([
      prisma.review.count({ where }),
      prisma.review.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          author: {
            select: { id: true, name: true, avatar: true },
          },
        },
      }),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      targetType: r.targetType,
      targetId: r.targetId,
      rating: r.rating,
      title: r.title,
      content: r.content,
      status: r.status,
      author: r.author,
      createdAt: r.createdAt.toISOString(),
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
