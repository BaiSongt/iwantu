'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Shield,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Loader2,
  Inbox,
  Package,
  Eye,
} from 'lucide-react';
import type { ProductStatus } from '@/types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ReviewItem {
  id: string;
  name: string;
  summary: string;
  category: string;
  status: ProductStatus;
  company: string;
  companyLogo: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<string, { label: string; bg: string; text: string }> = {
  pending_review: { label: '待审核', bg: 'bg-amber-50', text: 'text-amber-700' },
  needs_info: { label: '需补充信息', bg: 'bg-orange-50', text: 'text-orange-700' },
};

/* ------------------------------------------------------------------ */
/*  Status Badge                                                       */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    bg: 'bg-gray-100',
    text: 'text-gray-600',
  };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Star Rating                                                        */
/* ------------------------------------------------------------------ */

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((star) => (
        <svg
          key={star}
          className={`h-4 w-4 ${star <= rating ? 'text-amber-400' : 'text-gray-200'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
        </svg>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton row                                                       */
/* ------------------------------------------------------------------ */

function SkeletonRow() {
  return (
    <tr className="border-b border-line/40">
      <td className="py-3 px-4"><div className="h-4 w-32 rounded bg-gray-100 animate-pulse" /></td>
      <td className="py-3 px-4"><div className="h-4 w-20 rounded bg-gray-50 animate-pulse" /></td>
      <td className="py-3 px-4"><div className="h-4 w-24 rounded bg-gray-50 animate-pulse" /></td>
      <td className="py-3 px-4"><div className="h-4 w-20 rounded bg-gray-50 animate-pulse" /></td>
      <td className="py-3 px-4"><div className="h-5 w-14 rounded-md bg-gray-50 animate-pulse" /></td>
      <td className="py-3 px-4"><div className="flex gap-2"><div className="h-7 w-16 rounded-lg bg-gray-50 animate-pulse" /><div className="h-7 w-16 rounded-lg bg-gray-50 animate-pulse" /><div className="h-7 w-16 rounded-lg bg-gray-50 animate-pulse" /></div></td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function AdminReviewsPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('');

  const fetchItems = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);

      const res = await fetch(`/api/admin/reviews?${params}`);
      if (res.ok) {
        const json = await res.json();
        setItems(Array.isArray(json) ? json : json.data ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchItems();
  }, [fetchItems]);

  async function handleAction(productId: string, action: 'approve' | 'needs_info' | 'delist') {
    const actionLabels: Record<string, string> = {
      approve: '通过审核',
      needs_info: '要求补充信息',
      delist: '下架',
    };

    if (!confirm(`确定要对该产品执行「${actionLabels[action]}」操作吗？`)) return;

    setActionLoading(productId);
    try {
      const res = await fetch('/api/admin/reviews', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, action }),
      });
      if (res.ok) {
        // Remove the item from the list
        setItems((prev) => prev.filter((i) => i.id !== productId));
      }
    } catch {
      // ignore
    } finally {
      setActionLoading(null);
    }
  }

  const pendingCount = items.filter((i) => i.status === 'pending_review').length;
  const needsInfoCount = items.filter((i) => i.status === 'needs_info').length;

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground">内容审核</h2>
        <p className="mt-1 text-sm text-muted">
          审核供应商提交的产品与服务
        </p>
      </div>

      {/* Stats cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-4 shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-amber-50">
            <Shield className="h-4 w-4 text-amber-600" />
          </div>
          <div>
            <p className="text-lg font-bold text-foreground">{pendingCount}</p>
            <p className="text-xs text-muted">待审核</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-4 shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-50">
            <AlertCircle className="h-4 w-4 text-orange-600" />
          </div>
          <div>
            <p className="text-lg font-bold text-foreground">{needsInfoCount}</p>
            <p className="text-xs text-muted">需补充信息</p>
          </div>
        </div>
        <div className="flex items-center gap-3 rounded-xl border border-line bg-white p-4 shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gray-50">
            <Package className="h-4 w-4 text-gray-500" />
          </div>
          <div>
            <p className="text-lg font-bold text-foreground">{items.length}</p>
            <p className="text-xs text-muted">总计</p>
          </div>
        </div>
      </div>

      {/* Filter */}
      <div className="mb-4 flex items-center gap-2">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-xl border border-line bg-white px-3 py-2 text-sm text-foreground outline-none focus:border-primary cursor-pointer shadow-[0_4px_16px_rgba(15,23,42,0.04)]"
        >
          <option value="">全部状态</option>
          <option value="pending_review">待审核</option>
          <option value="needs_info">需补充信息</option>
        </select>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-line bg-white shadow-[0_8px_40px_rgba(15,23,42,0.08)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line bg-gray-50/50">
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">产品名称</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">分类</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">供应商</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">提交时间</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">状态</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50 mb-3">
                        <Inbox className="h-6 w-6 text-muted/40" />
                      </div>
                      <p className="text-sm font-semibold text-foreground mb-1">审核队列为空</p>
                      <p className="text-xs text-muted">没有待审核的产品</p>
                    </div>
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b border-line/40 hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gray-50">
                          <Package className="h-4 w-4 text-muted/40" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">{item.name}</p>
                          <p className="text-xs text-muted truncate max-w-[200px]">{item.summary}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-sm text-muted">{item.category}</p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-sm text-muted">{item.company}</p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-xs text-muted">
                        {new Date(item.createdAt).toLocaleDateString('zh-CN')}
                      </p>
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={item.status} />
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <a
                          href={`/products/${item.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center justify-center h-7 w-7 rounded-lg border border-line text-muted hover:text-foreground hover:bg-gray-50 transition-colors"
                          title="查看详情"
                        >
                          <Eye className="h-3.5 w-3.5" />
                        </a>
                        <button
                          onClick={() => handleAction(item.id, 'approve')}
                          disabled={actionLoading === item.id}
                          className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-2.5 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 transition-colors"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          通过
                        </button>
                        <button
                          onClick={() => handleAction(item.id, 'needs_info')}
                          disabled={actionLoading === item.id}
                          className="inline-flex items-center gap-1 rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs font-medium text-amber-700 hover:bg-amber-100 disabled:opacity-50 transition-colors"
                        >
                          <AlertCircle className="h-3.5 w-3.5" />
                          补充
                        </button>
                        <button
                          onClick={() => handleAction(item.id, 'delist')}
                          disabled={actionLoading === item.id}
                          className="inline-flex items-center gap-1 rounded-lg bg-red-50 px-2.5 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100 disabled:opacity-50 transition-colors"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                          下架
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
