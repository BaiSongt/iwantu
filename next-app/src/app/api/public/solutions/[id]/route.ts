import { SOLUTIONS } from '@/lib/constants';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const solution = SOLUTIONS.find((s) => s.id === id);

  if (!solution) {
    return Response.json(
      { error: 'Solution not found' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  return Response.json(
    { data: solution },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
