/**
 * Upload API Route
 *
 * POST /api/upload — Upload a file and create an Attachment record.
 * Requires authentication. Accepts multipart/form-data with:
 *   - file (File): The file to upload
 *   - targetType (string): e.g. "poc", "product", "proposal"
 *   - targetId (string): The ID of the target entity
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import prisma from '@/lib/db/client';
import { saveFile } from '@/lib/storage';
import { handleApiError, corsHeaders } from '@/lib/api-utils';
import { uploadSchema, formatZodErrors } from '@/lib/validations';
import { rateLimit, getClientIdentifier, UPLOAD_LIMIT } from '@/lib/rate-limit';

/**
 * Verify the user has permission to upload to the target resource.
 */
async function canUploadTo(
  user: { id: string; orgId?: string | null; role: string },
  targetType: string,
  targetId: string,
): Promise<boolean> {
  // Admin/operator can always upload
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

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function POST(request: Request) {
  try {
    // Rate limiting
    const clientIp = getClientIdentifier(request);
    const { allowed, retryAfter } = rateLimit(clientIp, UPLOAD_LIMIT);
    if (!allowed) {
      return NextResponse.json(
        { error: '上传请求过于频繁，请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(retryAfter), ...corsHeaders() } },
      );
    }

    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const targetType = formData.get('targetType') as string | null;
    const targetId = formData.get('targetId') as string | null;

    if (!file) {
      return NextResponse.json(
        { error: '请选择要上传的文件' },
        { status: 400, headers: corsHeaders() },
      );
    }

    // Validate targetType and targetId
    const parsed = uploadSchema.safeParse({ targetType, targetId });
    if (!parsed.success) {
      return NextResponse.json(
        { error: '输入验证失败', details: formatZodErrors(parsed.error) },
        { status: 400, headers: corsHeaders() },
      );
    }

    // Verify the user has permission to upload to this target resource
    const allowed = await canUploadTo(auth.user, targetType!, targetId!);
    if (!allowed) {
      return NextResponse.json(
        { error: '无权向该资源上传文件' },
        { status: 403, headers: corsHeaders() },
      );
    }

    const attachment = await saveFile(file, targetType!, targetId!);

    return NextResponse.json(
      {
        id: attachment.id,
        fileName: attachment.fileName,
        fileSize: attachment.fileSize,
        fileType: attachment.fileType,
        url: attachment.url,
        targetType: attachment.targetType,
        targetId: attachment.targetId,
        createdAt: attachment.createdAt.toISOString(),
      },
      { status: 201, headers: corsHeaders() },
    );
  } catch (error) {
    return handleApiError(error);
  }
}
