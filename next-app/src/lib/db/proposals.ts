/**
 * Proposal Data Access Layer
 *
 * CRUD operations for proposals, including milestones, quote items,
 * and status transitions.
 */

import prisma from './client';
import type { Proposal, Milestone, QuoteItem } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map a Prisma Milestone row to the frontend Milestone shape. */
function toMilestoneShape(
  row: Awaited<
    ReturnType<typeof prisma.milestone.findFirst>
  >,
): Milestone | null {
  if (!row) return null;
  return {
    name: row.name,
    description: row.description ?? '',
    duration: row.duration,
    deliverables: row.deliverables,
  };
}

/** Map a Prisma QuoteItem row to the frontend QuoteItem shape. */
function toQuoteItemShape(
  row: Awaited<ReturnType<typeof prisma.quoteItem.findFirst>>,
): QuoteItem | null {
  if (!row) return null;
  return {
    name: row.name,
    description: row.description ?? '',
    quantity: row.quantity,
    unit: row.unit,
    unitPrice: row.unitPrice,
    totalPrice: row.totalPrice,
  };
}

/**
 * Map a Prisma Proposal row (with milestones + quoteItems) to the frontend
 * Proposal shape used in types/index.ts.
 */
function toProposalShape(
  row: Awaited<ReturnType<typeof prisma.proposal.findFirst>> & {
    milestones?: Awaited<ReturnType<typeof prisma.milestone.findMany>>;
    quoteItems?: Awaited<ReturnType<typeof prisma.quoteItem.findMany>>;
  },
): Proposal | null {
  if (!row) return null;
  return {
    id: row.id,
    demandId: row.demandId,
    supplierId: row.supplierOrgId,
    title: row.title,
    scope: row.scope,
    price: row.price,
    currency: row.currency,
    milestones: (row.milestones ?? [])
      .map(toMilestoneShape)
      .filter((m): m is Milestone => m !== null),
    acceptanceCriteria: [], // Not a separate model -- populated from demand or custom logic
    deliveryPeriod: row.deliveryPeriod ?? '',
    status: row.status as Proposal['status'],
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get a list of proposals with optional filters.
 *
 * @param filters.demandId - Filter by the parent demand
 * @param filters.supplierOrgId - Filter by the supplier organization
 * @param filters.status - Filter by ProposalStatus
 * @returns Array of Proposal objects (without milestones/quoteItems for list view, empty array on error)
 */
export async function getProposals(filters?: {
  demandId?: string;
  supplierOrgId?: string;
  status?: string;
}): Promise<Proposal[]> {
  try {
    const where: Record<string, unknown> = {};

    if (filters?.demandId) {
      where.demandId = filters.demandId;
    }
    if (filters?.supplierOrgId) {
      where.supplierOrgId = filters.supplierOrgId;
    }
    if (filters?.status) {
      where.status = filters.status;
    }

    const rows = await prisma.proposal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return rows
      .map((row) => toProposalShape(row))
      .filter((p): p is Proposal => p !== null);
  } catch (error) {
    console.error('[DAL] getProposals failed:', error);
    return [];
  }
}

/**
 * Get a single proposal by ID, including milestones and quote items.
 *
 * @param id - Proposal ID
 * @returns Proposal with milestones and quoteItems, or null on error
 */
export async function getProposalById(
  id: string,
): Promise<(Proposal & { quoteItems: QuoteItem[] }) | null> {
  try {
    const row = await prisma.proposal.findUnique({
      where: { id },
      include: {
        milestones: true,
        quoteItems: true,
      },
    });

    if (!row) return null;

    const proposal = toProposalShape(row);
    if (!proposal) return null;

    const quoteItems = (row.quoteItems ?? [])
      .map(toQuoteItemShape)
      .filter((q): q is QuoteItem => q !== null);

    return { ...proposal, quoteItems };
  } catch (error) {
    console.error('[DAL] getProposalById failed:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a new proposal, optionally including milestones and quote items.
 *
 * @param data - Proposal fields plus optional nested milestone/quote item data
 * @returns The created Proposal or null on error
 */
export async function createProposal(data: {
  demandId: string;
  supplierOrgId: string;
  title: string;
  scope: string;
  price: number;
  currency?: string;
  deliveryPeriod?: string;
  milestones?: {
    name: string;
    description?: string;
    duration: string;
    deliverables?: string[];
  }[];
  quoteItems?: {
    name: string;
    description?: string;
    quantity?: number;
    unit?: string;
    unitPrice: number;
    totalPrice: number;
  }[];
}): Promise<Proposal | null> {
  try {
    const row = await prisma.proposal.create({
      data: {
        demandId: data.demandId,
        supplierOrgId: data.supplierOrgId,
        title: data.title,
        scope: data.scope,
        price: data.price,
        currency: data.currency ?? 'CNY',
        deliveryPeriod: data.deliveryPeriod,
        status: 'draft',
        milestones: {
          create:
            data.milestones?.map((m) => ({
              name: m.name,
              description: m.description,
              duration: m.duration,
              deliverables: m.deliverables ?? [],
            })) ?? [],
        },
        quoteItems: {
          create:
            data.quoteItems?.map((q) => ({
              name: q.name,
              description: q.description,
              quantity: q.quantity ?? 1,
              unit: q.unit ?? '项',
              unitPrice: q.unitPrice,
              totalPrice: q.totalPrice,
            })) ?? [],
        },
      },
      include: {
        milestones: true,
        quoteItems: true,
      },
    });

    return toProposalShape(row);
  } catch (error) {
    console.error('[DAL] createProposal failed:', error);
    return null;
  }
}

/**
 * Update a proposal's quote items (replace all) and optional fields.
 *
 * This is used by the quote builder to save the full set of quote items
 * and optionally update milestones, price, scope, and status.
 *
 * @param id - Proposal ID
 * @param data.quoteItems - Array of quote item data to replace the existing set
 * @param data.milestones - Optional array of milestone data to replace the existing set
 * @param data.price - Optional total price override
 * @param data.scope - Optional scope override
 * @param data.status - Optional status override
 * @returns Updated proposal with quoteItems, or null on error
 */
export async function updateProposalWithQuoteItems(
  id: string,
  data: {
    quoteItems?: {
      name: string;
      description?: string;
      quantity?: number;
      unit?: string;
      unitPrice: number;
      totalPrice: number;
    }[];
    milestones?: {
      name: string;
      description?: string;
      duration: string;
      deliverables?: string[];
    }[];
    price?: number;
    scope?: string;
    deliveryPeriod?: string;
    status?: string;
  },
): Promise<(Proposal & { quoteItems: QuoteItem[] }) | null> {
  try {
    // Use a transaction to delete old items and create new ones atomically
    const row = await prisma.$transaction(async (tx) => {
      // Delete existing quote items if we're replacing them
      if (data.quoteItems !== undefined) {
        await tx.quoteItem.deleteMany({ where: { proposalId: id } });
      }

      // Delete existing milestones if we're replacing them
      if (data.milestones !== undefined) {
        await tx.milestone.deleteMany({ where: { proposalId: id } });
      }

      // Build update payload
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const updateData: any = {};

      if (data.price !== undefined) updateData.price = data.price;
      if (data.scope !== undefined) updateData.scope = data.scope;
      if (data.deliveryPeriod !== undefined) updateData.deliveryPeriod = data.deliveryPeriod;
      if (data.status !== undefined) updateData.status = data.status;

      if (data.quoteItems !== undefined) {
        updateData.quoteItems = {
          create: data.quoteItems.map((q) => ({
            name: q.name,
            description: q.description,
            quantity: q.quantity ?? 1,
            unit: q.unit ?? '项',
            unitPrice: q.unitPrice,
            totalPrice: q.totalPrice,
          })),
        };
      }

      if (data.milestones !== undefined) {
        updateData.milestones = {
          create: data.milestones.map((m) => ({
            name: m.name,
            description: m.description,
            duration: m.duration,
            deliverables: m.deliverables ?? [],
          })),
        };
      }

      return tx.proposal.update({
        where: { id },
        data: updateData,
        include: {
          milestones: true,
          quoteItems: true,
        },
      });
    });

    if (!row) return null;

    const proposal = toProposalShape(row);
    if (!proposal) return null;

    const quoteItems = (row.quoteItems ?? [])
      .map(toQuoteItemShape)
      .filter((q): q is QuoteItem => q !== null);

    return { ...proposal, quoteItems };
  } catch (error) {
    console.error('[DAL] updateProposalWithQuoteItems failed:', error);
    return null;
  }
}

/**
 * Change the status of a proposal.
 *
 * @param id - Proposal ID
 * @param status - New ProposalStatus value
 * @returns Updated Proposal or null on error
 */
export async function updateProposalStatus(
  id: string,
  status: string,
): Promise<Proposal | null> {
  try {
    const row = await prisma.proposal.update({
      where: { id },
      data: { status: status as never },
      include: {
        milestones: true,
        quoteItems: true,
      },
    });
    return toProposalShape(row);
  } catch (error) {
    console.error('[DAL] updateProposalStatus failed:', error);
    return null;
  }
}
