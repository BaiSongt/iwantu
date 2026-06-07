'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { Bell, FileText, CheckCircle, MessageSquare, AlertCircle, Info, Check } from 'lucide-react';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  content: string;
  read: boolean;
  link: string | null;
  createdAt: string;
}

interface NotificationData {
  items: NotificationItem[];
  unreadCount: number;
}

const typeIcons: Record<string, typeof Bell> = {
  proposal_received: FileText,
  proposal_accepted: CheckCircle,
  poc_status: AlertCircle,
  message: MessageSquare,
  system: Info,
};

function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;

  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return '刚刚';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时前`;

  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;

  const months = Math.floor(days / 30);
  return `${months}个月前`;
}

export default function NotificationBell() {
  const [data, setData] = useState<NotificationData | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch('/api/notifications?limit=10');
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // Silently fail
    }
  }, []);

  // Fetch on mount and poll every 30 seconds
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, 30_000);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleMarkAllRead() {
    try {
      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      await fetchNotifications();
    } catch {
      // Silently fail
    }
  }

  async function handleMarkSingleRead(id: string) {
    try {
      await fetch('/api/notifications', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      await fetchNotifications();
    } catch {
      // Silently fail
    }
  }

  const unreadCount = data?.unreadCount ?? 0;
  const items = data?.items ?? [];

  return (
    <div ref={dropdownRef} className="relative">
      {/* Bell button */}
      <button
        onClick={() => {
          setOpen(!open);
          if (!open) fetchNotifications();
        }}
        className="relative flex h-9 w-9 items-center justify-center rounded-lg text-muted transition-all duration-160 ease-out hover:bg-[#f1f5f9] hover:text-foreground"
        aria-label="通知"
      >
        <Bell className="h-[18px] w-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 sm:w-96 rounded-xl border border-line bg-white shadow-[0_8px_30px_rgba(15,23,42,0.12)] z-50 animate-[fade-up_0.15s_ease-out]">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <span className="text-sm font-semibold text-foreground">通知</span>
            {unreadCount > 0 && (
              <button
                onClick={handleMarkAllRead}
                className="text-xs text-primary hover:text-primary/80 font-medium transition-colors"
              >
                全部标记已读
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-[360px] overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8 text-sm text-muted">
                加载中...
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-sm text-muted">
                <Bell className="h-8 w-8 mb-2 text-gray-300" />
                暂无通知
              </div>
            ) : (
              items.map((n) => {
                const Icon = typeIcons[n.type] || Info;

                return n.link ? (
                  <Link
                    key={n.id}
                    href={n.link}
                    onClick={() => setOpen(false)}
                    className={`flex items-start gap-3 px-4 py-3 border-b border-line/50 transition-colors duration-100 hover:bg-gray-50 ${
                      !n.read ? 'bg-blue-50/40' : ''
                    }`}
                  >
                    {/* Icon */}
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      !n.read ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-400'
                    }`}>
                      <Icon className="h-4 w-4" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-sm leading-snug ${!n.read ? 'font-semibold text-foreground' : 'text-foreground/80'}`}>
                          {n.title}
                        </span>
                        {!n.read && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                      <p className="text-xs text-muted mt-0.5 line-clamp-2 leading-relaxed">
                        {n.content}
                      </p>
                      <span className="text-[11px] text-muted/70 mt-1 block">
                        {timeAgo(n.createdAt)}
                      </span>
                    </div>

                    {/* Mark read button for unread items */}
                    {!n.read && (
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          handleMarkSingleRead(n.id);
                        }}
                        className="mt-1 shrink-0 flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:text-primary hover:bg-primary/10 transition-colors"
                        title="标记已读"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </Link>
                ) : (
                  <div
                    key={n.id}
                    className={`flex items-start gap-3 px-4 py-3 border-b border-line/50 transition-colors duration-100 hover:bg-gray-50 ${
                      !n.read ? 'bg-blue-50/40' : ''
                    }`}
                  >
                    {/* Icon */}
                    <div className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${
                      n.read ? 'bg-gray-100 text-muted' : 'bg-primary/10 text-primary'
                    }`}>
                      <Icon className="h-4 w-4" />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className={`text-sm font-medium truncate ${n.read ? 'text-muted' : 'text-foreground'}`}>
                          {n.title}
                        </p>
                        {!n.read && (
                          <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />
                        )}
                      </div>
                      <p className="text-xs text-muted mt-0.5 line-clamp-2 leading-relaxed">
                        {n.content}
                      </p>
                      <span className="text-[11px] text-muted/70 mt-1 block">
                        {timeAgo(n.createdAt)}
                      </span>
                    </div>

                    {/* Mark read button for unread items */}
                    {!n.read && (
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleMarkSingleRead(n.id);
                        }}
                        className="mt-1 shrink-0 flex h-6 w-6 items-center justify-center rounded text-gray-300 hover:text-primary hover:bg-primary/10 transition-colors"
                        title="标记已读"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-line">
            <Link
              href="/dashboard/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center py-2.5 text-sm font-medium text-primary hover:bg-[#eff6ff] transition-colors rounded-b-xl"
            >
              查看全部
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
