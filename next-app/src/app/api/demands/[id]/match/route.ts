import { PRODUCTS, COMPANIES, SOLUTIONS } from '@/lib/constants';
import type { MatchResult } from '@/types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const matchResult: MatchResult = {
    demandId: id,
    products: PRODUCTS.slice(0, 3).map((p) => ({
      product: p,
      score: 0.9 - PRODUCTS.indexOf(p) * 0.05,
      reason: `${p.name} matches the demand requirements`,
    })),
    agents: [],
    companies: COMPANIES.slice(0, 2).map((c) => ({
      company: c,
      score: 0.85 - COMPANIES.indexOf(c) * 0.05,
      reason: `${c.name} has relevant capabilities`,
    })),
    solutions: SOLUTIONS.slice(0, 2).map((s) => ({
      solution: s,
      score: 0.88 - SOLUTIONS.indexOf(s) * 0.05,
      reason: `${s.title} addresses the demand scenario`,
    })),
    riskWarnings: [
      'Please verify supplier certifications independently',
      'Budget range should be confirmed with detailed scope',
    ],
    nextSteps: [
      'Review matched products and shortlist',
      'Contact shortlisted suppliers for detailed proposals',
      'Schedule POC if applicable',
    ],
  };

  return Response.json(
    { data: matchResult },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
