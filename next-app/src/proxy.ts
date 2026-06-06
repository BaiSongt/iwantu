import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const secretKey = process.env.JWT_SECRET || 'iwantu-platform-jwt-secret-change-in-production-2024';
const encodedKey = new TextEncoder().encode(secretKey);

const protectedRoutes = [
  '/dashboard',
  '/demands/publish',
  '/products/publish',
  '/messages',
  '/quote',
];

const publicRoutes = [
  '/',
  '/products',
  '/agents',
  '/companies',
  '/demands',
  '/solutions',
  '/featured',
  '/match',
  '/poc',
];

function isProtected(pathname: string): boolean {
  return protectedRoutes.some((route) => pathname === route || pathname.startsWith(route + '/'));
}

function isPublic(pathname: string): boolean {
  return (
    publicRoutes.some((route) => pathname === route || pathname.startsWith(route + '/')) ||
    pathname.startsWith('/auth') ||
    pathname.startsWith('/api')
  );
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Skip middleware for static files, _next, etc.
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/api') ||
    pathname.includes('.') // static files
  ) {
    return NextResponse.next();
  }

  // Read session cookie
  const token = req.cookies.get('iwantu_session')?.value;

  let userId: string | null = null;
  let userRole: string | null = null;

  if (token) {
    try {
      const { payload } = await jwtVerify(token, encodedKey, {
        algorithms: ['HS256'],
      });
      userId = (payload.userId as string) || null;
      userRole = (payload.role as string) || null;
    } catch {
      // Token invalid or expired
    }
  }

  // Redirect unauthenticated users on protected routes to login
  if (isProtected(pathname) && !userId) {
    const loginUrl = new URL('/auth/login', req.nextUrl);
    loginUrl.searchParams.set('callbackUrl', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Set user info headers for downstream consumption
  const response = NextResponse.next();
  if (userId) {
    response.headers.set('x-user-id', userId);
    response.headers.set('x-user-role', userRole || '');
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
