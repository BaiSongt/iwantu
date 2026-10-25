import { readIncentiveObservation } from '@/lib/incentives/http-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  return readIncentiveObservation(request, programId);
}
