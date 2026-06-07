'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Upload } from 'lucide-react';

export default function PublishProductPage() {
  const router = useRouter();

  // Form state
  const [name, setName] = useState('');
  const [summary, setSummary] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [capabilityTags, setCapabilityTags] = useState('');
  const [industryTags, setIndustryTags] = useState<string[]>([]);
  const [deploymentModes, setDeploymentModes] = useState<string[]>([]);
  const [pricingModel, setPricingModel] = useState('');
  const [price, setPrice] = useState('');
  const [supportPoc, setSupportPoc] = useState(false);

  // UI state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');

    // Validate required fields
    if (!name.trim()) {
      setError('请输入产品名称');
      return;
    }
    if (!summary.trim()) {
      setError('请输入产品摘要');
      return;
    }
    if (!category) {
      setError('请选择产品类别');
      return;
    }

    setLoading(true);

    try {
      const body = {
        name: name.trim(),
        summary: summary.trim(),
        description: description.trim() || undefined,
        category,
        capabilityTags: capabilityTags
          .split(/[,，]/)
          .map((t) => t.trim())
          .filter(Boolean),
        industryTags: industryTags.length > 0 ? industryTags : undefined,
        deploymentModes: deploymentModes.length > 0 ? deploymentModes : undefined,
        pricingModel: pricingModel || undefined,
        price: price.trim() || undefined,
        supportPoc,
        status: 'pending_review',
      };

      const res = await fetch('/api/supplier/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || '提交失败，请稍后重试');
        return;
      }

      // Success: redirect to dashboard products
      router.push('/dashboard/products');
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  function toggleArrayItem(arr: string[], item: string): string[] {
    return arr.includes(item) ? arr.filter((v) => v !== item) : [...arr, item];
  }

  return (
    <section className="mx-auto max-w-3xl px-6 py-10 animate-fade-up">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground mb-1">发布AI产品</h1>
        <p className="text-sm text-muted">
          填写产品信息，提交审核后将在平台展示。
        </p>
      </div>

      {/* Upload Area */}
      <div className="mb-8 flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed border-line bg-slate-50/50 py-16 hover:border-primary/40 transition-colors cursor-pointer">
        <Upload className="h-10 w-10 text-muted" />
        <p className="text-sm text-muted">
          点击或拖拽上传产品封面图（支持 PNG、JPG，建议 1200x630px）
        </p>
      </div>

      {/* Error message */}
      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* Form Fields */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* 2-column grid */}
        <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
          {/* Product Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              产品名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="请输入产品名称"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              产品类别 <span className="text-red-500">*</span>
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all bg-white"
            >
              <option value="">请选择</option>
              <option value="智能对话">智能对话</option>
              <option value="知识库">知识库</option>
              <option value="文档处理">文档处理</option>
              <option value="数据分析">数据分析</option>
              <option value="视觉识别">视觉识别</option>
              <option value="语音处理">语音处理</option>
              <option value="流程自动化">流程自动化</option>
              <option value="其他">其他</option>
            </select>
          </div>

          {/* Capability Tags */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              能力标签
            </label>
            <input
              type="text"
              placeholder="如：RAG, Agent, OCR"
              value={capabilityTags}
              onChange={(e) => setCapabilityTags(e.target.value)}
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
            />
          </div>

          {/* Deployment Mode */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              部署方式
            </label>
            <div className="flex flex-wrap gap-2">
              {(['saas', 'private_cloud', 'on_premise', 'hybrid'] as const).map(
                (mode) => {
                  const labels: Record<string, string> = {
                    saas: 'SaaS',
                    private_cloud: '私有云',
                    on_premise: '本地化',
                    hybrid: '混合',
                  };
                  const active = deploymentModes.includes(mode);
                  return (
                    <button
                      key={mode}
                      type="button"
                      onClick={() =>
                        setDeploymentModes(toggleArrayItem(deploymentModes, mode))
                      }
                      className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                        active
                          ? 'border-primary bg-primary/10 text-primary'
                          : 'border-line text-foreground hover:border-primary/30'
                      }`}
                    >
                      {labels[mode]}
                    </button>
                  );
                },
              )}
            </div>
          </div>

          {/* Pricing Model */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              价格模式
            </label>
            <select
              value={pricingModel}
              onChange={(e) => setPricingModel(e.target.value)}
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all bg-white"
            >
              <option value="">请选择</option>
              <option value="subscription">订阅制</option>
              <option value="per_project">按项目</option>
              <option value="per_seat">按席位</option>
              <option value="pay_per_use">按量计费</option>
              <option value="custom">自定义</option>
            </select>
          </div>

          {/* Price */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              价格说明
            </label>
            <input
              type="text"
              placeholder="如：¥999/月"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
            />
          </div>

          {/* Industry */}
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-foreground mb-1.5">
              适用行业
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  ['manufacturing', '制造业'],
                  ['government', '政务'],
                  ['finance', '金融'],
                  ['education', '教育'],
                  ['research', '科研'],
                  ['healthcare', '医疗'],
                  ['retail', '零售'],
                  ['energy', '能源'],
                  ['industrial_software', '工业软件'],
                ] as const
              ).map(([value, label]) => {
                const active = industryTags.includes(value);
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() =>
                      setIndustryTags(toggleArrayItem(industryTags, value))
                    }
                    className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                      active
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-line text-foreground hover:border-primary/30'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* POC Support */}
          <div className="md:col-span-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={supportPoc}
                onChange={(e) => setSupportPoc(e.target.checked)}
                className="h-4 w-4 rounded border-line text-primary focus:ring-primary/10"
              />
              <span className="text-sm font-medium text-foreground">
                支持POC验证
              </span>
            </label>
          </div>
        </div>

        {/* Wide Textarea */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            产品摘要 <span className="text-red-500">*</span>
          </label>
          <textarea
            rows={5}
            placeholder="请简要描述产品的核心能力、适用场景和关键优势..."
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all resize-none"
          />
        </div>

        {/* Description */}
        <div>
          <label className="block text-sm font-medium text-foreground mb-1.5">
            详细描述
          </label>
          <textarea
            rows={6}
            placeholder="请详细描述产品功能、技术架构、使用场景等..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all resize-none"
          />
        </div>

        {/* Submit */}
        <div className="flex items-center gap-4 pt-2">
          <button
            type="submit"
            disabled={loading}
            className="rounded-xl bg-primary px-8 py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? '提交中...' : '提交审核'}
          </button>
          <Link
            href="/products"
            className="rounded-xl border border-line px-6 py-3 text-sm font-semibold text-foreground hover:border-primary/30 transition-colors"
          >
            取消
          </Link>
        </div>
      </form>
    </section>
  );
}
