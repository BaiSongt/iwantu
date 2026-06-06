/**
 * Search Data Access Layer
 *
 * Cross-entity search across products, companies, and solutions.
 * Uses Prisma `contains` queries (case-insensitive where supported).
 * Designed to be upgraded to full-text search in a future version.
 */

import prisma from './client';
import type { Product, CompanyProfile, Solution } from '@/types';

/** Shape returned by the unified search endpoint. */
export interface SearchResult {
  products: Product[];
  companies: CompanyProfile[];
  solutions: Solution[];
}

/**
 * Search across products, companies, and solutions using a single query string.
 *
 * Uses `contains` (ILIKE under the hood) for each entity type:
 * - Products: matches name, summary, description
 * - Companies: matches organization name, slogan, description
 * - Solutions: matches title, summary, description, scenario
 *
 * @param query - The search string
 * @returns SearchResult with matching entities in each category
 */
export async function searchAll(query: string): Promise<SearchResult> {
  if (!query || query.trim().length === 0) {
    return { products: [], companies: [], solutions: [] };
  }

  const term = query.trim();

  try {
    const [productRows, companyRows, solutionRows] = await Promise.all([
      prisma.product.findMany({
        where: {
          status: 'published',
          OR: [
            { name: { contains: term, mode: 'insensitive' } },
            { summary: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
          ],
        },
        include: { organization: true },
        take: 20,
      }),

      prisma.companyProfile.findMany({
        where: {
          OR: [
            { slogan: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            {
              organization: {
                name: { contains: term, mode: 'insensitive' },
              },
            },
          ],
        },
        include: { organization: true },
        take: 20,
      }),

      prisma.solution.findMany({
        where: {
          OR: [
            { title: { contains: term, mode: 'insensitive' } },
            { summary: { contains: term, mode: 'insensitive' } },
            { description: { contains: term, mode: 'insensitive' } },
            { scenario: { contains: term, mode: 'insensitive' } },
          ],
        },
        take: 20,
      }),
    ]);

    return {
      products: productRows.map(mapProductRow),
      companies: companyRows.map(mapCompanyRow),
      solutions: solutionRows.map(mapSolutionRow),
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
