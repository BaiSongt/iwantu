import { PRODUCTS } from '@/lib/constants';
import type { Product } from '@/types';

export async function GET() {
  // "My products" — for now return all published products (mock auth)
  const myProducts = PRODUCTS.filter((p) => p.status === 'published');
  return Response.json(
    { data: myProducts satisfies Product[] },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}

export async function POST(request: Request) {
  const body = await request.json();

  const newProduct: Product = {
    id: `p${Date.now()}`,
    name: body.name ?? '',
    company: body.company ?? 'Mock Supplier',
    companyLogo: body.companyLogo,
    summary: body.summary ?? '',
    description: body.description ?? '',
    coverImage: body.coverImage,
    gallery: body.gallery,
    category: body.category ?? '',
    industryTags: body.industryTags ?? [],
    capabilityTags: body.capabilityTags ?? [],
    deploymentModes: body.deploymentModes ?? ['saas'],
    pricingModel: body.pricingModel ?? 'custom',
    price: body.price ?? '',
    supportPoc: body.supportPoc ?? false,
    supportPrivateDeployment: body.supportPrivateDeployment ?? false,
    score: '0分',
    rating: 0,
    caseCount: 0,
    pocCount: 0,
    status: 'draft',
    accent: body.accent ?? 'blue',
    shot: body.shot ?? '',
    tags: body.tags ?? [],
    deploy: body.deploy ?? 'SaaS',
    createdAt: new Date().toISOString().slice(0, 10),
  };

  return Response.json(
    { data: newProduct },
    { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
