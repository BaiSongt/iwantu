'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  MessageSquare,
  ShoppingCart,
  FlaskConical,
  FileText,
  Send,
  Loader2,
  Inbox,
  MessageCircle,
} from 'lucide-react';
import type { MessageThread, Message } from '@/types';

/* ------------------------------------------------------------------ */
/*  Thread type icon                                                   */
/* ------------------------------------------------------------------ */

const THREAD_TYPE_ICONS: Record<
  MessageThread['type'],
  { icon: React.ElementType; bg: string; text: string }
> = {
  demand: { icon: ShoppingCart, bg: 'bg-blue-50', text: 'text-blue-600' },
  poc: { icon: FlaskConical, bg: 'bg-purple-50', text: 'text-purple-600' },
  proposal: { icon: FileText, bg: 'bg-amber-50', text: 'text-amber-600' },
  general: {
    icon: MessageSquare,
    bg: 'bg-gray-50',
    text: 'text-gray-600',
  },
};

/* ------------------------------------------------------------------ */
/*  Thread list item                                                   */
/* ------------------------------------------------------------------ */

function ThreadItem({
  thread,
  isActive,
  onClick,
}: {
  thread: MessageThread;
  isActive: boolean;
  onClick: () => void;
}) {
  const cfg = THREAD_TYPE_ICONS[thread.type] ?? THREAD_TYPE_ICONS.general;
  const Icon = cfg.icon;

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    return `${days} 天前`;
  };

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors border-l-2 ${
        isActive
          ? 'bg-primary/5 border-l-primary'
          : 'border-l-transparent hover:bg-gray-50'
      }`}
    >
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${cfg.bg}`}
      >
        <Icon className={`h-4 w-4 ${cfg.text}`} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-foreground truncate">
            {thread.title}
          </p>
          {thread.unreadCount > 0 && (
            <span className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
              {thread.unreadCount}
            </span>
          )}
        </div>
        <div className="flex items-center justify-between mt-0.5">
          <p className="text-xs text-muted truncate flex-1">
            {thread.lastMessage}
          </p>
          <span className="ml-2 shrink-0 text-[10px] text-muted/60">
            {timeAgo(thread.lastMessageAt)}
          </span>
        </div>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/*  Message bubble                                                     */
/* ------------------------------------------------------------------ */

function MessageBubble({
  message,
  currentUserId,
}: {
  message: Message;
  currentUserId: string;
}) {
  const isSelf = message.senderId === currentUserId;

  return (
    <div className={`flex ${isSelf ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
          isSelf
            ? 'bg-primary text-white rounded-br-sm'
            : 'bg-gray-100 text-foreground rounded-bl-sm'
        }`}
      >
        {!isSelf && (
          <p className="mb-1 text-xs font-semibold text-primary">
            {message.senderName}
          </p>
        )}
        {message.content}
        {message.isAiGenerated && (
          <span className="ml-2 inline-flex items-center rounded bg-white/20 px-1 py-0.5 text-[10px]">
            AI
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

function ThreadSkeleton() {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="h-9 w-9 shrink-0 rounded-full bg-gray-100 animate-pulse" />
      <div className="flex-1">
        <div className="h-4 w-3/4 rounded bg-gray-100 animate-pulse" />
        <div className="mt-1.5 h-3 w-1/2 rounded bg-gray-50 animate-pulse" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function MessagesPage() {
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadInfo, setThreadInfo] = useState<MessageThread | null>(null);
  const [loadingThreads, setLoadingThreads] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [sending, setSending] = useState(false);
  const [composeText, setComposeText] = useState('');
  const [userId, setUserId] = useState<string>('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Fetch current user ID
  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const json = await res.json();
          setUserId(json.user?.id ?? '');
        }
      } catch {
        // ignore
      }
    }
    fetchUser();
  }, []);

  // Fetch threads
  const fetchThreads = useCallback(async () => {
    try {
      const res = await fetch('/api/messages/threads');
      if (res.ok) {
        const json = await res.json();
        setThreads(Array.isArray(json) ? json : json.data ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingThreads(false);
    }
  }, []);

  useEffect(() => {
    fetchThreads();
  }, [fetchThreads]);

  // Fetch messages for selected thread
  const selectThread = useCallback(async (threadId: string) => {
    setSelectedThreadId(threadId);
    setLoadingMessages(true);
    try {
      const res = await fetch(`/api/messages/threads/${threadId}`);
      if (res.ok) {
        const json = await res.json();
        const data = Array.isArray(json) ? json : json.data;
        if (data && !Array.isArray(data)) {
          // data is { ...thread, messages: [...] }
          setMessages(data.messages ?? []);
          setThreadInfo({
            id: data.id,
            title: data.title,
            type: data.type,
            relatedId: data.relatedId,
            participants: data.participants,
            lastMessage: data.lastMessage,
            lastMessageAt: data.lastMessageAt,
            unreadCount: data.unreadCount ?? 0,
          });
        } else if (Array.isArray(data)) {
          setMessages(data);
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingMessages(false);
    }
  }, []);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Send message
  async function handleSend() {
    if (!composeText.trim() || !selectedThreadId || sending) return;

    setSending(true);
    try {
      const res = await fetch(`/api/messages/threads/${selectedThreadId}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: composeText.trim() }),
      });
      if (res.ok) {
        setComposeText('');
        // Re-fetch messages to show the new one
        await selectThread(selectedThreadId);
        // Re-fetch threads to update last message
        await fetchThreads();
      }
    } catch {
      // ignore
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground">消息中心</h2>
        <p className="mt-1 text-sm text-muted">
          与供应商、需求方进行 POC 沟通与商务洽谈
        </p>
      </div>

      {/* Message center layout */}
      <div className="flex h-[calc(100vh-260px)] min-h-[480px] rounded-2xl border border-line overflow-hidden bg-white shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
        {/* Left panel: Thread list */}
        <div className="w-[300px] shrink-0 border-r border-line flex flex-col">
          <div className="p-4 border-b border-line">
            <p className="text-sm font-semibold text-foreground">会话列表</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loadingThreads ? (
              <>
                <ThreadSkeleton />
                <ThreadSkeleton />
                <ThreadSkeleton />
              </>
            ) : threads.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-50 mb-3">
                  <Inbox className="h-5 w-5 text-muted/40" />
                </div>
                <p className="text-xs text-muted">暂无消息</p>
              </div>
            ) : (
              threads.map((thread) => (
                <ThreadItem
                  key={thread.id}
                  thread={thread}
                  isActive={selectedThreadId === thread.id}
                  onClick={() => selectThread(thread.id)}
                />
              ))
            )}
          </div>
        </div>

        {/* Right panel: Chat area */}
        <div className="flex flex-1 flex-col">
          {selectedThreadId && threadInfo ? (
            <>
              {/* Thread header */}
              <div className="border-b border-line px-6 py-4">
                <p className="text-base font-semibold text-foreground">
                  {threadInfo.title}
                </p>
                <p className="text-xs text-muted">
                  {THREAD_TYPE_ICONS[threadInfo.type] && (
                    <span>
                      {threadInfo.type === 'demand' && '需求沟通'}
                      {threadInfo.type === 'poc' && 'POC 沟通'}
                      {threadInfo.type === 'proposal' && '提案讨论'}
                      {threadInfo.type === 'general' && '通用消息'}
                    </span>
                  )}
                </p>
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
                {loadingMessages ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <MessageCircle className="h-8 w-8 text-muted/30 mb-2" />
                    <p className="text-xs text-muted">暂无消息</p>
                  </div>
                ) : (
                  messages.map((msg) => (
                    <MessageBubble
                      key={msg.id}
                      message={msg}
                      currentUserId={userId}
                    />
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>

              {/* Composer */}
              <div className="border-t border-line px-6 py-3 flex items-center gap-3">
                <input
                  type="text"
                  value={composeText}
                  onChange={(e) => setComposeText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="输入消息…"
                  className="flex-1 rounded-lg border border-line bg-gray-50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
                />
                <button
                  onClick={handleSend}
                  disabled={sending || !composeText.trim()}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-white transition-colors hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </>
          ) : (
            /* No thread selected */
            <div className="flex flex-1 flex-col items-center justify-center text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gray-50 mb-4">
                <MessageSquare className="h-8 w-8 text-muted/30" />
              </div>
              <p className="text-sm font-semibold text-foreground mb-1">
                选择一个对话开始聊天
              </p>
              <p className="text-xs text-muted">
                从左侧选择一个会话，或发起新的沟通
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
