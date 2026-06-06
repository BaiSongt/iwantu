import { DEMANDS } from '@/lib/constants';
import type { Demand } from '@/types';

export async function GET() {
  // "My demands" — for now return all demands (mock auth)
  return Response.json(
    { data: DEMANDS satisfies Demand[] },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}

export async function POST(request: Request) {
  const body = await request.json();

  const newDemand: Demand = {
    id: `d${Date.now()}`,
    title: body.title ?? '',
    industry: body.industry ?? '',
    budgetRange: body.budgetRange ?? '',
    budgetMin: body.budgetMin,
    budgetMax: body.budgetMax,
    deliveryPeriod: body.deliveryPeriod ?? '',
    dataTypes: body.dataTypes ?? [],
    deploymentRequirement: body.deploymentRequirement ?? '',
    description: body.description ?? '',
    painPoints: body.painPoints ?? '',
    existingSystems: body.existingSystems ?? '',
    supportPoc: body.supportPoc ?? false,
    allowAiSupplier: body.allowAiSupplier ?? true,
    matchScore: '0%',
    matchScoreNum: 0,
    status: 'draft',
    ownerUser: 'mock-user',
    ownerOrg: 'mock-org',
    createdAt: new Date().toISOString().slice(0, 10),
  };

  return Response.json(
    { data: newDemand },
    { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
