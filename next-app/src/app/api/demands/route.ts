import { getDemands, createDemand } from '@/lib/db/demands';
import { requireAuth } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError } from '@/lib/api-utils';
import { createDemandSchema, formatZodErrors } from '@/lib/validations';
import { rateLimit, getClientIdentifier, GENERAL_LIMIT } from '@/lib/rate-limit';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);

    const filters: Parameters<typeof getDemands>[0] = {};
    const industry = searchParams.get('industry');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const userId = searchParams.get('userId');
    const supportPoc = searchParams.get('supportPoc');
    const budgetMin = searchParams.get('budgetMin');
    const budgetMax = searchParams.get('budgetMax');

    if (industry) filters.industry = industry;
    if (status) filters.status = status;
    if (search) filters.search = search;
    if (userId) filters.ownerUserId = userId;
    if (supportPoc) filters.supportPoc = supportPoc;
    if (budgetMin) filters.budgetMin = parseFloat(budgetMin);
    if (budgetMax) filters.budgetMax = parseFloat(budgetMax);

    const demands = await getDemands(filters);
    return apiSuccess(demands);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    // Rate limiting
    const clientIp = getClientIdentifier(request);
    const { allowed, retryAfter } = rateLimit(clientIp, GENERAL_LIMIT);
    if (!allowed) {
      return Response.json(
        { error: '请求过于频繁，请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(retryAfter) } },
      );
    }

    const auth = await requireAuth(request);
    if ('error' in auth) return auth.error;

    const body = await request.json();

    // Input validation
    const parsed = createDemandSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: '输入验证失败', details: formatZodErrors(parsed.error) },
        { status: 400 },
      );
    }

    const validated = parsed.data;

    const demand = await createDemand({
      ownerUserId: auth.user.id,
      title: validated.title,
      industry: validated.industry,
      budgetRange: validated.budgetRange,
      budgetMin: validated.budgetMin,
      budgetMax: validated.budgetMax,
      deliveryPeriod: validated.deliveryPeriod,
      dataTypes: validated.dataTypes,
      deploymentRequirement: validated.deploymentRequirement,
      description: validated.description,
      painPoints: validated.painPoints,
      existingSystems: validated.existingSystems,
      supportPoc: validated.supportPoc,
      allowAiSupplier: validated.allowAiSupplier,
      allowAiAutoBid: validated.allowAiAutoBid,
    });

    if (!demand) {
      return Response.json({ error: '创建需求失败' }, { status: 500 });
    }

    return apiSuccess(demand, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
