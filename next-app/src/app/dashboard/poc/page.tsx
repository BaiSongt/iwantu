'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FlaskConical,
  CheckCircle,
  ArrowRight,
  Clock,
  Inbox,
  Loader2,
  ChevronDown,
  ChevronUp,
  AlertCircle,
} from 'lucide-react';
import type { PocStatus } from '@/types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface PocParticipant {
  id: string;
  userId: string;
  role: string;
  orgId: string;
  userName?: string;
}

interface PocProject {
  id: string;
  demandId: string;
  productId: string | null;
  supplierOrgId: string | null;
  status: PocStatus;
  testMetrics: string[];
  acceptanceCriteria: string[];
  sampleDataStatus: 'pending' | 'uploaded' | 'processing';
  startDate: string;
  endDate: string | null;
  demand?: { id: string; title: string; industry: string } | null;
  product?: { id: string; name: string } | null;
  supplierOrg?: { id: string; name: string } | null;
  participants: PocParticipant[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const POC_STEPS: { key: PocStatus; label: string }[] = [
  { key: 'not_started', label: '提交需求' },
  { key: 'confirming_requirements', label: '确认需求' },
  { key: 'uploading_sample_data', label: '上传样例数据' },
  { key: 'supplier_testing', label: '供应商测试' },
  { key: 'result_review', label: '验收评审' },
  { key: 'procurement_discussion', label: '采购洽谈' },
  { key: 'completed', label: '完成' },
];

const STATUS_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  not_started: { label: '未开始', bg: 'bg-gray-100', text: 'text-gray-600' },
  confirming_requirements: { label: '确认需求', bg: 'bg-amber-50', text: 'text-amber-700' },
  uploading_sample_data: { label: '上传样例', bg: 'bg-blue-50', text: 'text-blue-700' },
  supplier_testing: { label: '供应商测试', bg: 'bg-purple-50', text: 'text-purple-700' },
  result_review: { label: '验收评审', bg: 'bg-orange-50', text: 'text-orange-700' },
  procurement_discussion: { label: '采购洽谈', bg: 'bg-teal-50', text: 'text-teal-700' },
  completed: { label: '已完成', bg: 'bg-emerald-50', text: 'text-emerald-700' },
  terminated: { label: '已终止', bg: 'bg-red-50', text: 'text-red-700' },
};

const STEP_ORDER: PocStatus[] = [
  'not_started',
  'confirming_requirements',
  'uploading_sample_data',
  'supplier_testing',
  'result_review',
  'procurement_discussion',
  'completed',
];

function getStepIndex(status: PocStatus): number {
  if (status === 'terminated') return -1;
  const idx = STEP_ORDER.indexOf(status);
  return idx === -1 ? 0 : idx;
}

const NEXT_STATUS: Partial<Record<PocStatus, PocStatus>> = {
  not_started: 'confirming_requirements',
  confirming_requirements: 'uploading_sample_data',
  uploading_sample_data: 'supplier_testing',
  supplier_testing: 'result_review',
  result_review: 'procurement_discussion',
  procurement_discussion: 'completed',
};

/* ------------------------------------------------------------------ */
/*  Status Badge                                                       */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: PocStatus }) {
  const cfg = STATUS_BADGE[status] ?? STATUS_BADGE.not_started;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text}`}
    >
      {status === 'completed' && <CheckCircle className="h-3 w-3" />}
      {status === 'terminated' && <AlertCircle className="h-3 w-3" />}
      {cfg.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Segmented Progress Bar                                             */
/* ------------------------------------------------------------------ */

function SegmentedProgressBar({ status }: { status: PocStatus }) {
  const currentIdx = getStepIndex(status);
  if (currentIdx === -1) {
    // Terminated: show empty
    return (
      <div className="flex items-center gap-1">
        {POC_STEPS.map((_, i) => (
          <div
            key={i}
            className="h-1.5 flex-1 rounded-full bg-red-200"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-1">
      {POC_STEPS.map((step, i) => (
        <div
          key={step.key}
          className={`h-1.5 flex-1 rounded-full transition-colors ${
            i <= currentIdx ? 'bg-primary' : 'bg-gray-200'
          }`}
        />
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  POC Card                                                           */
/* ------------------------------------------------------------------ */

function PocCard({
  poc,
  onAdvance,
  advancing,
}: {
  poc: PocProject;
  onAdvance: (id: string, nextStatus: PocStatus) => void;
  advancing: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const nextStatus = NEXT_STATUS[poc.status];
  const isAdvancing = advancing === poc.id;

  return (
    <article className="border border-line rounded-2xl bg-white shadow-[0_8px_40px_rgba(15,23,42,0.08)] transition-all duration-160 ease-out hover:-translate-y-0.5 hover:border-[#bfdbfe] hover:shadow-[0_24px_70px_rgba(21,94,239,0.16)]">
      {/* Header */}
      <div
        className="flex items-start gap-4 p-5 cursor-pointer"
        onClick={() => setExpanded(!expanded)}
      >
        {/* Icon */}
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FlaskConical className="h-5 w-5" />
        </div>

        {/* Info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {poc.demand?.title ?? '未命名需求'}
            </h3>
            <StatusBadge status={poc.status} />
          </div>
          <div className="flex items-center gap-3 text-xs text-muted">
            {poc.supplierOrg && (
              <span>供应商: {poc.supplierOrg.name}</span>
            )}
            {poc.product && (
              <span>产品: {poc.product.name}</span>
            )}
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {poc.startDate}
            </span>
          </div>
          {/* Progress bar */}
          <div className="mt-3">
            <SegmentedProgressBar status={poc.status} />
          </div>
          {/* Step labels */}
          <div className="mt-1.5 flex items-center gap-1">
            {POC_STEPS.map((step, i) => (
              <span
                key={step.key}
                className={`flex-1 text-center text-[10px] truncate ${
                  i <= getStepIndex(poc.status) && poc.status !== 'terminated'
                    ? 'text-primary font-medium'
                    : 'text-muted/60'
                }`}
              >
                {step.label}
              </span>
            ))}
          </div>
        </div>

        {/* Expand toggle */}
        <button className="shrink-0 flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-gray-50 transition-colors">
          {expanded ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
        </button>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-line/60 px-5 py-4 space-y-3">
          {/* Participants */}
          <div>
            <h4 className="text-xs font-semibold text-muted mb-2">参与人员</h4>
            <div className="flex flex-wrap gap-2">
              {poc.participants.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 px-2.5 py-1 text-xs text-foreground"
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      p.role === 'buyer'
                        ? 'bg-blue-500'
                        : p.role === 'supplier'
                          ? 'bg-purple-500'
                          : 'bg-teal-500'
                    }`}
                  />
                  {p.userName ?? p.userId}
                  <span className="text-muted">
                    ({p.role === 'buyer' ? '需求方' : p.role === 'supplier' ? '供应商' : '评审'})
                  </span>
                </span>
              ))}
            </div>
          </div>

          {/* Acceptance criteria */}
          {poc.acceptanceCriteria.length > 0 && (
            <div>
              <h4 className="text-xs font-semibold text-muted mb-2">验收标准</h4>
              <ul className="space-y-1">
                {poc.acceptanceCriteria.map((c, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-foreground">
                    <CheckCircle className="h-3 w-3 shrink-0 mt-0.5 text-emerald-500" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Sample data status */}
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted">样例数据状态:</span>
            <span
              className={`inline-flex items-center rounded-full px-2 py-0.5 font-medium ${
                poc.sampleDataStatus === 'uploaded'
                  ? 'bg-emerald-50 text-emerald-700'
                  : poc.sampleDataStatus === 'processing'
                    ? 'bg-blue-50 text-blue-700'
                    : 'bg-gray-100 text-gray-600'
              }`}
            >
              {poc.sampleDataStatus === 'uploaded'
                ? '已上传'
                : poc.sampleDataStatus === 'processing'
                  ? '处理中'
                  : '待上传'}
            </span>
          </div>

          {/* Action buttons */}
          {nextStatus && (
            <div className="flex justify-end pt-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onAdvance(poc.id, nextStatus);
                }}
                disabled={isAdvancing}
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)] disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isAdvancing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowRight className="h-3.5 w-3.5" />
                )}
                推进到下一步
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton Card                                                      */
/* ------------------------------------------------------------------ */

function SkeletonCard() {
  return (
    <div className="border border-line rounded-2xl bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
      <div className="flex items-start gap-4">
        <div className="h-10 w-10 rounded-xl bg-gray-100 animate-pulse" />
        <div className="flex-1">
          <div className="h-4 w-3/4 rounded bg-gray-100 animate-pulse mb-2" />
          <div className="h-3 w-1/2 rounded bg-gray-50 animate-pulse mb-3" />
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5, 6, 7].map((i) => (
              <div key={i} className="h-1.5 flex-1 rounded-full bg-gray-100 animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function PocDashboardPage() {
  const [pocs, setPocs] = useState<PocProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [advancing, setAdvancing] = useState<string | null>(null);

  const fetchPocs = useCallback(async () => {
    try {
      const res = await fetch('/api/poc');
      if (res.ok) {
        const json = await res.json();
        setPocs(Array.isArray(json) ? json : json.data ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPocs();
  }, [fetchPocs]);

  async function handleAdvance(pocId: string, nextStatus: PocStatus) {
    setAdvancing(pocId);
    try {
      const res = await fetch(`/api/poc/${pocId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        // Re-fetch all POCs to reflect update
        await fetchPocs();
      } else {
        const json = await res.json();
        alert(json.error ?? '操作失败');
      }
    } catch {
      alert('网络错误，请重试');
    } finally {
      setAdvancing(null);
    }
  }

  // Count by status
  const statusCounts = pocs.reduce<Record<string, number>>((acc, poc) => {
    acc[poc.status] = (acc[poc.status] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <FlaskConical className="h-6 w-6 text-primary" />
          POC 管理
        </h2>
        <p className="mt-1 text-sm text-muted">
          跟踪和管理所有 POC 验证项目的进度
        </p>
      </div>

      {/* Summary stats */}
      {!loading && pocs.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
            <div className="text-2xl font-bold text-foreground">{pocs.length}</div>
            <div className="text-xs text-muted">全部 POC</div>
          </div>
          <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
            <div className="text-2xl font-bold text-blue-600">
              {(statusCounts['not_started'] ?? 0) +
                (statusCounts['confirming_requirements'] ?? 0) +
                (statusCounts['uploading_sample_data'] ?? 0)}
            </div>
            <div className="text-xs text-muted">准备阶段</div>
          </div>
          <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
            <div className="text-2xl font-bold text-purple-600">
              {(statusCounts['supplier_testing'] ?? 0) +
                (statusCounts['result_review'] ?? 0)}
            </div>
            <div className="text-xs text-muted">验证阶段</div>
          </div>
          <div className="rounded-2xl border border-line bg-white p-4 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
            <div className="text-2xl font-bold text-emerald-600">
              {statusCounts['completed'] ?? 0}
            </div>
            <div className="text-xs text-muted">已完成</div>
          </div>
        </div>
      )}

      {/* POC list */}
      {loading ? (
        <div className="space-y-4">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : pocs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-50 mb-4">
            <Inbox className="h-7 w-7 text-muted/40" />
          </div>
          <p className="text-sm font-semibold text-foreground mb-1">
            暂无 POC 项目
          </p>
          <p className="text-xs text-muted">
            当需求进入 POC 阶段时，项目将出现在这里
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {pocs.map((poc) => (
            <PocCard
              key={poc.id}
              poc={poc}
              onAdvance={handleAdvance}
              advancing={advancing}
            />
          ))}
        </div>
      )}
    </div>
  );
}
