'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Calculator,
  FileText,
  Check,
  X,
  MessageSquare,
  ArrowLeft,
  Loader2,
  Building2,
  Clock,
  Target,
  ChevronRight,
} from 'lucide-react';
import type { Proposal, Milestone, QuoteItem } from '@/types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ProposalDetail extends Proposal {
  quoteItems: QuoteItem[];
  supplierOrgName?: string;
  supplierOrgLogo?: string | null;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatPrice(value: number): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

const STATUS_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  draft: { label: '草稿', bg: 'bg-gray-100', text: 'text-gray-600' },
  submitted: { label: '已提交', bg: 'bg-blue-50', text: 'text-blue-700' },
  reviewed: { label: '已审核', bg: 'bg-amber-50', text: 'text-amber-700' },
  accepted: { label: '已接受', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  rejected: { label: '已拒绝', bg: 'bg-red-50', text: 'text-red-700' },
};

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

function Skeleton() {
  return (
    <div className="animate-fade-up space-y-6">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 rounded-xl bg-gray-100 animate-pulse" />
        <div>
          <div className="h-7 w-48 rounded-lg bg-gray-100 animate-pulse" />
          <div className="mt-1 h-4 w-32 rounded bg-gray-50 animate-pulse" />
        </div>
      </div>
      <div className="rounded-2xl border border-line bg-white p-6 space-y-4">
        <div className="h-5 w-40 rounded bg-gray-100 animate-pulse" />
        <div className="h-4 w-full rounded bg-gray-50 animate-pulse" />
        <div className="h-4 w-3/4 rounded bg-gray-50 animate-pulse" />
      </div>
      <div className="rounded-2xl border border-line bg-white p-6">
        <div className="h-48 rounded bg-gray-50 animate-pulse" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Milestone Timeline                                                 */
/* ------------------------------------------------------------------ */

function MilestoneTimeline({ milestones }: { milestones: Milestone[] }) {
  if (milestones.length === 0) {
    return (
      <p className="text-sm text-muted text-center py-6">暂无里程碑信息</p>
    );
  }

  return (
    <div className="space-y-0">
      {milestones.map((m, idx) => (
        <div key={idx} className="flex gap-4 last:pb-0">
          {/* Timeline indicator */}
          <div className="flex flex-col items-center">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
              {idx + 1}
            </div>
            {idx < milestones.length - 1 && (
              <div className="w-px flex-1 bg-line my-1" />
            )}
          </div>

          {/* Content */}
          <div className="pb-5 flex-1 min-w-0">
            <h4 className="text-sm font-semibold text-foreground">{m.name}</h4>
            {m.description && (
              <p className="mt-1 text-xs text-muted leading-relaxed">{m.description}</p>
            )}
            <div className="mt-2 flex items-center gap-3 text-xs">
              {m.duration && (
                <span className="flex items-center gap-1 text-muted">
                  <Clock className="h-3 w-3" />
                  {m.duration}
                </span>
              )}
              {m.deliverables.length > 0 && (
                <span className="flex items-center gap-1 text-muted">
                  <Target className="h-3 w-3" />
                  {m.deliverables.join(', ')}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function QuoteReviewPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const [proposalId, setProposalId] = useState<string>('');
  const [proposal, setProposal] = useState<ProposalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<'accept' | 'reject' | 'discuss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Resolve params
  useEffect(() => {
    params.then((p) => setProposalId(p.proposalId));
  }, [params]);

  // Fetch proposal
  const fetchProposal = useCallback(async () => {
    if (!proposalId) return;
    try {
      const res = await fetch(`/api/proposals/${proposalId}`);
      if (res.ok) {
        const json = await res.json();
        setProposal(json.data ?? json);
      } else {
        setError('加载报价详情失败');
      }
    } catch {
      setError('加载报价详情失败');
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    fetchProposal();
  }, [fetchProposal]);

  // ---- Action handlers ----

  async function handleAccept() {
    setActing('accept');
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'accepted' }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || '接受报价失败');
      }
      await fetchProposal();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setActing(null);
    }
  }

  async function handleReject() {
    if (!confirm('确定要拒绝此报价吗？此操作不可撤销。')) return;
    setActing('reject');
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'rejected' }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || '拒绝报价失败');
      }
      await fetchProposal();
    } catch (err) {
      setError(err instanceof Error ? err.message : '操作失败');
    } finally {
      setActing(null);
    }
  }

  async function handleDiscuss() {
    setActing('discuss');
    setError(null);
    try {
      // Create a message thread for discussion
      const res = await fetch('/api/messages/threads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `关于提案「${proposal?.title ?? ''}」的讨论`,
          type: 'proposal',
          relatedId: proposalId,
          participantIds: [], // Server will need to add participants
        }),
      });

      if (res.ok) {
        const json = await res.json();
        const threadId = json.data?.id ?? json.id;
        if (threadId) {
          window.location.href = `/dashboard/messages?thread=${threadId}`;
          return;
        }
      }
      // Fallback to messages page
      window.location.href = '/dashboard/messages';
    } catch {
      window.location.href = '/dashboard/messages';
    } finally {
      setActing(null);
    }
  }

  // ---- Computed ----

  const grandTotal = (proposal?.quoteItems ?? []).reduce(
    (sum, q) => sum + q.totalPrice,
    0,
  );

  const canAccept = proposal?.status === 'submitted' || proposal?.status === 'reviewed';
  const canReject = proposal?.status === 'submitted' || proposal?.status === 'reviewed';
  const isFinalized = proposal?.status === 'accepted' || proposal?.status === 'rejected';

  // ---- Render ----

  if (loading) return <Skeleton />;

  if (error && !proposal) {
    return (
      <div className="animate-fade-up">
        <div className="rounded-2xl border border-line bg-white p-12 text-center">
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <Link
            href="/dashboard/demands"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            返回需求列表
          </Link>
        </div>
      </div>
    );
  }

  const statusCfg = proposal ? STATUS_LABELS[proposal.status] : null;

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/demands"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-line text-muted hover:text-foreground hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Calculator className="h-6 w-6 text-primary" />
              报价审核
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {proposal?.title ?? '加载中...'}
            </p>
          </div>
        </div>

        {/* Status badge */}
        {statusCfg && (
          <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ${statusCfg.bg} ${statusCfg.text}`}>
            {statusCfg.label}
          </span>
        )}
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Supplier info card */}
      {proposal && (
        <div className="mb-6 rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-3">
            <Building2 className="h-5 w-5 text-primary" />
            供应商信息
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="text-xs text-muted">供应商</span>
              <p className="text-sm font-medium text-foreground">
                {proposal.supplierOrgName ?? '未知供应商'}
              </p>
            </div>
            <div>
              <span className="text-xs text-muted">交付周期</span>
              <p className="text-sm font-medium text-foreground">{proposal.deliveryPeriod || '-'}</p>
            </div>
            <div>
              <span className="text-xs text-muted">提案日期</span>
              <p className="text-sm font-medium text-foreground">{proposal.createdAt}</p>
            </div>
            <div>
              <span className="text-xs text-muted">方案范围</span>
              <p className="text-sm font-medium text-foreground line-clamp-2">{proposal.scope || '-'}</p>
            </div>
          </div>
        </div>
      )}

      {/* Quote items table (read-only) */}
      <div className="mb-6 rounded-2xl border border-line bg-white shadow-[0_8px_40px_rgba(15,23,42,0.08)] overflow-hidden">
        <div className="px-5 py-4 border-b border-line">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FileText className="h-5 w-5 text-primary" />
            报价明细
          </h3>
        </div>

        {/* Table header */}
        <div className="flex items-center gap-2 border-b border-line bg-[#f8fafc] px-5 py-2.5 text-xs font-semibold text-muted">
          <span className="w-8 text-center">#</span>
          <span className="w-36 shrink-0">名称</span>
          <span className="flex-1">描述</span>
          <span className="w-20 shrink-0 text-right">数量</span>
          <span className="w-16 shrink-0 text-center">单位</span>
          <span className="w-28 shrink-0 text-right">单价</span>
          <span className="w-28 shrink-0 text-right">总价</span>
        </div>

        {/* Rows */}
        {(proposal?.quoteItems ?? []).length === 0 ? (
          <div className="px-5 py-8 text-center text-sm text-muted">
            暂无报价项
          </div>
        ) : (
          (proposal?.quoteItems ?? []).map((item, idx) => (
            <div
              key={idx}
              className="flex items-center gap-2 border-b border-line/60 px-5 py-3.5 last:border-0 hover:bg-[#f8fafc] transition-colors"
            >
              <span className="w-8 text-center text-xs font-medium text-muted">
                {idx + 1}
              </span>
              <span className="w-36 shrink-0 text-sm font-medium text-foreground truncate">
                {item.name}
              </span>
              <span className="flex-1 text-sm text-muted truncate">
                {item.description || '-'}
              </span>
              <span className="w-20 shrink-0 text-sm text-foreground text-right">
                {item.quantity}
              </span>
              <span className="w-16 shrink-0 text-sm text-muted text-center">
                {item.unit}
              </span>
              <span className="w-28 shrink-0 text-sm text-foreground text-right">
                {formatPrice(item.unitPrice)}
              </span>
              <span className="w-28 shrink-0 text-sm font-medium text-foreground text-right">
                {formatPrice(item.totalPrice)}
              </span>
            </div>
          ))
        )}

        {/* Grand total */}
        <div className="flex items-center justify-between border-t-2 border-line px-5 py-4 bg-[#f8fafc]">
          <span className="text-sm font-bold text-foreground">合计</span>
          <span className="text-xl font-bold text-primary">
            {formatPrice(grandTotal)} CNY
          </span>
        </div>
      </div>

      {/* Milestones timeline */}
      <div className="mb-6 rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
          <Clock className="h-5 w-5 text-primary" />
          里程碑计划
        </h3>
        <MilestoneTimeline milestones={proposal?.milestones ?? []} />
      </div>

      {/* Action buttons */}
      <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
          操作
        </h3>

        {isFinalized ? (
          <div className="flex items-center gap-3 rounded-xl bg-gray-50 px-4 py-3">
            {proposal?.status === 'accepted' && (
              <>
                <Check className="h-5 w-5 text-emerald-600" />
                <span className="text-sm font-medium text-emerald-700">此报价已被接受</span>
              </>
            )}
            {proposal?.status === 'rejected' && (
              <>
                <X className="h-5 w-5 text-red-600" />
                <span className="text-sm font-medium text-red-700">此报价已被拒绝</span>
              </>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleAccept}
              disabled={!canAccept || acting !== null}
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition-all duration-160 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(16,185,129,0.24)] disabled:opacity-50 disabled:pointer-events-none"
            >
              {acting === 'accept' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
              接受报价
            </button>
            <button
              onClick={handleReject}
              disabled={!canReject || acting !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-5 py-2.5 text-sm font-bold text-red-600 transition-all duration-160 hover:bg-red-50 disabled:opacity-50 disabled:pointer-events-none"
            >
              {acting === 'reject' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
              拒绝
            </button>
            <button
              onClick={handleDiscuss}
              disabled={acting !== null}
              className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-5 py-2.5 text-sm font-bold text-foreground transition-all duration-160 hover:-translate-y-0.5 hover:border-[#bfdbfe] hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)] disabled:opacity-50 disabled:pointer-events-none"
            >
              {acting === 'discuss' ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <MessageSquare className="h-4 w-4" />
              )}
              讨论修改
            </button>
          </div>
        )}

        {/* Comparison mode placeholder */}
        <div className="mt-4 pt-4 border-t border-line/60">
          <button
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-primary transition-colors"
          >
            <ChevronRight className="h-3.5 w-3.5" />
            对比其他提案（即将上线）
          </button>
        </div>
      </div>
    </div>
  );
}
