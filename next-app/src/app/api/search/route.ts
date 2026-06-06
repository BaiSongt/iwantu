import { PRODUCTS, COMPANIES, SOLUTIONS } from '@/lib/constants';
import type { NextRequest } from 'next/server';

export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get('q') ?? '').toLowerCase().trim();

  if (!q) {
    return Response.json(
      { data: { products: [], companies: [], solutions: [] } },
      { headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  const match = (text: string) => text.toLowerCase().includes(q);

  const products = PRODUCTS.filter(
    (p) =>
      match(p.name) ||
      match(p.summary) ||
      p.tags.some(match),
  );

  const companies = COMPANIES.filter(
    (c) =>
      match(c.name) ||
      match(c.slogan) ||
      c.tags.some(match),
  );

  const solutions = SOLUTIONS.filter(
    (s) =>
      match(s.title) ||
      match(s.summary) ||
      s.industry.some(match),
  );

  return Response.json(
    { data: { products, companies, solutions } },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
