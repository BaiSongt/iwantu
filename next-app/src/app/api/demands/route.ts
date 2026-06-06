import { getDemands, createDemand } from '@/lib/db/demands';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError } from '@/lib/api-utils';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const filters: Parameters<typeof getDemands>[0] = {};
    const industry = searchParams.get('industry');
    const status = searchParams.get('status');
    const search = searchParams.get('search');

    if (industry) filters.industry = industry;
    if (status) filters.status = status;
    if (search) filters.search = search;

    const demands = await getDemands(filters);
    return apiSuccess(demands);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();

    const demand = await createDemand({
      ownerUserId: auth.user.id,
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
    });

    if (!demand) {
      return Response.json({ error: '创建需求失败' }, { status: 500 });
    }

    return apiSuccess(demand, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
