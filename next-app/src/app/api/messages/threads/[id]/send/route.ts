import type { Message } from '@/types';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json();

  const newMessage: Message = {
    id: `m${Date.now()}`,
    threadId: id,
    senderId: 'mock-user',
    senderName: '采购方用户',
    content: body.content ?? '',
    isAiGenerated: body.isAiGenerated ?? false,
    timestamp: new Date().toISOString(),
  };

  return Response.json(
    { data: newMessage },
    { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
