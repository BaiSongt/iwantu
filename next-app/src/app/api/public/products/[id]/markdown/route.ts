import { getProductById } from '@/lib/db/products';
import { productToMarkdown } from '@/lib/markdown';
import { handleApiError, corsHeaders } from '@/lib/api-utils';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const product = await getProductById(id);

    if (!product) {
      return new Response('产品不存在', {
        status: 404,
        headers: {
          'Content-Type': 'text/plain',
          ...corsHeaders(),
        },
      });
    }

    const markdown = productToMarkdown(product);

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
