/**
 * POC (Proof of Concept) Data Access Layer
 *
 * CRUD operations for POC projects, status transitions, participant management.
 */

import prisma from './client';
import type { PocStatus } from '@prisma/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PocProjectDetail {
  id: string;
  demandId: string;
  productId: string | null;
  supplierOrgId: string | null;
  status: PocStatus;
  testMetrics: string[];
  acceptanceCriteria: string[];
  sampleDataStatus: 'pending' | 'uploaded' | 'processing';
  startDate: string;
  endDate: string | null;
  demand?: {
    id: string;
    title: string;
    industry: string;
  } | null;
  product?: {
    id: string;
    name: string;
  } | null;
  supplierOrg?: {
    id: string;
    name: string;
  } | null;
  participants: {
    id: string;
    userId: string;
    role: string;
    orgId: string;
    userName?: string;
  }[];
}

// ---------------------------------------------------------------------------
// Status transitions
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, Set<string>> = {
  not_started: new Set(['confirming_requirements', 'terminated']),
  confirming_requirements: new Set(['uploading_sample_data', 'terminated']),
  uploading_sample_data: new Set(['supplier_testing', 'terminated']),
  supplier_testing: new Set(['result_review', 'terminated']),
  result_review: new Set(['procurement_discussion', 'terminated']),
  procurement_discussion: new Set(['completed', 'terminated']),
  completed: new Set([]),
  terminated: new Set([]),
};

export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed ? allowed.has(to) : false;
}

/**
 * Get the step index (0-based) for a given POC status.
 * Maps to the 7-step flow: not_started(0) through completed(6).
 */
export function getStepIndex(status: PocStatus): number {
  const order: PocStatus[] = [
    'not_started',
    'confirming_requirements',
    'uploading_sample_data',
    'supplier_testing',
    'result_review',
    'procurement_discussion',
    'completed',
  ];
  const idx = order.indexOf(status);
  return idx === -1 ? 0 : idx;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const POC_INCLUDE = {
  demand: { select: { id: true, title: true, industry: true } },
  product: { select: { id: true, name: true } },
  participants: true,
} as const;

type PocRowWithIncludes = Awaited<
  ReturnType<typeof prisma.pocProject.findFirst>
> & {
  demand?: { id: string; title: string; industry: string } | null;
  product?: { id: string; name: string } | null;
  participants?: {
    id: string;
    userId: string;
    role: string;
    orgId: string;
  }[];
};

/**
 * Enrich participant rows with user names (PocParticipant has no User relation).
 */
async function enrichParticipants(
  participants: { id: string; userId: string; role: string; orgId: string }[],
): Promise<PocProjectDetail['participants']> {
  const userIds = [...new Set(participants.map((p) => p.userId))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, name: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u.name]));

  return participants.map((p) => ({
    id: p.id,
    userId: p.userId,
    role: p.role,
    orgId: p.orgId,
    userName: userMap.get(p.userId),
  }));
}

async function mapPocRow(row: PocRowWithIncludes): Promise<PocProjectDetail> {
  const participants = row.participants ?? [];
  const enrichedParticipants = await enrichParticipants(participants);

  return {
    id: row.id,
    demandId: row.demandId,
    productId: row.productId,
    supplierOrgId: row.supplierOrgId,
    status: row.status,
    testMetrics: row.testMetrics,
    acceptanceCriteria: row.acceptanceCriteria,
    sampleDataStatus: row.sampleDataStatus as PocProjectDetail['sampleDataStatus'],
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate ? row.endDate.toISOString().slice(0, 10) : null,
    demand: row.demand ?? null,
    product: row.product ?? null,
    supplierOrg: null,
    participants: enrichedParticipants,
  };
}

/**
 * Attach supplierOrg info if supplierOrgId is present.
 */
async function attachSupplierOrg(
  detail: PocProjectDetail,
): Promise<PocProjectDetail> {
  if (detail.supplierOrgId) {
    const org = await prisma.organization.findUnique({
      where: { id: detail.supplierOrgId },
      select: { id: true, name: true },
    });
    detail.supplierOrg = org;
  }
  return detail;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get a list of POC projects with optional filters.
 */
export async function getPocProjects(filters?: {
  status?: string;
  demandId?: string;
  supplierOrgId?: string;
}): Promise<PocProjectDetail[]> {
  try {
    const where: Record<string, unknown> = {};

    if (filters?.status) {
      where.status = filters.status;
    }
    if (filters?.demandId) {
      where.demandId = filters.demandId;
    }
    if (filters?.supplierOrgId) {
      where.supplierOrgId = filters.supplierOrgId;
    }

    const rows = await prisma.pocProject.findMany({
      where,
      include: POC_INCLUDE,
      orderBy: { startDate: 'desc' },
    });

    const results: PocProjectDetail[] = [];
    for (const row of rows) {
      const mapped = await mapPocRow(row as PocRowWithIncludes);
      await attachSupplierOrg(mapped);
      results.push(mapped);
    }

    return results;
  } catch (error) {
    console.error('[DAL] getPocProjects failed:', error);
    return [];
  }
}

/**
 * Get a single POC project by ID with full details.
 */
export async function getPocById(id: string): Promise<PocProjectDetail | null> {
  try {
    const row = await prisma.pocProject.findUnique({
      where: { id },
      include: POC_INCLUDE,
    });

    if (!row) return null;

    const mapped = await mapPocRow(row as PocRowWithIncludes);
    await attachSupplierOrg(mapped);
    return mapped;
  } catch (error) {
    console.error('[DAL] getPocById failed:', error);
    return null;
  }
}

/**
 * Get POC projects where a user participates (via their org membership or direct userId).
 */
export async function getPocForUser(userId: string): Promise<PocProjectDetail[]> {
  try {
    // Find POC participants matching the user directly or via their orgs
    const memberships = await prisma.organizationMember.findMany({
      where: { userId },
      select: { orgId: true },
    });
    const orgIds = memberships.map((m) => m.orgId);

    const participantWhere: { userId?: string; orgId?: { in: string[] } }[] = [];
    participantWhere.push({ userId });
    if (orgIds.length > 0) {
      participantWhere.push({ orgId: { in: orgIds } });
    }

    const matchingParticipants = await prisma.pocParticipant.findMany({
      where: { OR: participantWhere },
      select: { pocProjectId: true },
    });

    const pocIds = [...new Set(matchingParticipants.map((p) => p.pocProjectId))];
    if (pocIds.length === 0) return [];

    const rows = await prisma.pocProject.findMany({
      where: { id: { in: pocIds } },
      include: POC_INCLUDE,
      orderBy: { startDate: 'desc' },
    });

    const results: PocProjectDetail[] = [];
    for (const row of rows) {
      const mapped = await mapPocRow(row as PocRowWithIncludes);
      await attachSupplierOrg(mapped);
      results.push(mapped);
    }

    return results;
  } catch (error) {
    console.error('[DAL] getPocForUser failed:', error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a POC project from an accepted proposal.
 * Adds the buyer and supplier as participants in a transaction.
 */
export async function createPocFromProposal(data: {
  demandId: string;
  productId?: string;
  supplierOrgId?: string;
  acceptanceCriteria?: string[];
  buyerUserId: string;
  buyerOrgId?: string;
  supplierUserId?: string;
  supplierOrgIdForParticipant?: string;
}): Promise<PocProjectDetail | null> {
  try {
    const pocId = await prisma.$transaction(async (tx) => {
      // Create the POC project
      const poc = await tx.pocProject.create({
        data: {
          demandId: data.demandId,
          productId: data.productId ?? null,
          supplierOrgId: data.supplierOrgId ?? null,
          status: 'not_started',
          acceptanceCriteria: data.acceptanceCriteria ?? [],
          testMetrics: [],
          sampleDataStatus: 'pending',
        },
      });

      // Add buyer as participant
      await tx.pocParticipant.create({
        data: {
          pocProjectId: poc.id,
          userId: data.buyerUserId,
          role: 'buyer',
          orgId: data.buyerOrgId ?? '',
        },
      });

      // Add supplier as participant if provided
      if (data.supplierUserId) {
        await tx.pocParticipant.create({
          data: {
            pocProjectId: poc.id,
            userId: data.supplierUserId,
            role: 'supplier',
            orgId: data.supplierOrgIdForParticipant ?? '',
          },
        });
      }

      return poc.id;
    });

    // Re-fetch outside transaction to get full details with includes
    const result = await getPocById(pocId);
    return result;
  } catch (error) {
    console.error('[DAL] createPocFromProposal failed:', error);
    return null;
  }
}

/**
 * Update POC status with transition validation.
 * Throws an error if the transition is invalid.
 */
export async function updatePocStatus(
  id: string,
  newStatus: PocStatus,
): Promise<PocProjectDetail | null> {
  try {
    const current = await prisma.pocProject.findUnique({ where: { id } });
    if (!current) return null;

    if (!isValidTransition(current.status, newStatus)) {
      throw new Error(
        `不允许从 "${current.status}" 变更为 "${newStatus}"`,
      );
    }

    const updateData: Record<string, unknown> = {
      status: newStatus,
    };

    // Set endDate when completing or terminating
    if (newStatus === 'completed' || newStatus === 'terminated') {
      updateData.endDate = new Date();
    }

    await prisma.pocProject.update({
      where: { id },
      data: updateData,
    });

    // Re-fetch to get full mapped result
    return getPocById(id);
  } catch (error) {
    console.error('[DAL] updatePocStatus failed:', error);
    return null;
  }
}

/**
 * Update the sample data upload status.
 */
export async function updateSampleDataStatus(
  id: string,
  sampleDataStatus: 'pending' | 'uploaded' | 'processing',
): Promise<PocProjectDetail | null> {
  try {
    await prisma.pocProject.update({
      where: { id },
      data: { sampleDataStatus },
    });

    return getPocById(id);
  } catch (error) {
    console.error('[DAL] updateSampleDataStatus failed:', error);
    return null;
  }
}

/**
 * Add a participant to a POC project.
 */
export async function addPocParticipant(
  pocId: string,
  userId: string,
  role: string,
  orgId: string,
): Promise<{ id: string; userId: string; role: string; orgId: string } | null> {
  try {
    const participant = await prisma.pocParticipant.create({
      data: {
        pocProjectId: pocId,
        userId,
        role,
        orgId,
      },
    });
    return {
      id: participant.id,
      userId: participant.userId,
      role: participant.role,
      orgId: participant.orgId,
    };
  } catch (error) {
    console.error('[DAL] addPocParticipant failed:', error);
    return null;
  }
}
