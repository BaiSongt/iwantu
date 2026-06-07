import prisma from '@/lib/db/client';
import { requireRole } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError } from '@/lib/api-utils';
import type { Demand } from '@/types';

interface ScoredDemand {
  demand: Demand;
  matchScore: number;
  matchedTags: string[];
}

/**
 * GET /api/supplier/leads — Get matching demands for the authenticated supplier.
 *
 * Strategy:
 * 1. Find the supplier's published products and extract their industry/capability tags.
 * 2. Find all open demands (collecting_proposals, clarifying, in_poc).
 * 3. Score each demand based on tag overlap with the supplier's products.
 * 4. Return demands sorted by match score (best first).
 */
export async function GET(request: Request) {
  try {
    const auth = await requireRole(request, ['supplier', 'admin']);
    if ('error' in auth) return auth.error;

    const userOrgId = auth.user.orgId;

    if (!userOrgId) {
      return apiSuccess([]);
    }

    // Step 1: Get supplier's published products and collect tags
    const supplierProducts = await prisma.product.findMany({
      where: {
        orgId: userOrgId,
        status: 'published',
      },
      select: {
        industryTags: true,
        capabilityTags: true,
        category: true,
        deploymentModes: true,
      },
    });

    // Collect unique tags from all published products
    const supplierIndustries = new Set<string>();
    const supplierCapabilities = new Set<string>();
    const supplierCategories = new Set<string>();
    const supplierDeployModes = new Set<string>();

    for (const p of supplierProducts) {
      for (const tag of p.industryTags) supplierIndustries.add(tag.toLowerCase());
      for (const tag of p.capabilityTags) supplierCapabilities.add(tag.toLowerCase());
      supplierCategories.add(p.category.toLowerCase());
      for (const dm of p.deploymentModes) supplierDeployModes.add(dm.toLowerCase());
    }

    // If supplier has no published products, return empty
    if (supplierProducts.length === 0) {
      return apiSuccess([]);
    }

    // Step 2: Get open demands
    const openDemands = await prisma.demand.findMany({
      where: {
        status: { in: ['collecting_proposals', 'clarifying', 'in_poc'] },
      },
      include: { ownerUser: true },
      orderBy: { createdAt: 'desc' },
    });

    // Step 3: Score demands
    const scored: ScoredDemand[] = [];

    for (const row of openDemands) {
      let matchScore = 0;
      const matchedTags: string[] = [];

      // Industry match (most important — 40 points)
      const demandIndustry = row.industry.toLowerCase();
      if (supplierIndustries.has(demandIndustry)) {
        matchScore += 40;
        matchedTags.push(row.industry);
      }

      // Data types overlap with capabilities (30 points max)
      if (row.dataTypes && row.dataTypes.length > 0) {
        let overlap = 0;
        for (const dt of row.dataTypes) {
          if (supplierCapabilities.has(dt.toLowerCase())) {
            overlap++;
            matchedTags.push(dt);
          }
        }
        matchScore += Math.min(overlap * 10, 30);
      }

      // Category match (15 points)
      if (row.deploymentRequirement) {
        const deployReq = row.deploymentRequirement.toLowerCase();
        for (const dm of supplierDeployModes) {
          if (deployReq.includes(dm) || dm.includes(deployReq)) {
            matchScore += 15;
            matchedTags.push(row.deploymentRequirement);
            break;
          }
        }
      }

      // Description keyword match (15 points max)
      const descLower = (row.description ?? '').toLowerCase();
      const titleLower = row.title.toLowerCase();
      for (const cap of supplierCapabilities) {
        if (descLower.includes(cap) || titleLower.includes(cap)) {
          matchScore += 5;
          if (!matchedTags.includes(cap)) matchedTags.push(cap);
        }
        if (matchScore >= 100) break;
      }
      matchScore = Math.min(matchScore, 100);

      // Only include if there's at least some match
      if (matchScore > 0) {
        const demand: Demand = {
          id: row.id,
          title: row.title,
          industry: row.industry,
          budgetRange: row.budgetRange,
          budgetMin: row.budgetMin ?? undefined,
          budgetMax: row.budgetMax ?? undefined,
          deliveryPeriod: row.deliveryPeriod,
          dataTypes: row.dataTypes,
          deploymentRequirement: row.deploymentRequirement,
          description: row.description,
          painPoints: row.painPoints,
          existingSystems: row.existingSystems,
          supportPoc: row.supportPoc,
          allowAiSupplier: row.allowAiSupplier,
          matchScore: matchScore.toString(),
          matchScoreNum: matchScore,
          status: row.status as Demand['status'],
          ownerUser: row.ownerUser?.name ?? undefined,
          ownerOrg: undefined,
          createdAt: row.createdAt.toISOString().slice(0, 10),
        };

        scored.push({ demand, matchScore, matchedTags: [...new Set(matchedTags)] });
      }
    }

    // Sort by match score descending
    scored.sort((a, b) => b.matchScore - a.matchScore);

    return apiSuccess(scored);
  } catch (error) {
    return handleApiError(error);
  }
}
