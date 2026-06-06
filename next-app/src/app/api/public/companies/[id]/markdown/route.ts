import { COMPANIES } from '@/lib/constants';
import { companyToMarkdown } from '@/lib/markdown';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const company = COMPANIES.find((c) => c.id === id);

  if (!company) {
    return new Response('Company not found', {
      status: 404,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  const markdown = companyToMarkdown(company);

  return new Response(markdown, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
