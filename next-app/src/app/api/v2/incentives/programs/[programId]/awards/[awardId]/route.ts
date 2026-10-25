import { readIncentiveAward } from '@/lib/incentives/http-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, context: { params: Promise<{ programId: string; awardId: string }> }) {
  const { programId, awardId } = await context.params;
  return readIncentiveAward(request, programId, awardId);
}
