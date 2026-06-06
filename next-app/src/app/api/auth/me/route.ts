import { NextResponse } from 'next/server';
import { verifyToken } from '@/lib/auth';

const SESSION_COOKIE = 'iwantu_session';

export async function GET(request: Request) {
  try {
    const cookieHeader = request.headers.get('cookie') || '';
    const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
    const token = match?.[1];

    if (!token) {
      return NextResponse.json({ data: null });
    }

    const payload = await verifyToken(token);
    if (!payload) {
      return NextResponse.json({ data: null });
    }

    return NextResponse.json({
      data: {
        id: payload.userId as string,
        name: (payload.name as string) || (payload.email as string)?.split('@')[0] || 'User',
        email: payload.email as string,
        role: payload.role as string,
        orgId: (payload.orgId as string) || undefined,
      },
    });
  } catch {
    return NextResponse.json({ data: null });
  }
}
