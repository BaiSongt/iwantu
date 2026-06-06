import { NextResponse } from 'next/server';
import prisma from '@/lib/db/client';

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: 'ok', database: 'connected', timestamp: new Date().toISOString() });
  } catch (error) {
    return NextResponse.json({ status: 'error', database: 'disconnected', error: String(error) }, { status: 503 });
  }
}
