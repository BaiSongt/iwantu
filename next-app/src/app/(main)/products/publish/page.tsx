'use client';

import Link from 'next/link';
import { Upload } from 'lucide-react';

export default function PublishProductPage() {
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

      {/* Form Fields */}
      <div className="space-y-6">
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
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
            />
          </div>

          {/* Company Name */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              公司名称 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              placeholder="请输入公司名称"
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
            />
          </div>

          {/* Capability Tags */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              能力标签
            </label>
            <input
              type="text"
              placeholder="如：RAG, Agent, OCR"
              className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all"
            />
          </div>

          {/* Deployment Mode */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              部署方式
            </label>
            <select className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all bg-white">
              <option value="">请选择</option>
              <option value="saas">SaaS</option>
              <option value="private_cloud">私有云</option>
              <option value="on_premise">本地化</option>
              <option value="hybrid">混合</option>
            </select>
          </div>

          {/* Pricing Model */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              价格模式
            </label>
            <select className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all bg-white">
              <option value="">请选择</option>
              <option value="subscription">订阅制</option>
              <option value="per_project">按项目</option>
              <option value="per_seat">按席位</option>
              <option value="pay_per_use">按量计费</option>
              <option value="custom">自定义</option>
            </select>
          </div>

          {/* Industry */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-1.5">
              适用行业
            </label>
            <select className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all bg-white">
              <option value="">请选择</option>
              <option value="manufacturing">制造业</option>
              <option value="government">政务</option>
              <option value="finance">金融</option>
              <option value="education">教育</option>
              <option value="research">科研</option>
              <option value="healthcare">医疗</option>
              <option value="retail">零售</option>
              <option value="energy">能源</option>
              <option value="industrial_software">工业软件</option>
            </select>
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
            className="w-full rounded-xl border border-line px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none focus:border-primary focus:ring-2 focus:ring-primary/10 transition-all resize-none"
          />
        </div>

        {/* Submit */}
        <div className="flex items-center gap-4 pt-2">
          <button className="rounded-xl bg-primary px-8 py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors">
            提交审核
          </button>
          <Link
            href="/products"
            className="rounded-xl border border-line px-6 py-3 text-sm font-semibold text-foreground hover:border-primary/30 transition-colors"
          >
            取消
          </Link>
        </div>
      </div>
    </section>
  );
}
