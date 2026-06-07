'use client';

import { useRouter } from 'next/navigation';
import { useState, useCallback } from 'react';
import { Sparkles, WandSparkles, Send, CheckCircle, AlertCircle, Lightbulb, Loader2, XCircle } from 'lucide-react';

const FORM_FIELDS = [
  { label: '联系人', key: 'contact', placeholder: '请输入联系人姓名' },
  { label: '联系方式', key: 'phone', placeholder: '手机号或邮箱' },
  { label: '部署要求', key: 'deploy', placeholder: 'SaaS / 私有云 / 本地化' },
  { label: '是否需要POC', key: 'poc', placeholder: '是 / 否' },
  { label: '数据类型', key: 'dataType', placeholder: '如 Word、PDF、Excel 等' },
  { label: '数据规模', key: 'dataScale', placeholder: '如 5000份文档、10GB 等' },
  { label: '系统集成', key: 'integration', placeholder: '需对接的系统，如OA、ERP等' },
  { label: '期望周期', key: 'period', placeholder: '如 1个月、3个月' },
  { label: '能力类型', key: 'capability', placeholder: '如 知识库问答、OCR、Agent' },
  { label: '预算范围', key: 'budget', placeholder: '如 10-30万' },
  { label: '需求标题', key: 'title', placeholder: '简要描述你的AI需求' },
  { label: '行业场景', key: 'industry', placeholder: '如 制造业、金融、教育' },
];

const AI_SUGGESTIONS = [
  { icon: <CheckCircle className="h-4 w-4 text-green" />, text: '已识别行业：制造业' },
  { icon: <CheckCircle className="h-4 w-4 text-green" />, text: '已提取预算范围' },
  { icon: <AlertCircle className="h-4 w-4 text-orange" />, text: '建议补充数据规模描述' },
  { icon: <AlertCircle className="h-4 w-4 text-orange" />, text: '建议说明现有系统环境' },
  { icon: <Lightbulb className="h-4 w-4 text-primary" />, text: '可添加验收标准以提高匹配精度' },
];

type FormState = Record<string, string>;

export default function PublishDemandPage() {
  const router = useRouter();
  const [form, setForm] = useState<FormState>({});
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const showToast = useCallback(
    (type: 'success' | 'error', message: string) => {
      setToast({ type, message });
      setTimeout(() => setToast(null), 3000);
    },
    [],
  );

  const handleFieldChange = (key: string, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    // Validation
    if (!form.title?.trim()) {
      showToast('error', '请输入需求标题');
      return;
    }
    if (!form.industry?.trim()) {
      showToast('error', '请选择行业场景');
      return;
    }
    if (!description.trim()) {
      showToast('error', '请填写需求详细描述');
      return;
    }

    setSubmitting(true);

    try {
      // Map form fields to API shape
      const pocValue = form.poc?.trim();
      const supportPoc = pocValue === '是' || pocValue === 'true' || pocValue === '1';

      // Parse dataType string into array (comma or Chinese comma separated)
      const dataTypes = form.dataType
        ? form.dataType.split(/[,，、]/).map((s) => s.trim()).filter(Boolean)
        : [];

      const payload = {
        title: form.title.trim(),
        industry: form.industry.trim(),
        budgetRange: form.budget?.trim() ?? '',
        deliveryPeriod: form.period?.trim() ?? '',
        deploymentRequirement: form.deploy?.trim() ?? '',
        dataTypes,
        supportPoc,
        description: description.trim(),
        painPoints: '',
        existingSystems: form.integration?.trim() ?? '',
        allowAiSupplier: true,
      };

      const res = await fetch('/api/demands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '发布失败');
      }

      const result = await res.json();
      showToast('success', '需求发布成功！');

      // Redirect to the new demand detail page or dashboard
      const newId = result?.id;
      setTimeout(() => {
        if (newId) {
          router.push(`/demands/${newId}`);
        } else {
          router.push('/dashboard/demands');
        }
      }, 1000);
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '发布失败，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 animate-fade-up">
      <h1 className="text-2xl font-bold text-foreground mb-1">发布AI需求</h1>
      <p className="text-sm text-muted mb-8">填写需求信息，AI助手将帮助你完善需求描述，提高匹配精度。</p>

      {/* Toast */}
      {toast && (
        <div
          className={`mb-6 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-green/10 text-green border border-green/20'
              : 'bg-red-50 text-red-600 border border-red-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          {toast.message}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Form */}
        <div className="lg:col-span-2 space-y-6">
          {/* Action Buttons Row */}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl bg-violet/10 px-4 py-2.5 text-sm font-medium text-violet hover:bg-violet/20 transition-colors"
            >
              <Sparkles className="h-4 w-4" />
              AI帮我完善需求
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-xl bg-primary/10 px-4 py-2.5 text-sm font-medium text-primary hover:bg-primary/20 transition-colors"
            >
              <WandSparkles className="h-4 w-4" />
              生成标准需求书
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {submitting ? '发布中...' : '发布需求'}
            </button>
          </div>

          {/* Form Card */}
          <div className="bg-white rounded-xl border border-line p-6 animate-soft-pop">
            <h2 className="text-base font-semibold text-foreground mb-5">需求信息</h2>

            {/* 2-Column Field Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              {FORM_FIELDS.map((field) => (
                <div key={field.key}>
                  <label className="block text-sm font-medium text-foreground mb-1.5">
                    {field.label}
                  </label>
                  <input
                    type="text"
                    value={form[field.key] ?? ''}
                    onChange={(e) => handleFieldChange(field.key, e.target.value)}
                    placeholder={field.placeholder}
                    className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-colors"
                  />
                </div>
              ))}
            </div>

            {/* Wide Textarea */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                需求详细描述
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={6}
                placeholder="请详细描述你的业务场景、痛点、期望效果等..."
                className="w-full rounded-lg border border-line bg-background px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/10 transition-colors resize-none"
              />
            </div>
          </div>
        </div>

        {/* Right: AI Assistant (Sticky) */}
        <div className="lg:col-span-1">
          <div className="sticky top-24 space-y-4">
            <div className="bg-white rounded-xl border border-line p-5 animate-soft-pop">
              <div className="flex items-center gap-2 mb-4">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet/10 text-violet">
                  <Sparkles className="h-4 w-4" />
                </div>
                <h3 className="text-base font-semibold text-foreground">AI需求澄清助手</h3>
              </div>

              {/* Progress Bar */}
              <div className="mb-2">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-muted">需求完整度</span>
                  <span className="text-sm font-bold text-primary">72%</span>
                </div>
                <div className="h-2 w-full rounded-full bg-primary/10">
                  <div
                    className="h-2 rounded-full bg-gradient-to-r from-primary to-violet animate-progress"
                    style={{ width: '72%', transformOrigin: 'left' }}
                  />
                </div>
              </div>

              {/* Suggestions */}
              <div className="mt-5 space-y-3">
                <h4 className="text-xs font-semibold text-muted uppercase tracking-wider">完善建议</h4>
                {AI_SUGGESTIONS.map((s, i) => (
                  <div key={i} className="flex items-start gap-2 text-sm text-foreground/80">
                    <span className="mt-0.5 shrink-0">{s.icon}</span>
                    <span>{s.text}</span>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="mt-5 flex gap-2">
                <button
                  type="button"
                  className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-gradient-to-r from-primary to-violet px-3 py-2.5 text-xs font-bold text-white hover:opacity-90 transition-opacity"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  一键优化
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
