import type { MessageThread, Message } from '@/types';

const threadData: Record<string, { thread: MessageThread; messages: Message[] }> = {
  t1: {
    thread: {
      id: 't1',
      title: '知识库问答系统需求沟通',
      type: 'demand',
      relatedId: 'd1',
      participants: ['mock-user', 'supplier-c2'],
      lastMessage: '我们已经确认了技术方案，请查看附件',
      lastMessageAt: '2025-06-05T14:30:00Z',
      unreadCount: 2,
    },
    messages: [
      {
        id: 'm1',
        threadId: 't1',
        senderId: 'mock-user',
        senderName: '采购方用户',
        content: '您好，我们对贵公司的知识库产品很感兴趣，能否安排一次技术交流？',
        isAiGenerated: false,
        timestamp: '2025-06-03T09:00:00Z',
      },
      {
        id: 'm2',
        threadId: 't1',
        senderId: 'supplier-c2',
        senderName: '星河智能科技',
        content: '您好！感谢您的关注。我们可以安排本周五下午的技术交流会议，届时会有产品负责人参加。',
        isAiGenerated: false,
        timestamp: '2025-06-03T10:30:00Z',
      },
      {
        id: 'm3',
        threadId: 't1',
        senderId: 'mock-user',
        senderName: '采购方用户',
        content: '好的，那请先发一份详细的技术方案和报价单给我们参考。',
        isAiGenerated: false,
        timestamp: '2025-06-04T11:00:00Z',
      },
      {
        id: 'm4',
        threadId: 't1',
        senderId: 'supplier-c2',
        senderName: '星河智能科技',
        content: '我们已经确认了技术方案，请查看附件',
        isAiGenerated: false,
        timestamp: '2025-06-05T14:30:00Z',
      },
    ],
  },
  t2: {
    thread: {
      id: 't2',
      title: '代码审查Agent POC讨论',
      type: 'poc',
      relatedId: 'd4',
      participants: ['mock-user', 'supplier-c3'],
      lastMessage: 'POC测试环境已准备就绪',
      lastMessageAt: '2025-06-04T10:00:00Z',
      unreadCount: 0,
    },
    messages: [
      {
        id: 'm5',
        threadId: 't2',
        senderId: 'mock-user',
        senderName: '采购方用户',
        content: 'POC测试需要准备哪些数据和环境？',
        isAiGenerated: false,
        timestamp: '2025-06-03T15:00:00Z',
      },
      {
        id: 'm6',
        threadId: 't2',
        senderId: 'supplier-c3',
        senderName: '工识智能',
        content: 'POC测试环境已准备就绪',
        isAiGenerated: false,
        timestamp: '2025-06-04T10:00:00Z',
      },
    ],
  },
};

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const entry = threadData[id];

  if (!entry) {
    return Response.json(
      { error: 'Thread not found' },
      { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } },
    );
  }

  return Response.json(
    { data: { ...entry.thread, messages: entry.messages } },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
