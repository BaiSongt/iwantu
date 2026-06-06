import { COMPANIES } from '@/lib/constants';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const company = COMPANIES.find((c) => c.id === id);

  if (!company) {
    return Response.json(
      { error: 'Company not found' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  return Response.json(
    { data: company },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
