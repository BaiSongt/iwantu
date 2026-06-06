import { getSolutionById } from '@/lib/db/solutions';
import { solutionToMarkdown } from '@/lib/markdown';
import { handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const solution = await getSolutionById(id);

    if (!solution) {
      return new Response('解决方案不存在', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain',
          ...corsHeaders(),
        },
      });
    }

    const markdown = solutionToMarkdown(solution);

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
