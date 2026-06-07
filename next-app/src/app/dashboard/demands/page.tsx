'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Plus,
  Eye,
  Pencil,
  Trash2,
  Inbox,
} from 'lucide-react';
import type { Demand, DemandStatus } from '@/types';

/* ------------------------------------------------------------------ */
/*  Status badge config                                                */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<
  DemandStatus,
  { label: string; bg: string; text: string }
> = {
  draft: { label: '草稿', bg: 'bg-gray-100', text: 'text-gray-600' },
  clarifying: {
    label: '需求澄清',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
  },
  awaiting_quote: {
    label: '等待报价',
    bg: 'bg-orange-50',
    text: 'text-orange-700',
  },
  collecting_proposals: {
    label: '收集提案中',
    bg: 'bg-blue-50',
    text: 'text-blue-700',
  },
  in_poc: {
    label: '进行中POC',
    bg: 'bg-purple-50',
    text: 'text-purple-700',
  },
  closed_deal: {
    label: '已成交',
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
  },
  closed: {
    label: '已关闭',
    bg: 'bg-green-50',
    text: 'text-green-700',
  },
};

/* ------------------------------------------------------------------ */
/*  Filter tabs                                                        */
/* ------------------------------------------------------------------ */

type FilterTab = 'all' | 'draft' | 'collecting_proposals' | 'in_poc' | 'closed';

const FILTER_TABS: { id: FilterTab; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'draft', label: '草稿' },
  { id: 'collecting_proposals', label: '收集提案中' },
  { id: 'in_poc', label: '进行中POC' },
  { id: 'closed', label: '已关闭' },
];

/* ------------------------------------------------------------------ */
/*  Status Badge                                                       */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: DemandStatus }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    bg: 'bg-gray-100',
    text: 'text-gray-600',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text}`}
    >
      {cfg.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Demand Row                                                         */
/* ------------------------------------------------------------------ */

function DemandRow({
  demand,
  onDelete,
}: {
  demand: Demand;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-4 border-b border-line/60 px-4 py-3.5 last:border-0 transition-colors hover:bg-[#f8fafc]">
      {/* Title + Industry */}
      <div className="min-w-0 flex-1">
        <Link
          href={`/demands/${demand.id}`}
          className="text-sm font-semibold text-foreground hover:text-primary transition-colors truncate block"
        >
          {demand.title}
        </Link>
        <p className="mt-0.5 text-xs text-muted">{demand.industry}</p>
      </div>

      {/* Budget */}
      <div className="hidden sm:block w-28 shrink-0 text-sm text-foreground">
        {demand.budgetRange || '-'}
      </div>

      {/* Status */}
      <div className="w-24 shrink-0">
        <StatusBadge status={demand.status} />
      </div>

      {/* Created At */}
      <div className="hidden md:block w-24 shrink-0 text-xs text-muted">
        {demand.createdAt}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        <Link
          href={`/demands/${demand.id}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-primary hover:bg-primary/10 transition-colors"
          title="查看详情"
        >
          <Eye className="h-4 w-4" />
        </Link>
        {demand.status === 'draft' && (
          <Link
            href={`/demands/${demand.id}`}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-blue-600 hover:bg-blue-50 transition-colors"
            title="编辑"
          >
            <Pencil className="h-4 w-4" />
          </Link>
        )}
        {demand.status === 'draft' && (
          <button
            onClick={() => onDelete(demand.id)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-red-600 hover:bg-red-50 transition-colors"
            title="删除"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton Row                                                       */
/* ------------------------------------------------------------------ */

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 border-b border-line/60 px-4 py-3.5">
      <div className="flex-1">
        <div className="h-4 w-3/4 rounded bg-gray-100 animate-pulse" />
        <div className="mt-1.5 h-3 w-1/3 rounded bg-gray-50 animate-pulse" />
      </div>
      <div className="hidden sm:block w-28 h-4 rounded bg-gray-50 animate-pulse" />
      <div className="w-24 h-5 rounded-md bg-gray-50 animate-pulse" />
      <div className="hidden md:block w-24 h-3 rounded bg-gray-50 animate-pulse" />
      <div className="w-20 h-8 rounded bg-gray-50 animate-pulse" />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function DemandsPage() {
  const [demands, setDemands] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<FilterTab>('all');

  const fetchDemands = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (activeTab !== 'all') {
        params.set('status', activeTab);
      }
      const res = await fetch(`/api/demands?${params.toString()}`);
      if (res.ok) {
        const json = await res.json();
        // apiSuccess wraps data directly (no nested data property)
        setDemands(Array.isArray(json) ? json : json.data ?? []);
      }
    } catch {
      // ignore fetch errors
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => {
    fetchDemands();
  }, [fetchDemands]);

  async function handleDelete(id: string) {
    if (!confirm('确定要删除这条需求吗？此操作不可恢复。')) return;
    try {
      const res = await fetch(`/api/demands/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setDemands((prev) => prev.filter((d) => d.id !== id));
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">我的需求</h2>
          <p className="mt-1 text-sm text-muted">
            管理您发布的所有采购需求
          </p>
        </div>
        <Link
          href="/demands/publish"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
        >
          <Plus className="h-4 w-4" />
          发布新需求
        </Link>
      </div>

      {/* Filter Tabs */}
      <div className="mb-4 flex items-center gap-1 rounded-xl bg-gray-50 p-1">
        {FILTER_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setLoading(true);
            }}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition-all duration-160 ${
              activeTab === tab.id
                ? 'bg-white text-foreground shadow-sm'
                : 'text-muted hover:text-foreground'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Demands List */}
      <div className="rounded-2xl bg-white border border-line shadow-[0_8px_40px_rgba(15,23,42,0.08)] overflow-hidden">
        {/* Table header */}
        <div className="flex items-center gap-4 border-b border-line bg-[#f8fafc] px-4 py-2.5 text-xs font-semibold text-muted">
          <div className="flex-1">标题 / 行业</div>
          <div className="hidden sm:block w-28">预算</div>
          <div className="w-24">状态</div>
          <div className="hidden md:block w-24">创建时间</div>
          <div className="w-20">操作</div>
        </div>

        {/* Rows */}
        {loading ? (
          <>
            <SkeletonRow />
            <SkeletonRow />
            <SkeletonRow />
          </>
        ) : demands.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-50 mb-4">
              <Inbox className="h-7 w-7 text-muted/40" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">
              还没有发布过需求
            </p>
            <p className="text-xs text-muted mb-5">
              发布您的第一个采购需求，开始匹配供应商
            </p>
            <Link
              href="/demands/publish"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition-all duration-160 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
            >
              <Plus className="h-4 w-4" />
              发布新需求
            </Link>
          </div>
        ) : (
          demands.map((demand) => (
            <DemandRow
              key={demand.id}
              demand={demand}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>
    </div>
  );
}
