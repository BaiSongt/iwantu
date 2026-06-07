/**
 * API Key Management — List & Create
 *
 * GET  /api/api-keys  — List current user's API keys (masked)
 * POST /api/api-keys  — Create a new API key
 */

import { randomBytes } from 'crypto';
import { requireAuth } from '@/lib/auth-helpers';
import prisma from '@/lib/db/client';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';

// ---------------------------------------------------------------------------
// GET — List user's API keys (masked)
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const keys = await prisma.apiKey.findMany({
      where: { userId: auth.user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        name: true,
        key: true,
        scopes: true,
        expiresAt: true,
        lastUsedAt: true,
        createdAt: true,
      },
    });

    // Mask keys — show only last 4 characters
    const masked = keys.map((k) => ({
      id: k.id,
      name: k.name,
      keyMasked: '••••••••••••' + k.key.slice(-4),
      keySuffix: k.key.slice(-4),
      scopes: k.scopes,
      expiresAt: k.expiresAt?.toISOString() ?? null,
      lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
      createdAt: k.createdAt.toISOString(),
    }));

    return apiSuccess(masked);
  } catch (error) {
    return handleApiError(error);
  }
}

// ---------------------------------------------------------------------------
// POST — Create a new API key
// ---------------------------------------------------------------------------

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();
    const { name, scopes, expiresAt } = body as {
      name?: string;
      scopes?: string[];
      expiresAt?: string;
    };

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return apiSuccess({ error: '请输入密钥名称' }, 400);
    }

    if (!scopes || !Array.isArray(scopes) || scopes.length === 0) {
      return apiSuccess({ error: '请至少选择一个权限范围' }, 400);
    }

    // Generate API key
    const rawKey = `iwantu_${randomBytes(32).toString('hex')}`;

    const apiKey = await prisma.apiKey.create({
      data: {
        key: rawKey,
        name: name.trim(),
        userId: auth.user.id,
        scopes,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });

    // Return the full key — this is the ONLY time it will be shown
    return apiSuccess(
      {
        id: apiKey.id,
        name: apiKey.name,
        key: rawKey,
        scopes: apiKey.scopes,
        expiresAt: apiKey.expiresAt?.toISOString() ?? null,
        createdAt: apiKey.createdAt.toISOString(),
      },
      201,
    );
  } catch (error) {
    return handleApiError(error);
  }
}

// ---------------------------------------------------------------------------
// OPTIONS — CORS preflight
// ---------------------------------------------------------------------------

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
