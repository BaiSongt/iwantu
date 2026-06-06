'use client';

import { Upload, Send } from 'lucide-react';
import SectionTitle from '@/components/ui/SectionTitle';
import InfoRows from '@/components/ui/InfoRows';

export default function QuotePage() {
  const quoteRows: [string, string][] = [
    ['项目范围', '知识库问答系统、权限控制、答案溯源、OA集成'],
    ['实施周期', '6 周'],
    ['报价金额', '28 万'],
    ['交付物', '部署包、接口文档、验收报告、运维手册'],
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 pb-20">
      <SectionTitle
        title="方案报价页"
        desc="基于POC验证结果，生成结构化方案报价，支持一键发送与存档。"
      />
      <div className="mx-auto max-w-xl animate-soft-pop">
        <div className="rounded-2xl border border-line bg-panel p-6 shadow-[0_10px_26px_rgba(15,23,42,0.04)]">
          {/* Header badge */}
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-green/5 px-3 py-2">
            <div className="h-2.5 w-2.5 rounded-full bg-green" />
            <span className="text-sm font-medium text-green">报价方案已生成</span>
          </div>

          {/* Info rows */}
          <InfoRows rows={quoteRows} />

          {/* Actions */}
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl border border-line bg-white px-5 py-2.5 text-sm font-bold text-foreground transition-all duration-160 hover:-translate-y-0.5 hover:border-[#bfdbfe] hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)] hover:text-primary"
            >
              <Upload className="h-4 w-4" />
              导出PDF
            </button>
            <button
              type="button"
              className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white transition-all duration-160 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
            >
              <Send className="h-4 w-4" />
              发送报价
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
