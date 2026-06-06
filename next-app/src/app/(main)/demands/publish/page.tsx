'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Sparkles, WandSparkles, FileText, Send, CheckCircle, AlertCircle, Lightbulb } from 'lucide-react';

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

export default function PublishDemandPage() {
  const [description, setDescription] = useState('');

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 animate-fade-up">
      <h1 className="text-2xl font-bold text-foreground mb-1">发布AI需求</h1>
      <p className="text-sm text-muted mb-8">填写需求信息，AI助手将帮助你完善需求描述，提高匹配精度。</p>

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
            <Link
              href="/demands"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-bold text-white hover:bg-primary/90 transition-colors"
            >
              <Send className="h-4 w-4" />
              发布需求
            </Link>
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
