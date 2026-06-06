import { COMPANIES } from '@/lib/constants';
import type { CompanyProfile } from '@/types';

export async function GET() {
  return Response.json(
    { data: COMPANIES satisfies CompanyProfile[] },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
