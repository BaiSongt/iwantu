/**
 * Local Filesystem Storage Abstraction
 *
 * Handles file uploads with validation, disk persistence, and Attachment
 * record creation via Prisma. Designed for local development / single-server
 * deployments; swap implementations for S3 / OSS in production.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import prisma from '@/lib/db/client';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const UPLOAD_DIR = process.env.UPLOAD_DIR || './uploads';
const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50 MB

const ALLOWED_MIME_TYPES: Set<string> = new Set([
  'text/csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // xlsx
  'application/vnd.ms-excel', // xls
  'application/json',
  'application/zip',
  'application/x-zip-compressed',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

// Map mime types to simple extensions for friendlier filenames
const MIME_TO_EXT: Record<string, string> = {
  'text/csv': 'csv',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel': 'xls',
  'application/json': 'json',
  'application/zip': 'zip',
  'application/x-zip-compressed': 'zip',
  'application/pdf': 'pdf',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Ensure the target directory exists. */
function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/** Validate that a mime type is in the allowed set. */
function isAllowedMimeType(mimeType: string): boolean {
  return ALLOWED_MIME_TYPES.has(mimeType);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Save an uploaded file to disk and record it in the Attachment table.
 *
 * @param file - The Web File object from the request
 * @param targetType - Attachment target type (e.g. "poc", "product", "proposal")
 * @param targetId - The ID of the target entity
 * @returns The created Attachment record
 * @throws Error on validation or IO failure
 */
export async function saveFile(
  file: File,
  targetType: string,
  targetId: string,
) {
  // Validate mime type
  const mimeType = file.type || 'application/octet-stream';
  if (!isAllowedMimeType(mimeType)) {
    throw new Error(`不支持的文件类型: ${mimeType}`);
  }

  // Validate file size
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`文件大小超过限制 (最大 ${MAX_FILE_SIZE / 1024 / 1024}MB)`);
  }

  // Generate unique filename
  const ext = MIME_TO_EXT[mimeType] || 'bin';
  const uniqueName = `${crypto.randomUUID()}.${ext}`;

  // Build target directory: UPLOAD_DIR/<targetType>/
  const subDir = path.join(UPLOAD_DIR, targetType);
  ensureDir(subDir);

  const filePath = path.join(subDir, uniqueName);
  const relativePath = path.join(targetType, uniqueName);

  // Write file to disk
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  fs.writeFileSync(filePath, buffer);

  // Record in Attachment table
  const attachment = await prisma.attachment.create({
    data: {
      targetType: targetType as never,
      targetId,
      fileName: file.name,
      fileSize: file.size,
      fileType: mimeType,
      url: relativePath,
    },
  });

  return attachment;
}

/**
 * Delete a file from disk and the Attachment record from the database.
 *
 * @param id - Attachment ID
 * @returns true if deleted, false if not found
 */
export async function deleteFile(id: string): Promise<boolean> {
  try {
    const attachment = await prisma.attachment.findUnique({ where: { id } });
    if (!attachment) return false;

    const filePath = path.join(UPLOAD_DIR, attachment.url);

    // Remove from disk (ignore if file is already gone)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    // Remove from database
    await prisma.attachment.delete({ where: { id } });

    return true;
  } catch (error) {
    console.error('[storage] deleteFile failed:', error);
    return false;
  }
}

/**
 * Get file stream and metadata for serving a file.
 *
 * @param id - Attachment ID
 * @returns Object with stream, mimeType, filename — or null if not found
 */
export async function getFileStream(
  id: string,
): Promise<{ stream: NodeJS.ReadableStream; mimeType: string; filename: string } | null> {
  try {
    const attachment = await prisma.attachment.findUnique({ where: { id } });
    if (!attachment) return null;

    const filePath = path.join(UPLOAD_DIR, attachment.url);
    if (!fs.existsSync(filePath)) return null;

    const stream = fs.createReadStream(filePath);

    return {
      stream,
      mimeType: attachment.fileType,
      filename: attachment.fileName,
    };
  } catch (error) {
    console.error('[storage] getFileStream failed:', error);
    return null;
  }
}
