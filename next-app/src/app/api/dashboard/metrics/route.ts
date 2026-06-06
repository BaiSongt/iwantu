import { NextRequest } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError } from '@/lib/api-utils';
import prisma from '@/lib/db/client';

export async function GET(request: NextRequest) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const user = auth.user;
    const role = user.role as string;

    switch (role) {
      case 'buyer': {
        const [activeDemands, receivedProposals, activePoc, unreadMessages] =
          await Promise.all([
            prisma.demand.count({
              where: {
                ownerUserId: user.id,
                status: { in: ['clarifying', 'collecting_proposals', 'in_poc'] },
              },
            }),
            prisma.proposal.count({
              where: {
                demand: { ownerUserId: user.id },
              },
            }),
            prisma.pocProject.count({
              where: {
                demand: { ownerUserId: user.id },
                status: {
                  in: [
                    'confirming_requirements',
                    'uploading_sample_data',
                    'supplier_testing',
                    'result_review',
                    'procurement_discussion',
                  ],
                },
              },
            }),
            getUnreadCount(user.id),
          ]);

        return apiSuccess({
          metrics: { activeDemands, receivedProposals, activePoc, unreadMessages },
        });
      }

      case 'supplier': {
        const userOrgId = user.orgId;
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [publishedProducts, newMatchingDemands, activeProposals, unreadMessages] =
          await Promise.all([
            prisma.product.count({
              where: { orgId: userOrgId ?? '', status: 'published' },
            }),
            prisma.demand.count({
              where: {
                createdAt: { gte: sevenDaysAgo },
                status: { in: ['clarifying', 'collecting_proposals'] },
              },
            }),
            prisma.proposal.count({
              where: {
                supplierOrgId: userOrgId ?? '',
                status: { in: ['submitted', 'reviewed'] },
              },
            }),
            getUnreadCount(user.id),
          ]);

        return apiSuccess({
          metrics: { publishedProducts, newMatchingDemands, activeProposals, unreadMessages },
        });
      }

      case 'opc_team': {
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

        const [pendingMatching, activePoc, weeklyNew] = await Promise.all([
          prisma.demand.count({
            where: { status: 'collecting_proposals' },
          }),
          prisma.pocProject.count({
            where: {
              status: {
                in: [
                  'confirming_requirements',
                  'uploading_sample_data',
                  'supplier_testing',
                  'result_review',
                  'procurement_discussion',
                ],
              },
            },
          }),
          prisma.demand.count({
            where: { createdAt: { gte: sevenDaysAgo } },
          }),
        ]);

        return apiSuccess({
          metrics: { pendingMatching, activePoc, weeklyNew },
        });
      }

      case 'admin': {
        const [totalUsers, totalProducts, totalDemands, activePoc, pendingReviews] =
          await Promise.all([
            prisma.user.count(),
            prisma.product.count(),
            prisma.demand.count(),
            prisma.pocProject.count({
              where: {
                status: {
                  in: [
                    'confirming_requirements',
                    'uploading_sample_data',
                    'supplier_testing',
                    'result_review',
                    'procurement_discussion',
                  ],
                },
              },
            }),
            prisma.product.count({ where: { status: 'pending_review' } }),
          ]);

        return apiSuccess({
          metrics: { totalUsers, totalProducts, totalDemands, activePoc, pendingReviews },
        });
      }

      default:
        return apiSuccess({ metrics: {} });
    }
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * Count unread messages for a user.
 * Simplified: counts messages in threads where the user is a participant
 * and the message is not from the user.
 */
async function getUnreadCount(userId: string): Promise<number> {
  const userThreads = await prisma.threadParticipant.findMany({
    where: { userId },
    select: { threadId: true },
  });

  if (userThreads.length === 0) return 0;

  return prisma.message.count({
    where: {
      threadId: { in: userThreads.map((t) => t.threadId) },
      senderId: { not: userId },
    },
  });
}
