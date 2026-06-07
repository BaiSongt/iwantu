'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  Plus,
  Trash2,
  CheckCircle,
  XCircle,
  Loader2,
  Send,
  Building2,
  FileText,
} from 'lucide-react';
import TwoColumn from '@/components/ui/TwoColumn';
import DetailBlock from '@/components/ui/DetailBlock';
import Panel from '@/components/ui/Panel';
import InfoRows from '@/components/ui/InfoRows';
import TagCloud from '@/components/ui/TagCloud';
import type { Demand, Proposal, Milestone, UserRole } from '@/types';

// ---------------------------------------------------------------------------
// Status badge colours
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  submitted: 'bg-blue-100 text-blue-700',
  reviewed: 'bg-yellow-100 text-yellow-700',
  accepted: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-600',
};

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  submitted: '已提交',
  reviewed: '已审核',
  accepted: '已接受',
  rejected: '已拒绝',
  awaiting_quote: '待报价',
  collecting_proposals: '征集方案',
  clarifying: '需求澄清',
  in_poc: 'POC验证中',
  closed_deal: '已成交',
  closed: '已关闭',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[status] ?? 'bg-gray-100 text-gray-600'}`}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Proposal Form (supplier view)
// ---------------------------------------------------------------------------

interface ProposalFormProps {
  demandId: string;
  onSuccess: () => void;
}

function ProposalForm({ demandId, onSuccess }: ProposalFormProps) {
  const [title, setTitle] = useState('');
  const [scope, setScope] = useState('');
  const [price, setPrice] = useState('');
  const [deliveryPeriod, setDeliveryPeriod] = useState('');
  const [milestones, setMilestones] = useState<Milestone[]>([
    { name: '', description: '', duration: '', deliverables: [] },
  ]);
  const [acceptanceCriteria, setAcceptanceCriteria] = useState<string[]>(['']);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const addMilestone = () =>
    setMilestones((prev) => [
      ...prev,
      { name: '', description: '', duration: '', deliverables: [] },
    ]);

  const removeMilestone = (index: number) =>
    setMilestones((prev) => prev.filter((_, i) => i !== index));

  const updateMilestone = (index: number, field: keyof Milestone, value: string) =>
    setMilestones((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m)),
    );

  const addCriterion = () => setAcceptanceCriteria((prev) => [...prev, '']);
  const removeCriterion = (index: number) =>
    setAcceptanceCriteria((prev) => prev.filter((_, i) => i !== index));
  const updateCriterion = (index: number, value: string) =>
    setAcceptanceCriteria((prev) =>
      prev.map((c, i) => (i === index ? value : c)),
    );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/supplier/proposals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          demandId,
          title,
          scope,
          price: parseFloat(price) || 0,
          currency: 'CNY',
          deliveryPeriod,
          milestones: milestones.filter((m) => m.name.trim()),
          acceptanceCriteria: acceptanceCriteria.filter((c) => c.trim()),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '提交失败');
        return;
      }
      onSuccess();
    } catch {
      setError('网络错误，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Title */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          提案标题 <span className="text-red-500">*</span>
        </label>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="简要描述你的方案"
          className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-colors"
        />
      </div>

      {/* Scope */}
      <div>
        <label className="block text-sm font-medium text-foreground mb-1.5">
          方案范围 <span className="text-red-500">*</span>
        </label>
        <textarea
          required
          rows={4}
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          placeholder="详细描述方案范围、技术路线、实施计划等"
          className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-colors resize-none"
        />
      </div>

      {/* Price & Delivery Period */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            报价（元） <span className="text-red-500">*</span>
          </label>
          <input
            type="number"
            required
            min="0"
            step="0.01"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="请输入报价金额"
            className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-colors"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            交付周期
          </label>
          <input
            type="text"
            value={deliveryPeriod}
            onChange={(e) => setDeliveryPeriod(e.target.value)}
            placeholder="如 4周、2个月"
            className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-colors"
          />
        </div>
      </div>

      {/* Milestones */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-foreground">
            里程碑
          </label>
          <button
            type="button"
            onClick={addMilestone}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            添加里程碑
          </button>
        </div>
        <div className="space-y-3">
          {milestones.map((m, i) => (
            <div
              key={i}
              className="grid grid-cols-1 md:grid-cols-[1fr_1fr_100px_36px] gap-2 items-end"
            >
              <div>
                {i === 0 && (
                  <span className="text-xs text-muted">名称</span>
                )}
                <input
                  type="text"
                  value={m.name}
                  onChange={(e) => updateMilestone(i, 'name', e.target.value)}
                  placeholder="里程碑名称"
                  className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-colors"
                />
              </div>
              <div>
                {i === 0 && (
                  <span className="text-xs text-muted">描述</span>
                )}
                <input
                  type="text"
                  value={m.description}
                  onChange={(e) =>
                    updateMilestone(i, 'description', e.target.value)
                  }
                  placeholder="简要描述"
                  className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-colors"
                />
              </div>
              <div>
                {i === 0 && <span className="text-xs text-muted">周期</span>}
                <input
                  type="text"
                  value={m.duration}
                  onChange={(e) => updateMilestone(i, 'duration', e.target.value)}
                  placeholder="如 2周"
                  className="w-full rounded-lg border border-line bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-colors"
                />
              </div>
              {milestones.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeMilestone(i)}
                  className="h-[38px] inline-flex items-center justify-center rounded-lg border border-line text-muted hover:text-red-500 hover:border-red-200 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Acceptance Criteria */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="block text-sm font-medium text-foreground">
            验收标准
          </label>
          <button
            type="button"
            onClick={addCriterion}
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            添加标准
          </button>
        </div>
        <div className="space-y-2">
          {acceptanceCriteria.map((c, i) => (
            <div key={i} className="flex gap-2">
              <input
                type="text"
                value={c}
                onChange={(e) => updateCriterion(i, e.target.value)}
                placeholder={`验收标准 ${i + 1}`}
                className="flex-1 rounded-lg border border-line bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-colors"
              />
              {acceptanceCriteria.length > 1 && (
                <button
                  type="button"
                  onClick={() => removeCriterion(i)}
                  className="inline-flex items-center justify-center rounded-lg border border-line px-2 text-muted hover:text-red-500 hover:border-red-200 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Error message */}
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting}
        className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {submitting ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            提交中...
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            提交提案
          </>
        )}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Proposal Card (buyer view — received proposals)
// ---------------------------------------------------------------------------

interface ProposalCardProps {
  proposal: Proposal & {
    supplierOrgName?: string;
    supplierOrgLogo?: string | null;
  };
  onStatusChange: (id: string, status: 'accepted' | 'rejected') => void;
  loading: boolean;
}

function ProposalCard({ proposal, onStatusChange, loading }: ProposalCardProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-xl border border-line bg-white overflow-hidden transition-all duration-300 hover:shadow-[0_10px_26px_rgba(15,23,42,0.06)]">
      {/* Header */}
      <div
        className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Building2 className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-semibold text-foreground">
              {proposal.title}
            </h4>
            <p className="text-xs text-muted">
              {proposal.supplierOrgName ?? '供应商'} · {proposal.createdAt?.slice(0, 10) ?? ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={proposal.status} />
          <span className="text-sm font-bold text-foreground">
            ¥{proposal.price.toLocaleString()}
          </span>
          {expanded ? (
            <ChevronUp className="h-4 w-4 text-muted" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted" />
          )}
        </div>
      </div>

      {/* Expanded Details */}
      <div
        className={`overflow-hidden transition-all duration-300 ease-in-out ${
          expanded ? 'max-h-[800px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="border-t border-line p-4 space-y-4">
          {/* Scope */}
          {proposal.scope && (
            <div>
              <h5 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                方案范围
              </h5>
              <p className="text-sm text-foreground/80 leading-relaxed">
                {proposal.scope}
              </p>
            </div>
          )}

          {/* Delivery Period */}
          {proposal.deliveryPeriod && (
            <div>
              <h5 className="text-xs font-semibold text-muted uppercase tracking-wider mb-1">
                交付周期
              </h5>
              <p className="text-sm text-foreground/80">{proposal.deliveryPeriod}</p>
            </div>
          )}

          {/* Milestones */}
          {proposal.milestones.length > 0 && (
            <div>
              <h5 className="text-xs font-semibold text-muted uppercase tracking-wider mb-2">
                里程碑
              </h5>
              <div className="space-y-2">
                {proposal.milestones.map((m, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-lg bg-gray-50 p-3"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {i + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        {m.name}
                        {m.duration && (
                          <span className="ml-2 text-xs text-muted">
                            ({m.duration})
                          </span>
                        )}
                      </p>
                      {m.description && (
                        <p className="text-xs text-muted mt-0.5">
                          {m.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Action Buttons (only for reviewed/submitted proposals) */}
          {(proposal.status === 'reviewed' || proposal.status === 'submitted') && (
            <div className="flex gap-2 pt-2">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStatusChange(proposal.id, 'accepted');
                }}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white hover:bg-green-600 transition-colors disabled:opacity-50"
              >
                <CheckCircle className="h-4 w-4" />
                接受
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onStatusChange(proposal.id, 'rejected');
                }}
                disabled={loading}
                className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" />
                拒绝
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page Component
// ---------------------------------------------------------------------------

interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  orgId?: string;
  orgName?: string;
}

export default function DemandDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [demand, setDemand] = useState<Demand | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);

  const [proposals, setProposals] = useState<
    (Proposal & { supplierOrgName?: string; supplierOrgLogo?: string | null })[]
  >([]);
  const [proposalsLoading, setProposalsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  const [showProposalForm, setShowProposalForm] = useState(false);
  const [proposalSubmitted, setProposalSubmitted] = useState(false);

  // ---------- Fetch demand ----------
  const fetchDemand = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/demands/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          setError('not_found');
        } else {
          setError('加载失败');
        }
        return;
      }
      const data = await res.json();
      setDemand(data);
    } catch {
      setError('网络错误');
    } finally {
      setLoading(false);
    }
  }, [id]);

  // ---------- Fetch auth ----------
  const fetchAuth = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      const data = await res.json();
      setAuthUser(data.user ?? null);
    } catch {
      setAuthUser(null);
    } finally {
      setAuthChecked(true);
    }
  }, []);

  // ---------- Fetch proposals (buyer view) ----------
  const fetchProposals = useCallback(async () => {
    if (!authUser || !demand) return;
    const isBuyerOwner =
      demand.ownerUser === authUser.name ||
      (demand as Demand & { ownerUserId?: string }).ownerUser === undefined;

    // Only fetch if user is admin/opc or likely the buyer owner
    const isAdmin = ['admin', 'opc_team', 'operator'].includes(authUser.role);
    if (!isAdmin && authUser.role !== 'buyer') return;

    setProposalsLoading(true);
    try {
      const res = await fetch(`/api/demands/${id}/proposals`);
      if (res.ok) {
        const data = await res.json();
        setProposals(Array.isArray(data) ? data : data.data ?? []);
      }
    } catch {
      // silently fail
    } finally {
      setProposalsLoading(false);
    }
  }, [authUser, demand, id]);

  useEffect(() => {
    fetchDemand();
    fetchAuth();
  }, [fetchDemand, fetchAuth]);

  useEffect(() => {
    if (authChecked && demand) {
      fetchProposals();
    }
  }, [authChecked, demand, fetchProposals]);

  // ---------- Proposal status change ----------
  const handleProposalStatusChange = async (
    proposalId: string,
    status: 'accepted' | 'rejected',
  ) => {
    setActionLoading(true);
    try {
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (res.ok) {
        // Refresh proposals and demand
        await fetchProposals();
        await fetchDemand();
      }
    } catch {
      // silently fail
    } finally {
      setActionLoading(false);
    }
  };

  // ---------- Derived state ----------
  const isSupplier = authUser?.role === 'supplier';
  const isAdmin = authUser
    ? ['admin', 'opc_team', 'operator'].includes(authUser.role)
    : false;
  const isBuyer = authUser?.role === 'buyer';
  const canSubmitProposal =
    isSupplier &&
    demand?.status === 'collecting_proposals';
  const canViewProposals = isAdmin || isBuyer;

  // ---------- Loading state ----------
  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-20 flex flex-col items-center justify-center animate-fade-up">
        <Loader2 className="h-8 w-8 text-primary animate-spin mb-4" />
        <p className="text-sm text-muted">加载中...</p>
      </div>
    );
  }

  // ---------- Not found state ----------
  if (error === 'not_found' || !demand) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-20 text-center animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground mb-2">需求未找到</h1>
        <p className="text-sm text-muted mb-6">
          该需求不存在或已被删除。
        </p>
        <Link
          href="/demands"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回需求大厅
        </Link>
      </div>
    );
  }

  // ---------- Error state ----------
  if (error) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-20 text-center animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground mb-2">加载失败</h1>
        <p className="text-sm text-muted mb-6">{error}</p>
        <Link
          href="/demands"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回需求大厅
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 animate-fade-up">
      {/* Back Nav */}
      <Link
        href="/demands"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        返回需求大厅
      </Link>

      {/* Title + Status */}
      <div className="flex items-center gap-3 mb-8">
        <h1 className="text-2xl font-bold text-foreground">{demand.title}</h1>
        <StatusBadge status={demand.status} />
      </div>

      {/* Two Column Layout */}
      <TwoColumn
        main={
          <>
            <DetailBlock title="业务背景">
              <p className="text-sm text-muted leading-relaxed">
                {demand.description
                  ? demand.description
                  : demand.painPoints
                    ? demand.painPoints
                    : '暂无详细业务背景描述。'}
              </p>
            </DetailBlock>

            <DetailBlock title="数据与系统现状">
              <InfoRows
                rows={[
                  ['数据类型', demand.dataTypes.join('、')],
                  ['部署要求', demand.deploymentRequirement],
                  ['现有系统', demand.existingSystems || '暂无'],
                  ['痛点', demand.painPoints || '暂无'],
                ]}
              />
            </DetailBlock>

            <DetailBlock title="验收指标">
              <InfoRows
                rows={[
                  ['支持POC', demand.supportPoc ? '需要 POC 验证' : '不需要'],
                  ['允许AI供应商', demand.allowAiSupplier ? '是' : '否'],
                  ['预算范围', demand.budgetRange],
                  ['交付周期', demand.deliveryPeriod],
                ]}
              />
            </DetailBlock>

            {/* ---------- Proposal Section ---------- */}
            {authChecked && (
              <>
                {/* Supplier: Submit Proposal */}
                {canSubmitProposal && (
                  <DetailBlock title="提交提案">
                    {proposalSubmitted ? (
                      <div className="flex flex-col items-center py-6 text-center">
                        <CheckCircle className="h-10 w-10 text-green mb-3" />
                        <h3 className="text-base font-semibold text-foreground mb-1">
                          提案已提交
                        </h3>
                        <p className="text-sm text-muted">
                          你的提案已成功提交，需求方将会审核。
                        </p>
                      </div>
                    ) : (
                      <>
                        {!showProposalForm ? (
                          <div className="text-center py-4">
                            <button
                              type="button"
                              onClick={() => setShowProposalForm(true)}
                              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                            >
                              <FileText className="h-4 w-4" />
                              填写提案
                            </button>
                          </div>
                        ) : (
                          <ProposalForm
                            demandId={id}
                            onSuccess={() => {
                              setShowProposalForm(false);
                              setProposalSubmitted(true);
                            }}
                          />
                        )}
                      </>
                    )}
                  </DetailBlock>
                )}

                {/* Not logged in */}
                {!authUser && (
                  <DetailBlock title="提交提案">
                    <div className="text-center py-4">
                      <p className="text-sm text-muted mb-3">
                        登录后可提交提案
                      </p>
                      <Link
                        href="/login"
                        className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
                      >
                        登录
                      </Link>
                    </div>
                  </DetailBlock>
                )}

                {/* Logged in but not supplier and demand is collecting_proposals */}
                {authUser && !isSupplier && !canViewProposals && demand.status === 'collecting_proposals' && (
                  <DetailBlock title="提交提案">
                    <div className="text-center py-4">
                      <p className="text-sm text-muted">
                        仅供应商角色可以提交提案
                      </p>
                    </div>
                  </DetailBlock>
                )}

                {/* Buyer/Admin: Received Proposals */}
                {canViewProposals && (
                  <DetailBlock title="收到的提案">
                    {proposalsLoading ? (
                      <div className="flex items-center justify-center py-8">
                        <Loader2 className="h-6 w-6 text-primary animate-spin" />
                      </div>
                    ) : proposals.length === 0 ? (
                      <div className="text-center py-6">
                        <FileText className="h-8 w-8 text-muted/40 mx-auto mb-2" />
                        <p className="text-sm text-muted">暂无提案</p>
                      </div>
                    ) : (
                      <div className="space-y-3">
                        {proposals.map((p) => (
                          <ProposalCard
                            key={p.id}
                            proposal={p}
                            onStatusChange={handleProposalStatusChange}
                            loading={actionLoading}
                          />
                        ))}
                      </div>
                    )}
                  </DetailBlock>
                )}
              </>
            )}
          </>
        }
        side={
          <>
            <Panel
              title="需求摘要"
              items={[
                `行业：${demand.industry}`,
                `预算：${demand.budgetRange}`,
                `周期：${demand.deliveryPeriod}`,
                `POC：${demand.supportPoc ? '需要' : '不需要'}`,
                `匹配度：${demand.matchScore || '--'}`,
                `状态：${STATUS_LABELS[demand.status] ?? demand.status}`,
                `发布日期：${demand.createdAt?.slice(0, 10) ?? ''}`,
              ]}
            />

            <div className="bg-panel border border-line rounded-xl p-6 mt-5 shadow-[0_10px_26px_rgba(15,23,42,0.04)]">
              <h3 className="text-base font-bold mb-3">数据类型</h3>
              <TagCloud tags={demand.dataTypes} />
              <div className="mt-4 flex gap-2">
                <Link
                  href="/match"
                  className="flex-1 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
                >
                  查看匹配结果
                </Link>
                {canSubmitProposal && !showProposalForm && !proposalSubmitted && (
                  <button
                    type="button"
                    onClick={() => setShowProposalForm(true)}
                    className="flex-1 inline-flex items-center justify-center rounded-xl border border-line px-4 py-2 text-sm font-medium text-muted hover:border-primary/30 hover:text-primary transition-colors"
                  >
                    我要报价
                  </button>
                )}
              </div>
            </div>
          </>
        }
      />
    </div>
  );
}
