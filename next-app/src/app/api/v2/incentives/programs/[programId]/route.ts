import { readIncentiveProgram } from '@/lib/incentives/http-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ programId: string }> }) {
  const { programId } = await context.params;
  return readIncentiveProgram(request, programId);
}
