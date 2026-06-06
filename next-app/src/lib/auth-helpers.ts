/**
 * API Route Authentication Helpers
 *
 * Provides requireAuth() and requireRole() for use in Next.js API route handlers.
 * Extracts user from the session cookie and validates against the database.
 */

import { verifyToken } from '@/lib/auth';
import prisma from '@/lib/db/client';
import type { UserRole } from '@/types';

const SESSION_COOKIE = 'iwantu_session';

/**
 * Get the current user from a Request object (API route handler).
 * Returns the user object without passwordHash, or null if not authenticated.
 */
export async function getUserFromRequest(request: Request) {
  const cookieHeader = request.headers.get('cookie') || '';
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;

  const payload = await verifyToken(match[1]);
  if (!payload?.userId) return null;

  const user = await prisma.user.findUnique({
    where: { id: payload.userId as string },
  });
  if (!user) return null;

  // Return user without passwordHash
  const { passwordHash: _ph, ...safeUser } = user;
  return safeUser;
}

/**
 * Require authentication for an API route.
 * Returns { user } on success, or { error: Response } on failure (401).
 */
export async function requireAuth(request: Request) {
  const user = await getUserFromRequest(request);
  if (!user) {
    return {
      error: Response.json({ error: '未登录' }, { status: 401 }),
    };
  }
  return { user };
}

/**
 * Require a specific role for an API route.
 * Returns { user } on success, or { error: Response } on failure (401 or 403).
 */
export async function requireRole(request: Request, roles: UserRole[]) {
  const auth = await requireAuth(request);
  if ('error' in auth) return auth;

  if (!roles.includes(auth.user.role as UserRole)) {
    return {
      error: Response.json({ error: '无权限' }, { status: 403 }),
    };
  }
  return auth;
}
