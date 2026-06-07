/**
 * Download / Serve File API Route
 *
 * GET /api/upload/[id] — Stream a file from disk by its Attachment ID.
 * Requires authentication.
 */

import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth-helpers';
import { getFileStream } from '@/lib/storage';
import { handleApiError, corsHeaders } from '@/lib/api-utils';
import { Readable } from 'node:stream';

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
