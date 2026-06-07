/**
 * Demand Data Access Layer
 *
 * CRUD operations for demands, status transitions, and AI-powered matching
 * against products, agents, companies, and solutions.
 */

import prisma from './client';
import type { Demand, MatchResult, Product, AgentProduct, CompanyProfile, Solution } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a Prisma Demand row (with ownerUser relation) to the frontend Demand
 * shape that matches the mock data in constants.ts.
 */
function toDemandShape(
  row: Awaited<ReturnType<typeof prisma.demand.findFirst>> & {
    ownerUser?: { name: string } | null;
  },
): Demand | null {
  if (!row) return null;
  return {
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
    matchScore: row.matchScore,
    matchScoreNum: row.matchScoreNum,
    status: row.status as Demand['status'],
    ownerUser: row.ownerUser?.name ?? undefined,
    ownerOrg: undefined,
    createdAt: row.createdAt.toISOString().slice(0, 10),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get a list of demands with optional filters.
 *
 * @param filters.industry - Filter by industry string
 * @param filters.status - Filter by DemandStatus
 * @param filters.ownerUserId - Filter by the user who owns the demand
 * @param filters.search - Case-insensitive substring search on title
 * @returns Array of Demand objects (empty array on error)
 */
export async function getDemands(filters?: {
  industry?: string;
  status?: string;
  ownerUserId?: string;
  search?: string;
  supportPoc?: string;
  budgetMin?: number;
  budgetMax?: number;
}): Promise<Demand[]> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const where: any = {};

    if (filters?.industry) {
      where.industry = filters.industry;
    }
    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.ownerUserId) {
      where.ownerUserId = filters.ownerUserId;
    }
    if (filters?.search) {
      where.title = { contains: filters.search, mode: 'insensitive' };
    }
    if (filters?.supportPoc === 'true' || filters?.supportPoc === 'yes') {
      where.supportPoc = true;
    } else if (filters?.supportPoc === 'false' || filters?.supportPoc === 'no') {
      where.supportPoc = false;
    }
    if (filters?.budgetMin != null && filters.budgetMin > 0) {
      // Demand's budgetMax must be >= user's minimum
      where.budgetMax = { gte: filters.budgetMin };
    }
    if (filters?.budgetMax != null && filters.budgetMax > 0) {
      // Demand's budgetMin must be <= user's maximum
      where.budgetMin = { lte: filters.budgetMax };
    }

    const rows = await prisma.demand.findMany({
      where,
      include: { ownerUser: true },
      orderBy: { createdAt: 'desc' },
    });

    return rows
      .map((row) => toDemandShape(row))
      .filter((d): d is Demand => d !== null);
  } catch (error) {
    console.error('[DAL] getDemands failed:', error);
    return [];
  }
}

/**
 * Get a single demand by its ID.
 *
 * @param id - Demand ID (cuid)
 * @returns Demand object or null
 */
export async function getDemandById(id: string): Promise<Demand | null> {
  try {
    const row = await prisma.demand.findUnique({
      where: { id },
      include: { ownerUser: true },
    });
    return row ? toDemandShape(row) : null;
  } catch (error) {
    console.error('[DAL] getDemandById failed:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a new demand.
 *
 * @param data - Demand fields (ownerUserId required, plus title, industry, etc.)
 * @returns The created Demand or null on error
 */
export async function createDemand(data: {
  ownerUserId: string;
  ownerOrgId?: string;
  title: string;
  industry: string;
  budgetRange: string;
  budgetMin?: number;
  budgetMax?: number;
  deliveryPeriod: string;
  dataTypes: string[];
  deploymentRequirement: string;
  description?: string;
  painPoints?: string;
  existingSystems?: string;
  supportPoc?: boolean;
  allowAiSupplier?: boolean;
  allowAiAutoBid?: boolean;
}): Promise<Demand | null> {
  try {
    const row = await prisma.demand.create({
      data: {
        ownerUserId: data.ownerUserId,
        ownerOrgId: data.ownerOrgId,
        title: data.title,
        industry: data.industry,
        budgetRange: data.budgetRange,
        budgetMin: data.budgetMin,
        budgetMax: data.budgetMax,
        deliveryPeriod: data.deliveryPeriod,
        dataTypes: data.dataTypes,
        deploymentRequirement: data.deploymentRequirement,
        description: data.description ?? '',
        painPoints: data.painPoints ?? '',
        existingSystems: data.existingSystems ?? '',
        supportPoc: data.supportPoc ?? false,
        allowAiSupplier: data.allowAiSupplier ?? false,
        allowAiAutoBid: data.allowAiAutoBid ?? false,
      },
      include: { ownerUser: true },
    });
    return toDemandShape(row);
  } catch (error) {
    console.error('[DAL] createDemand failed:', error);
    return null;
  }
}

/**
 * Update an existing demand's data fields.
 *
 * @param id - Demand ID
 * @param data - Partial demand fields to update
 * @returns Updated Demand or null on error
 */
export async function updateDemand(
  id: string,
  data: Partial<{
    title: string;
    industry: string;
    budgetRange: string;
    budgetMin: number | null;
    budgetMax: number | null;
    deliveryPeriod: string;
    dataTypes: string[];
    deploymentRequirement: string;
    description: string;
    painPoints: string;
    existingSystems: string;
    supportPoc: boolean;
    allowAiSupplier: boolean;
    allowAiAutoBid: boolean;
    status: string;
  }>,
): Promise<Demand | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { ...data };
    if (data.status) updateData.status = data.status as any;

    const row = await prisma.demand.update({
      where: { id },
      data: updateData,
      include: { ownerUser: true },
    });
    return toDemandShape(row);
  } catch (error) {
    console.error('[DAL] updateDemand failed:', error);
    return null;
  }
}

/**
 * Change the status of a demand.
 *
 * @param id - Demand ID
 * @param status - New DemandStatus value
 * @returns Updated Demand or null on error
 */
export async function updateDemandStatus(
  id: string,
  status: string,
): Promise<Demand | null> {
  try {
    const row = await prisma.demand.update({
      where: { id },
      data: { status: status as never },
      include: { ownerUser: true },
    });
    return toDemandShape(row);
  } catch (error) {
    console.error('[DAL] updateDemandStatus failed:', error);
    return null;
  }
}

/**
 * Publish a demand -- transitions status from `draft` to `collecting_proposals`.
 *
 * @param id - Demand ID
 * @returns Updated Demand or null on error
 */
export async function publishDemand(id: string): Promise<Demand | null> {
  return updateDemandStatus(id, 'collecting_proposals');
}

/**
 * Delete a demand by ID.
 * Caller should verify ownership and status before calling.
 *
 * @param id - Demand ID
 * @returns true on success, false on error
 */
export async function deleteDemand(id: string): Promise<boolean> {
  try {
    await prisma.demand.delete({ where: { id } });
    return true;
  } catch (error) {
    console.error('[DAL] deleteDemand failed:', error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

/**
 * Match a demand against products, agents, companies, and solutions.
 *
 * Scoring strategy:
 * - Extract industry / dataTypes / deploymentRequirement from the demand.
 * - For each entity compute a weighted score based on tag overlap:
 *     - industry match: 40 pts
 *     - capability / tag overlap: 30 pts (capped)
 *     - deployment mode overlap: 30 pts
 * - Results are sorted by score descending and limited to top 5 per category.
 *
 * @param id - Demand ID
 * @returns MatchResult with scored recommendations, or null on error
 */
export async function matchDemand(id: string): Promise<MatchResult | null> {
  try {
    const demand = await prisma.demand.findUnique({ where: { id } });
    if (!demand) return null;

    const demandIndustry = demand.industry;
    const demandDataTypes = demand.dataTypes ?? [];
    const demandDeploy = demand.deploymentRequirement;

    // -- Normalize helpers --
    const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
    const normalizeArr = (arr: string[]) => arr.map(normalize);

    const demandIndustryN = normalize(demandIndustry);
    const demandDeployN = normalize(demandDeploy);
    const demandDataTypesN = normalizeArr(demandDataTypes);

    // ---- Products ----
    const products = await prisma.product.findMany({
      where: { status: 'published' },
      include: { organization: true },
    });

    const scoredProducts = products.map((p) => {
      let score = 0;
      const tagsN = normalizeArr([...p.industryTags, ...p.capabilityTags]);
      const deployN = normalizeArr(p.deploymentModes);

      if (p.industryTags.some((t) => normalize(t) === demandIndustryN)) score += 40;
      const demandTokens = [...demandDataTypesN, demandIndustryN];
      const overlap = tagsN.filter((t) => demandTokens.includes(t)).length;
      score += Math.min(overlap * 10, 30);
      if (deployN.some((d) => d === demandDeployN)) score += 30;
      score = Math.min(score, 100);

      const product: Product = {
        id: p.id,
        name: p.name,
        company: p.organization?.name ?? '',
        companyLogo: p.organization?.logo ?? undefined,
        summary: p.summary,
        description: p.description,
        coverImage: p.coverImage ?? undefined,
        gallery: undefined,
        category: p.category,
        industryTags: p.industryTags as Product['industryTags'],
        capabilityTags: p.capabilityTags,
        deploymentModes: p.deploymentModes as Product['deploymentModes'],
        pricingModel: p.pricingModel as Product['pricingModel'],
        price: p.price,
        supportPoc: p.supportPoc,
        supportPrivateDeployment: p.supportPrivateDeployment,
        score: p.score,
        rating: p.rating,
        caseCount: p.caseCount,
        pocCount: p.pocCount,
        status: p.status as Product['status'],
        accent: p.accent,
        shot: p.shot,
        tags: p.tags,
        deploy: p.deploymentModes.join('/'),
        createdAt: p.createdAt.toISOString().slice(0, 10),
      };

      return {
        product,
        score,
        reason:
          score >= 70
            ? 'Industry and deployment match'
            : score >= 40
              ? 'Partial tag overlap'
              : 'Broad match',
      };
    });

    scoredProducts.sort((a, b) => b.score - a.score);

    // ---- Agent Products ----
    const agents = await prisma.agentProduct.findMany({
      where: { status: 'published' },
      include: { organization: true },
    });

    const scoredAgents = agents.map((a) => {
      let score = 0;
      const tagsN = normalizeArr(a.tags);
      const deployN = normalizeArr(a.deploymentModes);

      if (tagsN.includes(demandIndustryN)) score += 40;
      const demandTokens = [...demandDataTypesN, demandIndustryN];
      const overlap = tagsN.filter((t) => demandTokens.includes(t)).length;
      score += Math.min(overlap * 10, 30);
      if (deployN.some((d) => d === demandDeployN)) score += 30;
      score = Math.min(score, 100);

      const agent: AgentProduct = {
        id: a.id,
        name: a.name,
        company: a.organization?.name ?? '',
        summary: a.summary,
        description: a.description,
        taskGoal: a.taskGoal,
        inputSpec: a.inputSpec,
        outputSpec: a.outputSpec,
        toolCalls: a.toolCalls,
        successRate: a.successRate,
        deploymentModes: a.deploymentModes as AgentProduct['deploymentModes'],
        pricingModel: a.pricingModel as AgentProduct['pricingModel'],
        price: a.price,
        supportPoc: a.supportPoc,
        riskLevel: a.riskLevel as AgentProduct['riskLevel'],
        status: a.status as AgentProduct['status'],
        tags: a.tags,
        deploy: a.deploy,
        accent: a.accent,
        shot: a.shot,
      };

      return {
        agent,
        score,
        reason:
          score >= 70
            ? 'Strong capability match'
            : score >= 40
              ? 'Partial match'
              : 'Broad match',
      };
    });

    scoredAgents.sort((a, b) => b.score - a.score);

    // ---- Companies ----
    const companies = await prisma.companyProfile.findMany({
      include: { organization: true },
    });

    const scoredCompanies = companies.map((c) => {
      let score = 0;
      const tagsN = normalizeArr([...c.capabilities, ...c.tags]);
      const industryN = normalizeArr(c.industryExperience);

      if (industryN.includes(demandIndustryN)) score += 40;
      const demandTokens = [...demandDataTypesN, demandIndustryN];
      const overlap = tagsN.filter((t) => demandTokens.includes(t)).length;
      score += Math.min(overlap * 10, 30);
      if (
        c.deliveryScope.some((d) => normalize(d).includes(demandDeployN))
      )
        score += 30;
      score = Math.min(score, 100);

      const company: CompanyProfile = {
        id: c.id,
        name: c.organization?.name ?? '',
        logo: c.organization?.logo ?? undefined,
        slogan: c.slogan,
        description: c.description,
        certifications: c.certifications,
        capabilities: c.capabilities,
        industryExperience:
          c.industryExperience as CompanyProfile['industryExperience'],
        deliveryScope: c.deliveryScope,
        caseStudies: c.caseStudies,
        rating: c.rating,
        responseRate: c.responseRate,
        certified: c.certified,
        tags: c.tags,
      };

      return {
        company,
        score,
        reason:
          score >= 70
            ? 'Industry-experienced supplier'
            : score >= 40
              ? 'Relevant capabilities'
              : 'Broad match',
      };
    });

    scoredCompanies.sort((a, b) => b.score - a.score);

    // ---- Solutions ----
    const solutions = await prisma.solution.findMany();

    const scoredSolutions = solutions.map((s) => {
      let score = 0;
      const industryN = normalizeArr(s.industry);
      const componentsN = normalizeArr(s.components);

      if (industryN.includes(demandIndustryN)) score += 40;
      const demandTokens = [...demandDataTypesN, demandIndustryN];
      const overlap = componentsN.filter((t) => demandTokens.includes(t)).length;
      score += Math.min(overlap * 10, 30);
      const solDeployN = normalizeArr(s.deploymentModes);
      if (solDeployN.some((d) => d === demandDeployN)) score += 30;
      score = Math.min(score, 100);

      const solution: Solution = {
        id: s.id,
        title: s.title,
        summary: s.summary,
        description: s.description,
        industry: s.industry as Solution['industry'],
        scenario: s.scenario,
        budgetRange: s.budgetRange ?? '',
        deploymentModes: s.deploymentModes as Solution['deploymentModes'],
        deliveryPeriod: s.deliveryPeriod ?? '',
        supportPoc: s.supportPoc,
        components: s.components,
        recommendedProducts: s.recommendedProductIds,
        recommendedCompanies: s.recommendedCompanyIds,
      };

      return {
        solution,
        score,
        reason:
          score >= 70
            ? 'Solution fits industry scenario'
            : score >= 40
              ? 'Partial scenario match'
              : 'Broad match',
      };
    });

    scoredSolutions.sort((a, b) => b.score - a.score);

    // ---- Build result ----
    const riskWarnings: string[] = [];
    if (!demand.supportPoc) {
      riskWarnings.push(
        'Demand does not support POC -- consider requesting a demo instead.',
      );
    }
    if (demand.budgetMax != null && demand.budgetMax < 5) {
      riskWarnings.push(
        'Budget is very low -- may limit supplier interest.',
      );
    }

    const nextSteps: string[] = [];
    if (scoredProducts.length > 0 && scoredProducts[0].score >= 40) {
      nextSteps.push('Review top product matches and request proposals.');
    }
    if (scoredCompanies.length > 0 && scoredCompanies[0].score >= 40) {
      nextSteps.push('Contact recommended companies for consultation.');
    }
    if (demand.supportPoc) {
      nextSteps.push('Initiate a POC project with shortlisted suppliers.');
    }

    return {
      demandId: id,
      products: scoredProducts.slice(0, 5),
      agents: scoredAgents.slice(0, 5),
      companies: scoredCompanies.slice(0, 5),
      solutions: scoredSolutions.slice(0, 5),
      riskWarnings,
      nextSteps,
    };
  } catch (error) {
    console.error('[DAL] matchDemand failed:', error);
    return null;
  }
}
