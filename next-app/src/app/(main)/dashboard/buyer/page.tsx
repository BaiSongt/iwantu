'use client';

import Link from 'next/link';
import {
  ClipboardList,
  FileText,
  LayoutDashboard,
  MessageSquareText,
  Plus,
  TrendingUp,
  BarChart3,
} from 'lucide-react';
import MetricGrid from '@/components/ui/MetricGrid';
import Panel from '@/components/ui/Panel';

const metrics = [
  { value: '4', label: '已发布需求' },
  { value: '12', label: '推荐产品' },
  { value: '3', label: 'POC进行中' },
  { value: '8', label: '未读消息' },
];

const todos = [
  '完善知识库需求验收指标',
  '确认启元AI POC样例数据',
  '查看星河智能科技报价',
  '回复站内咨询消息',
];

const progress = [
  { text: '匹配结果已更新', time: '2 小时前' },
  { text: '供应商提交了 POC 计划', time: '5 小时前' },
  { text: '新产品加入对比', time: '1 天前' },
  { text: '需求完整度提升至 86%', time: '2 天前' },
];

const shortcuts = [
  { label: '发布需求', href: '/demands', icon: Plus },
  { label: '产品对比', href: '/compare', icon: BarChart3 },
  { label: '消息中心', href: '/messages', icon: MessageSquareText },
  { label: '方案报价', href: '/quote', icon: FileText },
];

export default function BuyerDashboardPage() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <LayoutDashboard className="h-6 w-6 text-primary" />
          需求方控制台
        </h1>
        <p className="mt-1 text-sm text-muted">
          跟踪需求、匹配结果、POC进展和沟通记录。
        </p>
      </div>

      {/* Metrics */}
      <MetricGrid items={metrics} />

      {/* Dashboard Grid */}
      <div className="mt-8 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Todos */}
        <Panel title="待办事项" icon={<ClipboardList className="h-5 w-5 text-primary" />}>
          <ul className="space-y-3">
            {todos.map((t) => (
              <li
                key={t}
                className="flex items-start gap-2 text-sm text-foreground"
              >
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {t}
              </li>
            ))}
          </ul>
        </Panel>

        {/* Recent Progress */}
        <Panel title="最近进展" icon={<TrendingUp className="h-5 w-5 text-green" />}>
          <ul className="space-y-3">
            {progress.map((p) => (
              <li key={p.text} className="text-sm">
                <p className="text-foreground">{p.text}</p>
                <p className="text-xs text-muted">{p.time}</p>
              </li>
            ))}
          </ul>
        </Panel>

        {/* Shortcuts */}
        <Panel title="快捷入口" icon={<LayoutDashboard className="h-5 w-5 text-violet" />}>
          <div className="grid grid-cols-2 gap-3">
            {shortcuts.map((s) => (
              <Link
                key={s.label}
                href={s.href}
                className="flex flex-col items-center gap-2 rounded-lg border border-line p-4 text-sm font-medium text-foreground transition-colors hover:bg-primary/5 hover:border-primary/30"
              >
                <s.icon className="h-5 w-5 text-primary" />
                {s.label}
              </Link>
            ))}
          </div>
        </Panel>
      </div>
    </section>
  );
}
