/**
 * Search Data Access Layer
 *
 * Cross-entity search across products, companies, and solutions.
 * Uses Prisma `contains` queries (case-insensitive where supported)
 * with tag-based boosting and relevance scoring.
 * Designed to be upgraded to full-text search in a future version.
 */

import prisma from './client';
import type { Product, CompanyProfile, Solution } from '@/types';

/** A single scored result item with relevance metadata. */
export interface ScoredItem<T> {
  item: T;
  score: number;
  matchedFields: string[];
}

/** Shape returned by the unified search endpoint. */
export interface SearchResult {
  products: ScoredItem<Product>[];
  companies: ScoredItem<CompanyProfile>[];
  solutions: ScoredItem<Solution>[];
}

/** Filter options for searchAll(). */
export interface SearchFilters {
  type?: 'all' | 'products' | 'demands' | 'companies' | 'solutions';
  industry?: string;
  category?: string;
  status?: string;
}

// ---------------------------------------------------------------------------
// Relevance scoring helpers
// ---------------------------------------------------------------------------

const INDUSTRY_LABELS: Record<string, string> = {
  manufacturing: '制造业',
  government: '政务',
  finance: '金融',
  education: '教育',
  research: '科研',
  healthcare: '医疗',
  retail: '零售',
  energy: '能源',
  industrial_software: '工业软件',
};

/** Normalise a string for comparison: lowercase, strip whitespace / hyphens / underscores. */
function normalize(s: string): string {
  return s.toLowerCase().replace(/[\s_-]/g, '');
}

/** Return all IndustryTag enum values that match the query text (Chinese or English). */
function matchingIndustries(query: string): string[] {
  const nq = normalize(query);
  const matches: string[] = [];
  for (const [key, label] of Object.entries(INDUSTRY_LABELS)) {
    if (normalize(key).includes(nq) || normalize(label).includes(nq)) {
      matches.push(key);
    }
  }
  return matches;
}

/**
 * Compute a simple relevance score for a text field match.
 *
 * - Exact (case-insensitive) match: 10
 * - Starts-with match: 8
 * - Contains match: 5
 */
function textScore(fieldValue: string, query: string): number {
  const lf = normalize(fieldValue);
  const lq = normalize(query);
  if (lf === lq) return 10;
  if (lf.startsWith(lq)) return 8;
  if (lf.includes(lq)) return 5;
  return 0;
}

/**
 * Compute tag-based boost score.
 *
 * For each tag in `tags` that matches the query or a matched industry, add 6 points.
 */
function tagBoostScore(tags: string[], query: string, matchedIndustries: string[]): number {
  let score = 0;
  const nq = normalize(query);
  for (const tag of tags) {
    const nt = normalize(tag);
    if (nt === nq || nt.includes(nq)) {
      score += 6;
    } else if (matchedIndustries.some((mi) => normalize(mi) === nt)) {
      score += 4;
    }
  }
  return score;
}

// ---------------------------------------------------------------------------
// Product search
// ---------------------------------------------------------------------------

async function searchProducts(
  term: string,
  filters: SearchFilters,
  matchedIndustries: string[],
): Promise<ScoredItem<Product>[]> {
  // Build Prisma where clause
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  // Text search across name / summary / description + tag matches
  const orConditions: any[] = [
    { name: { contains: term, mode: 'insensitive' } },
    { summary: { contains: term, mode: 'insensitive' } },
    { description: { contains: term, mode: 'insensitive' } },
    { industryTags: { has: term } },
    { tags: { has: term } },
    // Also search by Chinese industry labels
    ...matchedIndustries.map((ind) => ({ industryTags: { has: ind } })),
  ];
  where.OR = orConditions;

  if (filters.status) {
    where.status = filters.status;
  } else {
    // Default: only published products in search
    where.status = 'published';
  }

  if (filters.category) {
    where.category = filters.category;
  }

  if (filters.industry) {
    where.industryTags = { has: filters.industry };
  }

  const rows = await prisma.product.findMany({
    where,
    include: { organization: true },
    take: 40,
  });

  return rows
    .map((row) => {
      const product = mapProductRow(row);

      // Compute relevance score
      let score = 0;
      const matchedFields: string[] = [];

      // Text field scoring
      const nameScore = textScore(row.name, term);
      if (nameScore > 0) { score += nameScore; matchedFields.push('name'); }

      const summaryScore = textScore(row.summary, term);
      if (summaryScore > 0) { score += summaryScore * 0.6; matchedFields.push('summary'); }

      const descScore = textScore(row.description, term);
      if (descScore > 0) { score += descScore * 0.3; matchedFields.push('description'); }

      // Tag boost
      const industryBoost = tagBoostScore(row.industryTags, term, matchedIndustries);
      const capabilityBoost = tagBoostScore(row.capabilityTags, term, matchedIndustries);
      if (industryBoost > 0) { score += industryBoost; matchedFields.push('industryTags'); }
      if (capabilityBoost > 0) { score += capabilityBoost; matchedFields.push('capabilityTags'); }

      return { item: product, score: Math.round(score), matchedFields: [...new Set(matchedFields)] };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Company search
// ---------------------------------------------------------------------------

async function searchCompanies(
  term: string,
  filters: SearchFilters,
  matchedIndustries: string[],
): Promise<ScoredItem<CompanyProfile>[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  where.OR = [
    { slogan: { contains: term, mode: 'insensitive' } },
    { description: { contains: term, mode: 'insensitive' } },
    { industryExperience: { has: term } },
    { tags: { has: term } },
    {
      organization: {
        name: { contains: term, mode: 'insensitive' },
      },
    },
    ...matchedIndustries.map((ind) => ({ industryExperience: { has: ind } })),
  ];

  if (filters.industry) {
    where.industryExperience = { has: filters.industry };
  }

  const rows = await prisma.companyProfile.findMany({
    where,
    include: { organization: true },
    take: 40,
  });

  return rows
    .map((row) => {
      const company = mapCompanyRow(row);

      let score = 0;
      const matchedFields: string[] = [];

      const orgName = row.organization?.name ?? '';
      const nameScore = textScore(orgName, term);
      if (nameScore > 0) { score += nameScore; matchedFields.push('name'); }

      const sloganScore = textScore(row.slogan, term);
      if (sloganScore > 0) { score += sloganScore * 0.7; matchedFields.push('slogan'); }

      const descScore = textScore(row.description, term);
      if (descScore > 0) { score += descScore * 0.4; matchedFields.push('description'); }

      const industryBoost = tagBoostScore(row.industryExperience, term, matchedIndustries);
      const capBoost = tagBoostScore(row.capabilities, term, matchedIndustries);
      if (industryBoost > 0) { score += industryBoost; matchedFields.push('industryExperience'); }
      if (capBoost > 0) { score += capBoost; matchedFields.push('capabilities'); }

      return { item: company, score: Math.round(score), matchedFields: [...new Set(matchedFields)] };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Solution search
// ---------------------------------------------------------------------------

async function searchSolutions(
  term: string,
  filters: SearchFilters,
  matchedIndustries: string[],
): Promise<ScoredItem<Solution>[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {};

  where.OR = [
    { title: { contains: term, mode: 'insensitive' } },
    { summary: { contains: term, mode: 'insensitive' } },
    { description: { contains: term, mode: 'insensitive' } },
    { scenario: { contains: term, mode: 'insensitive' } },
    { industry: { has: term } },
    { components: { has: term } },
    ...matchedIndustries.map((ind) => ({ industry: { has: ind } })),
  ];

  if (filters.industry) {
    where.industry = { has: filters.industry };
  }

  const rows = await prisma.solution.findMany({
    where,
    take: 40,
  });

  return rows
    .map((row) => {
      const solution = mapSolutionRow(row);

      let score = 0;
      const matchedFields: string[] = [];

      const titleScore = textScore(row.title, term);
      if (titleScore > 0) { score += titleScore; matchedFields.push('title'); }

      const summaryScore = textScore(row.summary, term);
      if (summaryScore > 0) { score += summaryScore * 0.6; matchedFields.push('summary'); }

      const scenarioScore = textScore(row.scenario, term);
      if (scenarioScore > 0) { score += scenarioScore * 0.5; matchedFields.push('scenario'); }

      const descScore = textScore(row.description, term);
      if (descScore > 0) { score += descScore * 0.3; matchedFields.push('description'); }

      const industryBoost = tagBoostScore(row.industry, term, matchedIndustries);
      if (industryBoost > 0) { score += industryBoost; matchedFields.push('industry'); }

      return { item: solution, score: Math.round(score), matchedFields: [...new Set(matchedFields)] };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}

// ---------------------------------------------------------------------------
// Main search function
// ---------------------------------------------------------------------------

/**
 * Search across products, companies, and solutions using a single query string.
 *
 * Features:
 * - Text search with relevance scoring (exact > starts-with > contains)
 * - Tag-based boosting: matches against industry/capability tags get bonus points
 * - Chinese text support: industry tags map to Chinese labels for matching
 * - Filter support: type, industry, category, status
 * - Returns scored results with matched field metadata
 *
 * @param query - The search string
 * @param filters - Optional filters for type, industry, category, status
 * @returns SearchResult with scored entities in each category
 */
export async function searchAll(
  query: string,
  filters?: SearchFilters,
): Promise<SearchResult> {
  if (!query || query.trim().length === 0) {
    return { products: [], companies: [], solutions: [] };
  }

  const term = query.trim();
  const f = filters ?? {};
  const matchedIndustries = matchingIndustries(term);

  try {
    const shouldSearchProducts = f.type === 'all' || f.type === 'products' || !f.type;
    const shouldSearchCompanies = f.type === 'all' || f.type === 'companies' || !f.type;
    const shouldSearchSolutions = f.type === 'all' || f.type === 'solutions' || !f.type;

    const [productResults, companyResults, solutionResults] = await Promise.all([
      shouldSearchProducts
        ? searchProducts(term, f, matchedIndustries)
        : Promise.resolve([]),
      shouldSearchCompanies
        ? searchCompanies(term, f, matchedIndustries)
        : Promise.resolve([]),
      shouldSearchSolutions
        ? searchSolutions(term, f, matchedIndustries)
        : Promise.resolve([]),
    ]);

    return {
      products: productResults,
      companies: companyResults,
      solutions: solutionResults,
    };
  } catch (error) {
    console.error('[DAL] searchAll failed:', error);
    return { products: [], companies: [], solutions: [] };
  }
}

// ---------------------------------------------------------------------------
// Mappers — duplicated from their respective DAL modules to keep this module
// self-contained (avoids circular dependency risk and keeps imports light).
// ---------------------------------------------------------------------------

function mapProductRow(row: {
  id: string;
  name: string;
  summary: string;
  description: string;
  coverImage: string | null;
  category: string;
  industryTags: string[];
  capabilityTags: string[];
  deploymentModes: string[];
  pricingModel: string;
  price: string;
  supportPoc: boolean;
  supportPrivateDeployment: boolean;
  score: string;
  rating: number;
  caseCount: number;
  pocCount: number;
  status: string;
  accent: string;
  shot: string;
  tags: string[];
  createdAt: Date;
  organization: { id: string; name: string; logo: string | null } | null;
}): Product {
  return {
    id: row.id,
    name: row.name,
    company: row.organization?.name ?? '',
    companyLogo: row.organization?.logo ?? undefined,
    summary: row.summary,
    description: row.description,
    coverImage: row.coverImage ?? undefined,
    category: row.category,
    industryTags: row.industryTags as Product['industryTags'],
    capabilityTags: row.capabilityTags,
    deploymentModes: row.deploymentModes as Product['deploymentModes'],
    pricingModel: row.pricingModel as Product['pricingModel'],
    price: row.price,
    supportPoc: row.supportPoc,
    supportPrivateDeployment: row.supportPrivateDeployment,
    score: row.score,
    rating: row.rating,
    caseCount: row.caseCount,
    pocCount: row.pocCount,
    status: row.status as Product['status'],
    accent: row.accent,
    shot: row.shot,
    tags: row.tags,
    deploy: row.deploymentModes.join('/'),
    createdAt: row.createdAt.toISOString().slice(0, 10),
  };
}

function mapCompanyRow(row: {
  id: string;
  orgId: string;
  slogan: string;
  description: string;
  certifications: string[];
  capabilities: string[];
  industryExperience: string[];
  deliveryScope: string[];
  caseStudies: string[];
  rating: number;
  responseRate: number;
  certified: boolean;
  tags: string[];
  organization: { id: string; name: string; logo: string | null } | null;
}): CompanyProfile {
  return {
    id: row.id,
    name: row.organization?.name ?? '',
    logo: row.organization?.logo ?? undefined,
    slogan: row.slogan,
    description: row.description,
    certifications: row.certifications,
    capabilities: row.capabilities,
    industryExperience: row.industryExperience as CompanyProfile['industryExperience'],
    deliveryScope: row.deliveryScope,
    caseStudies: row.caseStudies,
    rating: row.rating,
    responseRate: row.responseRate,
    certified: row.certified,
    tags: row.tags,
  };
}

function mapSolutionRow(row: {
  id: string;
  title: string;
  summary: string;
  description: string;
  industry: string[];
  scenario: string;
  budgetRange: string | null;
  deploymentModes: string[];
  deliveryPeriod: string | null;
  supportPoc: boolean;
  components: string[];
  recommendedProductIds: string[];
  recommendedCompanyIds: string[];
}): Solution {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    description: row.description,
    industry: row.industry as Solution['industry'],
    scenario: row.scenario,
    budgetRange: row.budgetRange ?? '',
    deploymentModes: row.deploymentModes as Solution['deploymentModes'],
    deliveryPeriod: row.deliveryPeriod ?? '',
    supportPoc: row.supportPoc,
    components: row.components,
    recommendedProducts: row.recommendedProductIds,
    recommendedCompanies: row.recommendedCompanyIds,
  };
}
