import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';
import { getProposalById, updateProposalStatus, updateProposalWithQuoteItems } from '@/lib/db/proposals';
import { updateDemandStatus } from '@/lib/db/demands';
import prisma from '@/lib/db/client';
import type { UserRole } from '@/types';

const ADMIN_ROLES: UserRole[] = ['admin', 'operator'];

/** Valid status transitions for proposals. */
const PROPOSAL_TRANSITIONS: Record<string, Set<string>> = {
  draft: new Set(['submitted']),
  submitted: new Set(['reviewed', 'rejected']),
  reviewed: new Set(['accepted', 'rejected']),
  accepted: new Set(),
  rejected: new Set(),
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

/**
 * GET /api/proposals/[id]
 *
 * Get proposal detail with milestones, quote items, and supplier info.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;
    const proposal = await getProposalById(id);

    if (!proposal) {
      return NextResponse.json(
        { error: '提案不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    // Verify access: demand owner, proposal supplier, or admin
    const isAdmin = ADMIN_ROLES.includes(auth.user.role as UserRole);

    // Check if user is the supplier who created the proposal
    const isSupplier = auth.user.orgId === proposal.supplierId;

    // Check if user owns the demand
    let isDemandOwner = false;
    if (!isSupplier && !isAdmin) {
      const demandRow = await prisma.demand.findUnique({
        where: { id: proposal.demandId },
        select: { ownerUserId: true },
      });
      isDemandOwner = demandRow?.ownerUserId === auth.user.id;
    }

    if (!isAdmin && !isSupplier && !isDemandOwner) {
      return NextResponse.json(
        { error: '无权查看该提案' },
        { status: 403, headers: corsHeaders() },
      );
    }

    // Enrich with supplier org info
    const org = await prisma.organization.findUnique({
      where: { id: proposal.supplierId },
      select: { name: true, logo: true },
    });

    return apiSuccess({
      ...proposal,
      supplierOrgName: org?.name ?? '未知供应商',
      supplierOrgLogo: org?.logo ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}

/**
 * PUT /api/proposals/[id]
 *
 * Dual-purpose handler:
 * 1. Supplier: Save quote items, milestones, price, scope (requires supplier ownership).
 * 2. Buyer / Admin: Accept / reject proposal by changing status.
 *    If accepted, the demand transitions to 'in_poc'.
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;
    const proposal = await getProposalById(id);

    if (!proposal) {
      return NextResponse.json(
        { error: '提案不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    const body = await request.json();
    const isAdmin = ADMIN_ROLES.includes(auth.user.role as UserRole);

    // --- Case 1: Supplier saving quote items / milestones ---
    const isSupplier = auth.user.orgId === proposal.supplierId;
    if (isSupplier && (body.quoteItems !== undefined || body.milestones !== undefined)) {
      // Supplier can save content only — status changes go through Case 2
      const { status: _forbiddenStatus, ...supplierData } = body;
      const updated = await updateProposalWithQuoteItems(id, {
        quoteItems: supplierData.quoteItems,
        milestones: supplierData.milestones,
        price: supplierData.price,
        scope: supplierData.scope,
        deliveryPeriod: supplierData.deliveryPeriod,
      });

      if (!updated) {
        return NextResponse.json(
          { error: '更新报价失败' },
          { status: 500, headers: corsHeaders() },
        );
      }

      // Enrich with supplier org info
      const org = await prisma.organization.findUnique({
        where: { id: proposal.supplierId },
        select: { name: true, logo: true },
      });

      return apiSuccess({
        ...updated,
        supplierOrgName: org?.name ?? '未知供应商',
        supplierOrgLogo: org?.logo ?? null,
      });
    }

    // --- Case 2: Buyer / Admin changing status ---
    const newStatus = body.status as string;

    if (!newStatus) {
      return NextResponse.json(
        { error: '请提供状态' },
        { status: 400, headers: corsHeaders() },
      );
    }

    // Only demand owner or admin can accept/reject
    if (!isAdmin) {
      const demandRow = await prisma.demand.findUnique({
        where: { id: proposal.demandId },
        select: { ownerUserId: true },
      });
      if (demandRow?.ownerUserId !== auth.user.id) {
        return NextResponse.json(
          { error: '只有需求方可以审核提案' },
          { status: 403, headers: corsHeaders() },
        );
      }
    }

    // Validate status transition
    const allowed = PROPOSAL_TRANSITIONS[proposal.status];
    if (!allowed || !allowed.has(newStatus)) {
      return NextResponse.json(
        { error: `不允许从 "${proposal.status}" 变更为 "${newStatus}"` },
        { status: 400, headers: corsHeaders() },
      );
    }

    // Update proposal status
    const updated = await updateProposalStatus(id, newStatus);
    if (!updated) {
      return NextResponse.json(
        { error: '更新提案状态失败' },
        { status: 500, headers: corsHeaders() },
      );
    }

    // If accepted, transition demand to 'in_poc'
    if (newStatus === 'accepted') {
      await updateDemandStatus(proposal.demandId, 'in_poc');
    }

    // Enrich with supplier org info
    const org = await prisma.organization.findUnique({
      where: { id: proposal.supplierId },
      select: { name: true, logo: true },
    });

    return apiSuccess({
      ...updated,
      supplierOrgName: org?.name ?? '未知供应商',
      supplierOrgLogo: org?.logo ?? null,
    });
  } catch (error) {
    return handleApiError(error);
  }
}
