/**
 * Next.js Proxy (middleware) — Route Protection via JWT Cookie Verification
 *
 * Runs in the Edge Runtime to protect specific routes (dashboard, publish,
 * messages, etc.) by verifying the `iwantu_session` JWT cookie.
 *
 * Uses the `jose` library directly — NOT `@/lib/auth`, which imports
 * Prisma / bcryptjs and cannot run in the Edge Runtime.
 *
 * On successful verification the proxy attaches `x-user-id` and
 * `x-user-role` headers so downstream handlers can read them without
 * re-verifying the token.
 */

import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

// ---------------------------------------------------------------------------
// JWT configuration (must match src/lib/auth.ts)
// ---------------------------------------------------------------------------

const SESSION_COOKIE = 'iwantu_session';

// Lazy-load to avoid build-time crash — error thrown at runtime if missing
let _encodedKey: Uint8Array | null = null;
function getEncodedKey(): Uint8Array {
  if (!_encodedKey) {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET environment variable is required');
    _encodedKey = new TextEncoder().encode(secret);
  }
  return _encodedKey;
}

// ---------------------------------------------------------------------------
// Security headers applied to every response
// ---------------------------------------------------------------------------

const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-XSS-Protection': '1; mode=block',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

// ---------------------------------------------------------------------------
// Helper: verify the JWT and return its payload, or null on failure
// ---------------------------------------------------------------------------

interface MiddlewareTokenPayload {
  userId?: string;
  email?: string;
  name?: string;
  role?: string;
  orgId?: string;
}

/**
 * Lightweight JWT verification for the Edge Runtime.
 * Returns the decoded payload or `null` when the token is missing / invalid.
 */
async function verifySessionToken(
  token: string,
): Promise<MiddlewareTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getEncodedKey(), {
      algorithms: ['HS256'],
    });
    return payload as unknown as MiddlewareTokenPayload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Middleware entry point
// ---------------------------------------------------------------------------

export async function proxy(request: NextRequest) {
  // Extract session cookie
  const token = request.cookies.get(SESSION_COOKIE)?.value;

  if (!token) {
    return redirectToLogin(request);
  }

  // Verify JWT
  const payload = await verifySessionToken(token);

  if (!payload || !payload.userId) {
    return redirectToLogin(request);
  }

  // Token is valid — attach user info as request headers for downstream use
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-user-id', payload.userId);
  if (payload.role) {
    requestHeaders.set('x-user-role', payload.role);
  }

  const response = NextResponse.next({
    request: {
      headers: requestHeaders,
    },
  });

  // Apply security headers to every response
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  return response;
}

// ---------------------------------------------------------------------------
// Redirect helper
// ---------------------------------------------------------------------------

/**
 * Redirect the user to the login page with the current URL encoded as the
 * `callbackUrl` query parameter so the login flow can return them here.
 */
function redirectToLogin(request: NextRequest): NextResponse {
  const loginUrl = new URL('/auth/login', request.url);
  loginUrl.searchParams.set('callbackUrl', request.nextUrl.pathname);
  return NextResponse.redirect(loginUrl);
}

// ---------------------------------------------------------------------------
// Route matcher — only the routes listed below will invoke the proxy;
// everything else (home, auth, public browse pages, APIs, etc.) is skipped.
// ---------------------------------------------------------------------------

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/demands/publish',
    '/products/publish',
    '/supplier/:path*',
    '/messages/:path*',
  ],
};
