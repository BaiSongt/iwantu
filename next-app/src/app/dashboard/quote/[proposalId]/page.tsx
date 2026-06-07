'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Calculator,
  FileText,
  Check,
  Save,
  Plus,
  Trash2,
  ArrowLeft,
  Loader2,
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

interface EditableQuoteItem {
  id: string; // local temp ID for React keys
  name: string;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  totalPrice: number;
}

interface EditableMilestone extends Milestone {
  id: string; // local temp ID for React keys
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

let _tempIdCounter = 0;
function tempId(): string {
  return `temp_${++_tempIdCounter}_${Date.now()}`;
}

function formatPrice(value: number): string {
  return value.toLocaleString('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* ------------------------------------------------------------------ */
/*  Skeleton                                                           */
/* ------------------------------------------------------------------ */

function Skeleton() {
  return (
    <div className="animate-fade-up space-y-6">
      <div className="h-8 w-64 rounded-lg bg-gray-100 animate-pulse" />
      <div className="rounded-2xl border border-line bg-white p-6 space-y-4">
        <div className="h-5 w-40 rounded bg-gray-100 animate-pulse" />
        <div className="h-4 w-full rounded bg-gray-50 animate-pulse" />
        <div className="h-4 w-3/4 rounded bg-gray-50 animate-pulse" />
      </div>
      <div className="rounded-2xl border border-line bg-white p-6">
        <div className="h-40 rounded bg-gray-50 animate-pulse" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Quote Item Row                                                     */
/* ------------------------------------------------------------------ */

function QuoteItemRow({
  item,
  index,
  onChange,
  onRemove,
}: {
  item: EditableQuoteItem;
  index: number;
  onChange: (index: number, field: keyof EditableQuoteItem, value: string | number) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="flex items-start gap-2 border-b border-line/60 px-4 py-3 last:border-0">
      <span className="mt-2 text-xs font-medium text-muted w-6 shrink-0 text-center">
        {index + 1}
      </span>

      {/* Name */}
      <input
        type="text"
        value={item.name}
        onChange={(e) => onChange(index, 'name', e.target.value)}
        placeholder="名称"
        className="w-32 shrink-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
      />

      {/* Description */}
      <input
        type="text"
        value={item.description}
        onChange={(e) => onChange(index, 'description', e.target.value)}
        placeholder="描述"
        className="flex-1 min-w-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
      />

      {/* Quantity */}
      <input
        type="number"
        min={1}
        value={item.quantity}
        onChange={(e) => onChange(index, 'quantity', parseInt(e.target.value) || 1)}
        className="w-20 shrink-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-foreground text-right focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
      />

      {/* Unit */}
      <input
        type="text"
        value={item.unit}
        onChange={(e) => onChange(index, 'unit', e.target.value)}
        className="w-16 shrink-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-foreground text-center focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
      />

      {/* Unit price */}
      <input
        type="number"
        min={0}
        step={0.01}
        value={item.unitPrice}
        onChange={(e) => onChange(index, 'unitPrice', parseFloat(e.target.value) || 0)}
        className="w-28 shrink-0 rounded-lg border border-line bg-white px-2.5 py-1.5 text-sm text-foreground text-right focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
      />

      {/* Total price (auto-calculated, read-only) */}
      <div className="w-28 shrink-0 px-2.5 py-1.5 text-sm text-foreground text-right font-medium">
        {formatPrice(item.totalPrice)}
      </div>

      {/* Remove */}
      <button
        onClick={() => onRemove(index)}
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-muted hover:text-red-600 hover:bg-red-50 transition-colors"
        title="删除行"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Milestone Editor Row                                               */
/* ------------------------------------------------------------------ */

function MilestoneRow({
  milestone,
  index,
  onChange,
  onRemove,
}: {
  milestone: EditableMilestone;
  index: number;
  onChange: (index: number, field: string, value: string | string[]) => void;
  onRemove: (index: number) => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-white p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
            {index + 1}
          </div>
          <input
            type="text"
            value={milestone.name}
            onChange={(e) => onChange(index, 'name', e.target.value)}
            placeholder="里程碑名称"
            className="rounded-lg border border-line px-2.5 py-1 text-sm font-medium text-foreground placeholder:text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
          />
        </div>
        <button
          onClick={() => onRemove(index)}
          className="flex h-6 w-6 items-center justify-center rounded-lg text-muted hover:text-red-600 hover:bg-red-50 transition-colors"
          title="删除里程碑"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <textarea
        value={milestone.description}
        onChange={(e) => onChange(index, 'description', e.target.value)}
        placeholder="描述"
        rows={2}
        className="w-full rounded-lg border border-line px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 resize-none transition-colors"
      />

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted">工期:</span>
          <input
            type="text"
            value={milestone.duration}
            onChange={(e) => onChange(index, 'duration', e.target.value)}
            placeholder="2 周"
            className="w-24 rounded-lg border border-line px-2 py-1 text-sm text-foreground placeholder:text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
          />
        </div>
        <div className="flex items-center gap-1.5 flex-1">
          <span className="text-xs text-muted">交付物:</span>
          <input
            type="text"
            value={milestone.deliverables.join(', ')}
            onChange={(e) => onChange(index, 'deliverables', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
            placeholder="交付物1, 交付物2"
            className="flex-1 rounded-lg border border-line px-2 py-1 text-sm text-foreground placeholder:text-muted/50 focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
          />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function QuoteBuilderPage({
  params,
}: {
  params: Promise<{ proposalId: string }>;
}) {
  const [proposalId, setProposalId] = useState<string>('');
  const [proposal, setProposal] = useState<ProposalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable state
  const [quoteItems, setQuoteItems] = useState<EditableQuoteItem[]>([]);
  const [milestones, setMilestones] = useState<EditableMilestone[]>([]);

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
        const data = json.data ?? json;
        setProposal(data);

        // Initialize editable quote items
        setQuoteItems(
          (data.quoteItems ?? []).length > 0
            ? data.quoteItems.map((q: QuoteItem) => ({
                id: tempId(),
                name: q.name,
                description: q.description,
                quantity: q.quantity,
                unit: q.unit,
                unitPrice: q.unitPrice,
                totalPrice: q.totalPrice,
              }))
            : [{
                id: tempId(),
                name: '',
                description: '',
                quantity: 1,
                unit: '项',
                unitPrice: 0,
                totalPrice: 0,
              }],
        );

        // Initialize editable milestones
        setMilestones(
          (data.milestones ?? []).map((m: Milestone) => ({
            id: tempId(),
            name: m.name,
            description: m.description,
            duration: m.duration,
            deliverables: m.deliverables,
          })),
        );
      } else {
        setError('加载提案失败');
      }
    } catch {
      setError('加载提案失败');
    } finally {
      setLoading(false);
    }
  }, [proposalId]);

  useEffect(() => {
    fetchProposal();
  }, [fetchProposal]);

  // ---- Quote item handlers ----

  function handleQuoteChange(
    index: number,
    field: keyof EditableQuoteItem,
    value: string | number,
  ) {
    setQuoteItems((prev) => {
      const updated = [...prev];
      const item = { ...updated[index], [field]: value };

      // Auto-calculate total
      if (field === 'quantity' || field === 'unitPrice') {
        item.totalPrice = item.quantity * item.unitPrice;
      }

      updated[index] = item;
      return updated;
    });
  }

  function addQuoteItem() {
    setQuoteItems((prev) => [
      ...prev,
      { id: tempId(), name: '', description: '', quantity: 1, unit: '项', unitPrice: 0, totalPrice: 0 },
    ]);
  }

  function removeQuoteItem(index: number) {
    setQuoteItems((prev) => prev.filter((_, i) => i !== index));
  }

  // ---- Milestone handlers ----

  function handleMilestoneChange(index: number, field: string, value: string | string[]) {
    setMilestones((prev) => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      return updated;
    });
  }

  function addMilestone() {
    setMilestones((prev) => [
      ...prev,
      { id: tempId(), name: '', description: '', duration: '', deliverables: [] },
    ]);
  }

  function removeMilestone(index: number) {
    setMilestones((prev) => prev.filter((_, i) => i !== index));
  }

  // ---- Computed ----

  const grandTotal = quoteItems.reduce((sum, q) => sum + q.totalPrice, 0);

  // ---- Save handler ----

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteItems: quoteItems.map((q) => ({
            name: q.name,
            description: q.description,
            quantity: q.quantity,
            unit: q.unit,
            unitPrice: q.unitPrice,
            totalPrice: q.totalPrice,
          })),
          milestones: milestones.map((m) => ({
            name: m.name,
            description: m.description,
            duration: m.duration,
            deliverables: m.deliverables,
          })),
          price: grandTotal,
        }),
      });

      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || '保存失败');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }

  // ---- Submit handler (save + change status to reviewed) ----

  async function handleSubmit() {
    // Validate: all items should have a name
    const hasEmpty = quoteItems.some((q) => !q.name.trim());
    if (hasEmpty) {
      setError('请填写所有报价项名称');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      // First save
      const saveRes = await fetch(`/api/proposals/${proposalId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteItems: quoteItems.map((q) => ({
            name: q.name,
            description: q.description,
            quantity: q.quantity,
            unit: q.unit,
            unitPrice: q.unitPrice,
            totalPrice: q.totalPrice,
          })),
          milestones: milestones.map((m) => ({
            name: m.name,
            description: m.description,
            duration: m.duration,
            deliverables: m.deliverables,
          })),
          price: grandTotal,
          status: 'submitted',
        }),
      });

      if (!saveRes.ok) {
        const json = await saveRes.json().catch(() => ({}));
        throw new Error(json.error || '提交失败');
      }

      // Refresh proposal data
      await fetchProposal();
    } catch (err) {
      setError(err instanceof Error ? err.message : '提交失败');
    } finally {
      setSubmitting(false);
    }
  }

  // ---- Render ----

  if (loading) return <Skeleton />;
  if (error && !proposal) {
    return (
      <div className="animate-fade-up">
        <div className="rounded-2xl border border-line bg-white p-12 text-center">
          <p className="text-sm text-red-600 mb-4">{error}</p>
          <Link
            href="/dashboard/leads"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            返回需求列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/dashboard/leads"
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-line text-muted hover:text-foreground hover:bg-gray-50 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Calculator className="h-6 w-6 text-primary" />
              报价编辑器
            </h2>
            <p className="mt-0.5 text-sm text-muted">
              {proposal?.title ?? '加载中...'}
            </p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving || submitting}
            className="inline-flex items-center gap-2 rounded-xl border border-line bg-white px-5 py-2.5 text-sm font-bold text-foreground transition-all duration-160 hover:-translate-y-0.5 hover:border-[#bfdbfe] hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)] disabled:opacity-50 disabled:pointer-events-none"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            保存报价
          </button>
          <button
            onClick={handleSubmit}
            disabled={saving || submitting || proposal?.status === 'submitted' || proposal?.status === 'reviewed'}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white transition-all duration-160 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)] disabled:opacity-50 disabled:pointer-events-none"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
            提交报价
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Proposal status badge */}
      {proposal && (
        <div className="mb-4">
          <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-xs font-semibold ${
            proposal.status === 'draft' ? 'bg-gray-100 text-gray-600' :
            proposal.status === 'submitted' ? 'bg-blue-50 text-blue-700' :
            proposal.status === 'reviewed' ? 'bg-amber-50 text-amber-700' :
            proposal.status === 'accepted' ? 'bg-emerald-50 text-emerald-700' :
            'bg-gray-100 text-gray-600'
          }`}>
            {proposal.status === 'draft' ? '草稿' :
             proposal.status === 'submitted' ? '已提交' :
             proposal.status === 'reviewed' ? '已审核' :
             proposal.status === 'accepted' ? '已接受' :
             proposal.status === 'rejected' ? '已拒绝' : proposal.status}
          </span>
        </div>
      )}

      {/* Demand info card */}
      {proposal && (
        <div className="mb-6 rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-3">
            <FileText className="h-5 w-5 text-primary" />
            需求信息
          </h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <span className="text-xs text-muted">提案标题</span>
              <p className="text-sm font-medium text-foreground">{proposal.title}</p>
            </div>
            <div>
              <span className="text-xs text-muted">需求ID</span>
              <p className="text-sm font-medium text-foreground">{proposal.demandId}</p>
            </div>
            <div>
              <span className="text-xs text-muted">交付周期</span>
              <p className="text-sm font-medium text-foreground">{proposal.deliveryPeriod || '-'}</p>
            </div>
            <div>
              <span className="text-xs text-muted">创建时间</span>
              <p className="text-sm font-medium text-foreground">{proposal.createdAt}</p>
            </div>
          </div>
          {proposal.scope && (
            <div className="mt-3">
              <span className="text-xs text-muted">方案范围</span>
              <p className="mt-1 text-sm text-foreground leading-relaxed">{proposal.scope}</p>
            </div>
          )}
        </div>
      )}

      {/* Quote items table */}
      <div className="mb-6 rounded-2xl border border-line bg-white shadow-[0_8px_40px_rgba(15,23,42,0.08)] overflow-hidden">
        {/* Table header */}
        <div className="flex items-center gap-2 border-b border-line bg-[#f8fafc] px-4 py-3 text-xs font-semibold text-muted">
          <span className="w-6 text-center">#</span>
          <span className="w-32 shrink-0">名称</span>
          <span className="flex-1">描述</span>
          <span className="w-20 shrink-0 text-right">数量</span>
          <span className="w-16 shrink-0 text-center">单位</span>
          <span className="w-28 shrink-0 text-right">单价</span>
          <span className="w-28 shrink-0 text-right">总价</span>
          <span className="w-7" />
        </div>

        {/* Rows */}
        <div>
          {quoteItems.map((item, idx) => (
            <QuoteItemRow
              key={item.id}
              item={item}
              index={idx}
              onChange={handleQuoteChange}
              onRemove={removeQuoteItem}
            />
          ))}
        </div>

        {/* Add row button */}
        <div className="px-4 py-3 border-t border-line/60">
          <button
            onClick={addQuoteItem}
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            添加报价项
          </button>
        </div>

        {/* Grand total */}
        <div className="flex items-center justify-between border-t-2 border-line px-4 py-4 bg-[#f8fafc]">
          <span className="text-sm font-bold text-foreground">合计</span>
          <span className="text-xl font-bold text-primary">
            {formatPrice(grandTotal)} CNY
          </span>
        </div>
      </div>

      {/* Milestones editor */}
      <div className="mb-6 rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
        <div className="flex items-center justify-between mb-4">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
            <FileText className="h-5 w-5 text-primary" />
            里程碑计划
          </h3>
          <button
            onClick={addMilestone}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-foreground hover:bg-gray-50 transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            添加里程碑
          </button>
        </div>

        {milestones.length === 0 ? (
          <p className="text-sm text-muted text-center py-6">暂无里程碑，点击上方按钮添加</p>
        ) : (
          <div className="space-y-3">
            {milestones.map((m, idx) => (
              <MilestoneRow
                key={m.id}
                milestone={m}
                index={idx}
                onChange={handleMilestoneChange}
                onRemove={removeMilestone}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
