'use client';

import Link from 'next/link';
import {
  ClipboardList,
  FileText,
  LayoutDashboard,
  MessageSquareText,
  PackagePlus,
  Search,
  TrendingUp,
} from 'lucide-react';
import MetricGrid from '@/components/ui/MetricGrid';
import Panel from '@/components/ui/Panel';

const metrics = [
  { value: '9', label: '上架产品' },
  { value: '24', label: '需求线索' },
  { value: '6', label: '待报价' },
  { value: '2', label: 'POC进行中' },
];

const todos = [
  '回复知识库需求方案',
  '查看新需求匹配',
  '更新产品资料',
  '确认POC计划',
];

const leads = [
  { title: '某制造企业知识库需求', time: '30 分钟前' },
  { title: '工业视觉检测需求', time: '2 小时前' },
  { title: '科研情报Agent需求', time: '5 小时前' },
  { title: '文档审查需求', time: '1 天前' },
];

const shortcuts = [
  { label: '发布产品', href: '/products', icon: PackagePlus },
  { label: '需求大厅', href: '/demands', icon: Search },
  { label: '方案报价', href: '/quote', icon: FileText },
  { label: '消息中心', href: '/messages', icon: MessageSquareText },
];

export default function SupplierDashboardPage() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <LayoutDashboard className="h-6 w-6 text-primary" />
          供应商后台
        </h1>
        <p className="mt-1 text-sm text-muted">
          管理产品、需求线索、报价方案和公司主页。
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

        {/* Recent Leads */}
        <Panel title="最近线索" icon={<TrendingUp className="h-5 w-5 text-green" />}>
          <ul className="space-y-3">
            {leads.map((l) => (
              <li key={l.title} className="text-sm">
                <p className="text-foreground">{l.title}</p>
                <p className="text-xs text-muted">{l.time}</p>
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
