import { DEMANDS } from '@/lib/constants';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const demand = DEMANDS.find((d) => d.id === id);

  if (!demand) {
    return Response.json(
      { error: 'Demand not found' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  const published = { ...demand, status: 'collecting_proposals' as const };

  return Response.json(
    { data: published },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
