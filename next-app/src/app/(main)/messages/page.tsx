'use client';

import { MessageSquareText, Send } from 'lucide-react';

const threads = [
  { id: 't1', name: '启元AI', preview: '建议包含准确率、溯源率…', unread: 2, active: true },
  { id: 't2', name: '星河智能科技', preview: '已查看需求，建议先做POC', unread: 2, active: false },
  { id: 't3', name: '云脉AI销售团队', preview: '您好，关于销售线索Agent…', unread: 2, active: false },
];

const messages = [
  {
    id: 'm1',
    sender: '启元AI',
    content: '我们已查看你的需求，建议先用 200 份制度文档做 POC。',
    self: false,
  },
  {
    id: 'm2',
    sender: '我',
    content: '可以，请确认需要哪些验收指标？',
    self: true,
  },
  {
    id: 'm3',
    sender: '启元AI',
    content: '建议包含准确率、溯源率、响应时间和权限隔离测试。',
    self: false,
  },
];

export default function MessagesPage() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 animate-fade-up">
      <h1 className="text-2xl font-bold text-foreground mb-1">消息中心</h1>
      <p className="text-sm text-muted mb-6">与供应商、需求方进行 POC 沟通与商务洽谈。</p>

      <div className="flex h-[calc(100vh-220px)] min-h-[480px] rounded-xl border border-line overflow-hidden bg-white">
        {/* Sidebar */}
        <div className="w-[320px] shrink-0 border-r border-line flex flex-col">
          <div className="p-4 border-b border-line">
            <p className="text-sm font-semibold text-foreground">会话列表</p>
          </div>
          <div className="flex-1 overflow-y-auto">
            {threads.map((t) => (
              <div
                key={t.id}
                className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${
                  t.active
                    ? 'bg-primary/5 border-l-2 border-l-primary'
                    : 'hover:bg-gray-50 border-l-2 border-l-transparent'
                }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                  <MessageSquareText className="h-4 w-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-foreground truncate">
                      {t.name}
                    </p>
                    {t.unread > 0 && (
                      <span className="ml-2 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-white">
                        {t.unread}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted truncate">{t.preview}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Chat Area */}
        <div className="flex flex-1 flex-col">
          {/* Thread Header */}
          <div className="border-b border-line px-6 py-4">
            <p className="text-base font-semibold text-foreground">
              启元AI · 知识库 POC 沟通
            </p>
            <p className="text-xs text-muted">需求：某制造企业知识库问答系统</p>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`flex ${msg.self ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[70%] rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                    msg.self
                      ? 'bg-primary text-white rounded-br-sm'
                      : 'bg-gray-100 text-foreground rounded-bl-sm'
                  }`}
                >
                  {!msg.self && (
                    <p className="mb-1 text-xs font-semibold text-primary">
                      {msg.sender}
                    </p>
                  )}
                  {msg.content}
                </div>
              </div>
            ))}
          </div>

          {/* Composer */}
          <div className="border-t border-line px-6 py-3 flex items-center gap-3">
            <input
              type="text"
              placeholder="输入消息…"
              className="flex-1 rounded-lg border border-line bg-gray-50 px-4 py-2.5 text-sm text-foreground placeholder:text-muted outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 transition-colors"
            />
            <button className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary text-white transition-colors hover:bg-primary/90">
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
