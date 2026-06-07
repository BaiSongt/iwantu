/**
 * SSE Message Streaming Endpoint
 *
 * GET /api/messages/events — Server-Sent Events stream for real-time messages
 *   requireAuth
 *   Returns text/event-stream
 *   Polls for new messages every 3 seconds
 *   Sends: data: { type: "new_message", threadId, message }
 *   Keep-alive ping every 30 seconds
 */

import { requireAuth } from '@/lib/auth-helpers';
import prisma from '@/lib/db/client';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  // Authenticate the user
  const auth = await requireAuth(request);
  if ('error' in auth) return auth.error;

  const userId = auth.user.id;

  // Find all thread IDs where this user is a participant
  const participantLinks = await prisma.threadParticipant.findMany({
    where: { userId },
    select: { threadId: true },
  });
  const threadIds = participantLinks.map((p) => p.threadId);

  // Track the last poll timestamp so we only send new messages
  let lastPollTime = new Date();

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Helper to send SSE events
      function send(event: string, data: unknown) {
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
          );
        } catch {
          // Stream already closed
        }
      }

      // Send initial connection confirmation
      send('connected', { message: 'SSE connection established' });

      // Polling interval (3 seconds)
      const pollInterval = setInterval(async () => {
        try {
          if (threadIds.length === 0) return;

          const newMessages = await prisma.message.findMany({
            where: {
              threadId: { in: threadIds },
              timestamp: { gt: lastPollTime },
            },
            orderBy: { timestamp: 'asc' },
            include: {
              thread: {
                select: { id: true, title: true },
              },
            },
          });

          // Update last poll time after fetching
          lastPollTime = new Date();

          for (const msg of newMessages) {
            send('new_message', {
              threadId: msg.threadId,
              message: {
                id: msg.id,
                threadId: msg.threadId,
                senderId: msg.senderId,
                senderName: msg.senderName,
                content: msg.content,
                isAiGenerated: msg.isAiGenerated,
                timestamp: msg.timestamp.toISOString(),
              },
            });
          }
        } catch (error) {
          console.error('[SSE] Poll error:', error);
        }
      }, 3000);

      // Keep-alive ping every 30 seconds
      const keepAliveInterval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          // Stream already closed
        }
      }, 30_000);

      // Clean up on abort (connection close)
      request.signal.addEventListener('abort', () => {
        clearInterval(pollInterval);
        clearInterval(keepAliveInterval);
        try {
          controller.close();
        } catch {
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // Disable nginx buffering
    },
  });
}
