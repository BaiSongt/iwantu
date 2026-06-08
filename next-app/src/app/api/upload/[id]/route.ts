/**
 * Download / Serve File API Route
 *
 * GET /api/upload/[id] — Stream a file from disk by its Attachment ID.
 * Requires authentication and resource-level access check.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import prisma from '@/lib/db/client';
import { getFileStream } from '@/lib/storage';
import { handleApiError, corsHeaders } from '@/lib/api-utils';
import { Readable } from 'node:stream';

/**
 * Check if user can access files belonging to a target resource.
 */
async function canAccessResource(
  user: { id: string; orgId?: string | null; role: string },
  targetType: string,
  targetId: string,
): Promise<boolean> {
  // Admin/operator can access everything
  if (['admin', 'operator'].includes(user.role)) return true;

  try {
    switch (targetType) {
      case 'product': {
        const product = await prisma.product.findUnique({
          where: { id: targetId },
          select: { orgId: true },
        });
        return product?.orgId === user.orgId;
      }
      case 'demand': {
        const demand = await prisma.demand.findUnique({
          where: { id: targetId },
          select: { ownerUserId: true },
        });
        return demand?.ownerUserId === user.id;
      }
      case 'proposal': {
        const proposal = await prisma.proposal.findUnique({
          where: { id: targetId },
          select: { supplierOrgId: true },
        });
        return proposal?.supplierOrgId === user.orgId;
      }
      case 'poc': {
        const participant = await prisma.pocParticipant.findFirst({
          where: { pocProjectId: targetId, userId: user.id },
        });
        return !!participant;
      }
      default:
        return false;
    }
  } catch {
    return false;
  }
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const { id } = await params;

    // Look up the attachment to verify resource access
    const attachment = await prisma.attachment.findUnique({
      where: { id },
    });

    if (!attachment) {
      return NextResponse.json(
        { error: '文件不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    // Verify the user has access to the target resource
    if (attachment.targetType && attachment.targetId) {
      const allowed = await canAccessResource(
        auth.user,
        attachment.targetType,
        attachment.targetId,
      );
      if (!allowed) {
        return NextResponse.json(
          { error: '无权访问该文件' },
          { status: 403, headers: corsHeaders() },
        );
      }
    }

    const result = await getFileStream(id);

    if (!result) {
      return NextResponse.json(
        { error: '文件不存在' },
        { status: 404, headers: corsHeaders() },
      );
    }

    // Convert Node.js Readable to Web ReadableStream
    const webStream = Readable.toWeb(result.stream as unknown as import('stream').Readable) as ReadableStream;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Disposition': `inline; filename="${encodeURIComponent(result.filename)}"`,
        ...corsHeaders(),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}
