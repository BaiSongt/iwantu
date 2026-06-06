/**
 * Companies Data Access Layer
 *
 * Handles all database operations for company profiles.
 * Joins Organization + CompanyProfile to produce the frontend CompanyProfile type,
 * which merges fields from both tables (name, logo from Organization; rest from CompanyProfile).
 */

import prisma from './client';
import type { CompanyProfile } from '@/types';

/**
 * Fetch a list of company profiles with optional filters.
 *
 * @param filters - Optional filters: industry, certified, search
 * @returns Array of CompanyProfile objects
 */
export async function getCompanies(filters?: {
  industry?: string;
  certified?: boolean;
  search?: string;
}): Promise<CompanyProfile[]> {
  try {
    const where: Record<string, unknown> = {};

    if (filters?.certified !== undefined) {
      where.certified = filters.certified;
    }

    if (filters?.industry) {
      where.industryExperience = { has: filters.industry };
    }

    if (filters?.search) {
      where.OR = [
        { slogan: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        {
          organization: {
            name: { contains: filters.search, mode: 'insensitive' },
          },
        },
      ];
    }

    const rows = await prisma.companyProfile.findMany({
      where,
      include: { organization: true },
      orderBy: { rating: 'desc' },
    });

    return rows.map(mapCompanyRow);
  } catch (error) {
    console.error('[DAL] getCompanies failed:', error);
    return [];
  }
}

/**
 * Fetch a single company profile by its CompanyProfile ID.
 *
 * @param id - CompanyProfile ID (cuid)
 * @returns CompanyProfile object or null if not found
 */
export async function getCompanyById(id: string): Promise<CompanyProfile | null> {
  try {
    const row = await prisma.companyProfile.findUnique({
      where: { id },
      include: { organization: true },
    });

    if (!row) return null;
    return mapCompanyRow(row);
  } catch (error) {
    console.error('[DAL] getCompanyById failed:', error);
    return null;
  }
}

/**
 * Fetch a company profile by the organization ID.
 *
 * @param orgId - Organization ID (cuid)
 * @returns CompanyProfile object or null if not found
 */
export async function getCompanyByOrgId(orgId: string): Promise<CompanyProfile | null> {
  try {
    const row = await prisma.companyProfile.findUnique({
      where: { orgId },
      include: { organization: true },
    });

    if (!row) return null;
    return mapCompanyRow(row);
  } catch (error) {
    console.error('[DAL] getCompanyByOrgId failed:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal mapper: Prisma row -> frontend CompanyProfile
// ---------------------------------------------------------------------------

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
