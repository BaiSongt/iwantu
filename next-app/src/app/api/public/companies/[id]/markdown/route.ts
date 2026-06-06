import { getCompanyById } from '@/lib/db/companies';
import { companyToMarkdown } from '@/lib/markdown';
import { handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const company = await getCompanyById(id);

    if (!company) {
      return new Response('公司不存在', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain',
          ...corsHeaders(),
        },
      });
    }

    const markdown = companyToMarkdown(company);

    return new Response(markdown, {
      headers: {
        'Content-Type': 'text/markdown; charset=utf-8',
        ...corsHeaders(),
      },
    });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}
