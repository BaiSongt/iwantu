/**
 * Products Data Access Layer
 *
 * Handles all database operations for products.
 * Maps Prisma Product model (with orgId relation) to the frontend Product type
 * (with `company` and `companyLogo` fields).
 */

import prisma from './client';
import type { Product } from '@/types';

/**
 * Fetch a list of products with optional filters.
 * Includes the associated Organization to populate `company` / `companyLogo`.
 *
 * @param filters - Optional filters: industry, category, status, search
 * @returns Array of Product objects matching the filters
 */
export async function getProducts(filters?: {
  orgId?: string;
  industry?: string;
  category?: string;
  status?: string;
  search?: string;
  deploymentMode?: string;
  pricingModel?: string;
}): Promise<Product[]> {
  try {
    const where: Record<string, unknown> = {};

    if (filters?.orgId) {
      where.orgId = filters.orgId;
    }

    if (filters?.status) {
      where.status = filters.status;
    }

    if (filters?.category) {
      where.category = filters.category;
    }

    if (filters?.industry) {
      where.industryTags = { has: filters.industry };
    }

    if (filters?.deploymentMode) {
      where.deploymentModes = { has: filters.deploymentMode };
    }

    if (filters?.pricingModel) {
      where.pricingModel = filters.pricingModel;
    }

    if (filters?.search) {
      where.OR = [
        { name: { contains: filters.search, mode: 'insensitive' } },
        { summary: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const rows = await prisma.product.findMany({
      where,
      include: { organization: true },
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(mapProductRow);
  } catch (error) {
    console.error('[DAL] getProducts failed:', error);
    return [];
  }
}

/**
 * Fetch a single product by ID.
 *
 * @param id - Product ID (cuid)
 * @returns Product object or null if not found
 */
export async function getProductById(id: string): Promise<Product | null> {
  try {
    const row = await prisma.product.findUnique({
      where: { id },
      include: { organization: true },
    });

    if (!row) return null;
    return mapProductRow(row);
  } catch (error) {
    console.error('[DAL] getProductById failed:', error);
    return null;
  }
}

/**
 * Create a new product.
 *
 * @param data - Product creation fields (orgId required)
 * @returns Created Product or null on error
 */
export async function createProduct(data: {
  orgId: string;
  name: string;
  summary: string;
  description?: string;
  coverImage?: string;
  category: string;
  industryTags?: string[];
  capabilityTags?: string[];
  deploymentModes?: string[];
  pricingModel?: string;
  price?: string;
  supportPoc?: boolean;
  supportPrivateDeployment?: boolean;
  score?: string;
  rating?: number;
  caseCount?: number;
  pocCount?: number;
  status?: string;
  accent?: string;
  shot?: string;
  tags?: string[];
}): Promise<Product | null> {
  try {
    const row = await prisma.product.create({
      data: {
        orgId: data.orgId,
        name: data.name,
        summary: data.summary,
        description: data.description ?? '',
        coverImage: data.coverImage,
        category: data.category,
        industryTags: data.industryTags ?? [],
        capabilityTags: data.capabilityTags ?? [],
        deploymentModes: data.deploymentModes ?? [],
        pricingModel:
          (data.pricingModel as
            | 'subscription'
            | 'per_project'
            | 'per_seat'
            | 'pay_per_use'
            | 'custom') ?? 'custom',
        price: data.price ?? '',
        supportPoc: data.supportPoc ?? false,
        supportPrivateDeployment: data.supportPrivateDeployment ?? false,
        score: data.score ?? '',
        rating: data.rating ?? 0,
        caseCount: data.caseCount ?? 0,
        pocCount: data.pocCount ?? 0,
        status:
          (data.status as
            | 'draft'
            | 'pending_review'
            | 'published'
            | 'needs_info'
            | 'delisted'
            | 'flagged') ?? 'draft',
        accent: data.accent ?? 'blue',
        shot: data.shot ?? 'default',
        tags: data.tags ?? [],
      },
      include: { organization: true },
    });

    return mapProductRow(row);
  } catch (error) {
    console.error('[DAL] createProduct failed:', error);
    return null;
  }
}

/**
 * Update an existing product.
 *
 * @param id - Product ID to update
 * @param data - Partial product fields to update
 * @returns Updated Product or null on error
 */
export async function updateProduct(
  id: string,
  data: Partial<{
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
  }>,
): Promise<Product | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { ...data };
    if (data.pricingModel) updateData.pricingModel = data.pricingModel as any;
    if (data.status) updateData.status = data.status as any;
    if (data.deploymentModes) updateData.deploymentModes = data.deploymentModes as any;

    const row = await prisma.product.update({
      where: { id },
      data: updateData,
      include: { organization: true },
    });

    return mapProductRow(row);
  } catch (error) {
    console.error('[DAL] updateProduct failed:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Internal mapper: Prisma row (with included organization) -> frontend Product
// ---------------------------------------------------------------------------

function mapProductRow(row: {
  id: string;
  orgId: string;
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
    orgId: row.orgId,
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
