/**
 * Message Data Access Layer
 *
 * Operations for message threads and messages: listing, creating threads,
 * sending messages, and tracking unread counts.
 */

import prisma from './client';
import type { MessageThread, Message } from '@/types';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a Prisma MessageThread row (with participants and last message meta)
 * to the frontend MessageThread shape used in types/index.ts.
 */
function toThreadShape(
  row: Awaited<
    ReturnType<typeof prisma.messageThread.findFirst>
  > & {
    participants?: { userId: string }[];
    _count?: { messages: number };
  },
  userId?: string,
): MessageThread | null {
  if (!row) return null;

  // Derive unread count if we have a userId (placeholder: 0 for now;
  // a production system would track per-user read timestamps).
  const unreadCount = 0;

  return {
    id: row.id,
    title: row.title,
    type: row.type as MessageThread['type'],
    relatedId: row.relatedId ?? undefined,
    participants: row.participants?.map((p) => p.userId) ?? [],
    lastMessage: row.lastMessage,
    lastMessageAt: row.lastMessageAt.toISOString(),
    unreadCount,
  };
}

/**
 * Map a Prisma Message row to the frontend Message shape.
 */
function toMessageShape(
  row: Awaited<ReturnType<typeof prisma.message.findFirst>>,
): Message | null {
  if (!row) return null;
  return {
    id: row.id,
    threadId: row.threadId,
    senderId: row.senderId,
    senderName: row.senderName,
    content: row.content,
    isAiGenerated: row.isAiGenerated,
    timestamp: row.timestamp.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get all message threads a user participates in, ordered by most recent.
 *
 * @param userId - The user ID to look up threads for
 * @returns Array of MessageThread objects (empty array on error)
 */
export async function getThreads(userId: string): Promise<MessageThread[]> {
  try {
    // Find all thread IDs where this user is a participant
    const participantLinks = await prisma.threadParticipant.findMany({
      where: { userId },
      select: { threadId: true },
    });

    const threadIds = participantLinks.map((p) => p.threadId);
    if (threadIds.length === 0) return [];

    const rows = await prisma.messageThread.findMany({
      where: { id: { in: threadIds } },
      include: { participants: true },
      orderBy: { lastMessageAt: 'desc' },
    });

    return rows
      .map((row) => toThreadShape(row, userId))
      .filter((t): t is MessageThread => t !== null);
  } catch (error) {
    console.error('[DAL] getThreads failed:', error);
    return [];
  }
}

/**
 * Get a single thread by ID, including all its messages.
 *
 * @param id - Thread ID
 * @returns Object with thread metadata and messages array, or null on error
 */
export async function getThreadById(
  id: string,
): Promise<{ thread: MessageThread; messages: Message[] } | null> {
  try {
    const row = await prisma.messageThread.findUnique({
      where: { id },
      include: {
        participants: true,
        messages: {
          orderBy: { timestamp: 'asc' },
        },
      },
    });

    if (!row) return null;

    const thread = toThreadShape(row);
    if (!thread) return null;

    const messages = row.messages
      .map((m) => toMessageShape(m))
      .filter((m): m is Message => m !== null);

    return { thread, messages };
  } catch (error) {
    console.error('[DAL] getThreadById failed:', error);
    return null;
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a new message thread with the given participants.
 *
 * @param data.title - Thread title
 * @param data.type - Thread type (demand | poc | proposal | general)
 * @param data.relatedId - Optional related entity ID
 * @param data.participantIds - Array of user IDs to add as participants
 * @returns The created MessageThread or null on error
 */
export async function createThread(data: {
  title: string;
  type: 'demand' | 'poc' | 'proposal' | 'general';
  relatedId?: string;
  participantIds: string[];
}): Promise<MessageThread | null> {
  try {
    const row = await prisma.messageThread.create({
      data: {
        title: data.title,
        type: data.type,
        relatedId: data.relatedId,
        participants: {
          create: data.participantIds.map((userId) => ({ userId })),
        },
      },
      include: { participants: true },
    });

    return toThreadShape(row);
  } catch (error) {
    console.error('[DAL] createThread failed:', error);
    return null;
  }
}

/**
 * Send a message in an existing thread.
 *
 * Updates the thread's lastMessage and lastMessageAt fields atomically.
 *
 * @param threadId - Target thread ID
 * @param senderId - User ID of the sender
 * @param content - Message content text
 * @param isAiGenerated - Whether the message was generated by AI (default false)
 * @returns The created Message or null on error
 */
export async function sendMessage(
  threadId: string,
  senderId: string,
  content: string,
  isAiGenerated: boolean = false,
): Promise<Message | null> {
  try {
    // Look up sender name for denormalization
    const sender = await prisma.user.findUnique({
      where: { id: senderId },
      select: { name: true },
    });

    if (!sender) {
      console.error('[DAL] sendMessage: sender not found');
      return null;
    }

    // Create message and update thread metadata in a transaction
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: {
          threadId,
          senderId,
          senderName: sender.name,
          content,
          isAiGenerated,
        },
      }),
      prisma.messageThread.update({
        where: { id: threadId },
        data: {
          lastMessage: content.slice(0, 200),
          lastMessageAt: new Date(),
        },
      }),
    ]);

    return toMessageShape(message);
  } catch (error) {
    console.error('[DAL] sendMessage failed:', error);
    return null;
  }
}
