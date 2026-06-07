import { NextResponse } from 'next/server';
import { getProducts, createProduct } from '@/lib/db/products';
import { requireRole } from '@/lib/auth-helpers';
import { apiSuccess, handleApiError, corsHeaders } from '@/lib/api-utils';
import { createProductSchema, formatZodErrors } from '@/lib/validations';
import { rateLimit, getClientIdentifier, GENERAL_LIMIT } from '@/lib/rate-limit';

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request: Request) {
  try {
    const auth = await requireRole(request, ['supplier']);
    if ('error' in auth) return auth.error;

    const products = await getProducts({ orgId: auth.user.orgId ?? undefined });

    return apiSuccess(products);
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
      return NextResponse.json(
        { error: '请求过于频繁，请稍后再试' },
        { status: 429, headers: { 'Retry-After': String(retryAfter), ...corsHeaders() } },
      );
    }

    const auth = await requireRole(request, ['supplier']);
    if ('error' in auth) return auth.error;

    if (!auth.user.orgId) {
      return NextResponse.json(
        { error: '请先创建或加入组织' },
        { status: 403 },
      );
    }

    const body = await request.json();

    // Input validation
    const parsed = createProductSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: '输入验证失败', details: formatZodErrors(parsed.error) },
        { status: 400, headers: corsHeaders() },
      );
    }

    const validated = parsed.data;

    const product = await createProduct({
      orgId: auth.user.orgId,
      name: validated.name,
      summary: validated.summary,
      description: validated.description,
      coverImage: validated.coverImage || undefined,
      category: validated.category,
      industryTags: validated.industryTags,
      capabilityTags: validated.capabilityTags,
      deploymentModes: validated.deploymentModes,
      pricingModel: validated.pricingModel,
      price: validated.price,
      supportPoc: validated.supportPoc,
      supportPrivateDeployment: validated.supportPrivateDeployment,
      accent: validated.accent,
      shot: validated.shot,
      tags: validated.tags,
    });

    if (!product) {
      return NextResponse.json(
        { error: '创建产品失败' },
        { status: 500, headers: corsHeaders() },
      );
    }

    return apiSuccess(product, 201);
  } catch (error) {
    return handleApiError(error);
  }
}
