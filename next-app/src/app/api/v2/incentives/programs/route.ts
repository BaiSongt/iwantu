import { executeIncentiveCommand } from '@/lib/incentives/http-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  return executeIncentiveCommand(request, 'register');
}
