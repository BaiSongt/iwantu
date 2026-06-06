import { DEMANDS } from '@/lib/constants';

export async function GET(
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

  return Response.json(
    { data: demand },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}

export async function PUT(
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

  const body = await request.json();
  const updated = { ...demand, ...body, id: demand.id };

  return Response.json(
    { data: updated },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
