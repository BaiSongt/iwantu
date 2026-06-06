/**
 * Solutions Data Access Layer
 *
 * Handles all database operations for solutions.
 * Maps the Prisma Solution model to the frontend Solution type.
 * Note: Prisma uses `recommendedProductIds` / `recommendedCompanyIds` (arrays of ID strings)
 * while the frontend type uses `recommendedProducts` / `recommendedCompanies`.
 */

import prisma from './client';
import type { Solution } from '@/types';

/**
 * Fetch a list of solutions with optional filters.
 *
 * @param filters - Optional filters: industry, supportPoc, search
 * @returns Array of Solution objects
 */
export async function getSolutions(filters?: {
  industry?: string;
  supportPoc?: boolean;
  search?: string;
}): Promise<Solution[]> {
  try {
    const where: Record<string, unknown> = {};

    if (filters?.supportPoc !== undefined) {
      where.supportPoc = filters.supportPoc;
    }

    if (filters?.industry) {
      where.industry = { has: filters.industry };
    }

    if (filters?.search) {
      where.OR = [
        { title: { contains: filters.search, mode: 'insensitive' } },
        { summary: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { scenario: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const rows = await prisma.solution.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(mapSolutionRow);
  } catch (error) {
    console.error('[DAL] getSolutions failed:', error);
    return [];
  }
}

/**
 * Fetch a single solution by ID.
 *
 * @param id - Solution ID (cuid)
 * @returns Solution object or null if not found
 */
export async function getSolutionById(id: string): Promise<Solution | null> {
  try {
    const row = await prisma.solution.findUnique({
      where: { id },
    });

    if (!row) return null;
    return mapSolutionRow(row);
  } catch (error) {
    console.error('[DAL] getSolutionById failed:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal mapper: Prisma row -> frontend Solution
// ---------------------------------------------------------------------------

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
