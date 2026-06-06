import type { MessageThread } from '@/types';

const threads: MessageThread[] = [
  {
    id: 't1',
    title: '知识库问答系统需求沟通',
    type: 'demand',
    relatedId: 'd1',
    participants: ['mock-user', 'supplier-c2'],
    lastMessage: '我们已经确认了技术方案，请查看附件',
    lastMessageAt: '2025-06-05T14:30:00Z',
    unreadCount: 2,
  },
  {
    id: 't2',
    title: '代码审查Agent POC讨论',
    type: 'poc',
    relatedId: 'd4',
    participants: ['mock-user', 'supplier-c3'],
    lastMessage: 'POC测试环境已准备就绪',
    lastMessageAt: '2025-06-04T10:00:00Z',
    unreadCount: 0,
  },
];

export async function GET() {
  return Response.json(
    { data: threads },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}

export async function POST(request: Request) {
  const body = await request.json();

  const newThread: MessageThread = {
    id: `t${Date.now()}`,
    title: body.title ?? '',
    type: body.type ?? 'general',
    relatedId: body.relatedId,
    participants: body.participants ?? ['mock-user'],
    lastMessage: '',
    lastMessageAt: new Date().toISOString(),
    unreadCount: 0,
  };

  return Response.json(
    { data: newThread },
    { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
