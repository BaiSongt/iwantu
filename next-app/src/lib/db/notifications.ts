/**
 * Notification Data Access Layer
 *
 * CRUD operations for user notifications: listing, counting unread,
 * marking as read, and creating new notifications.
 */

import prisma from './client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationData {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  read: boolean;
  link: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toNotificationShape(row: {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  read: boolean;
  link: string | null;
  createdAt: Date;
}): NotificationData {
  return {
    id: row.id,
    userId: row.userId,
    type: row.type,
    title: row.title,
    content: row.content,
    read: row.read,
    link: row.link,
    createdAt: row.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Get notifications for a user with optional filters.
 */
export async function getNotifications(
  userId: string,
  filters?: { read?: boolean; type?: string },
): Promise<NotificationData[]> {
  try {
    const where: Record<string, unknown> = { userId };

    if (filters?.read !== undefined) {
      where.read = filters.read;
    }
    if (filters?.type) {
      where.type = filters.type;
    }

    const rows = await prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });

    return rows.map(toNotificationShape);
  } catch (error) {
    console.error('[DAL] getNotifications failed:', error);
    return [];
  }
}

/**
 * Count unread notifications for a user.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  try {
    return await prisma.notification.count({
      where: { userId, read: false },
    });
  } catch (error) {
    console.error('[DAL] getUnreadCount failed:', error);
    return 0;
  }
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Mark a single notification as read.
 */
export async function markAsRead(id: string): Promise<boolean> {
  try {
    await prisma.notification.update({
      where: { id },
      data: { read: true },
    });
    return true;
  } catch (error) {
    console.error('[DAL] markAsRead failed:', error);
    return false;
  }
}

/**
 * Mark all notifications as read for a user.
 */
export async function markAllAsRead(userId: string): Promise<boolean> {
  try {
    await prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
    return true;
  } catch (error) {
    console.error('[DAL] markAllAsRead failed:', error);
    return false;
  }
}

/**
 * Create a new notification.
 */
export async function createNotification(data: {
  userId: string;
  type: string;
  title: string;
  content: string;
  link?: string;
}): Promise<NotificationData | null> {
  try {
    const row = await prisma.notification.create({
      data: {
        userId: data.userId,
        type: data.type,
        title: data.title,
        content: data.content,
        link: data.link ?? null,
      },
    });
    return toNotificationShape(row);
  } catch (error) {
    console.error('[DAL] createNotification failed:', error);
    return null;
  }
}
