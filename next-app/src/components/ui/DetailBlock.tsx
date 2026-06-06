'use client';

import { ReactNode } from 'react';
import { Upload, Send } from 'lucide-react';

interface DetailBlockProps {
  title: string;
  visuals?: boolean;
  actions?: boolean;
  children?: ReactNode;
}

export default function DetailBlock({
  title,
  visuals = false,
  actions = false,
  children,
}: DetailBlockProps) {
  return (
    <div className="bg-panel border border-line rounded-xl p-7 mb-7 shadow-[0_10px_26px_rgba(15,23,42,0.04)] transition-all duration-320 ease-out hover:-translate-y-1.5 hover:border-[#bfdbfe] hover:shadow-[0_24px_70px_rgba(21,94,239,0.16)]">
      <h2 className="mt-0 text-2xl">{title}</h2>

      {children && <div>{children}</div>}

      {visuals && (
        <div className="grid grid-cols-3 gap-7 mt-6 max-[720px]:grid-cols-1">
          <div className="h-[82px] grid place-items-center rounded-[10px] text-primary bg-[#eff6ff] font-extrabold">
            数据分析
          </div>
          <div className="h-[82px] grid place-items-center rounded-[10px] text-primary bg-[#eff6ff] font-extrabold">
            智能匹配
          </div>
          <div className="h-[82px] grid place-items-center rounded-[10px] text-primary bg-[#eff6ff] font-extrabold">
            结果预览
          </div>
        </div>
      )}

      {actions && (
        <div className="flex justify-end gap-3.5 mt-4">
          <button className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 font-bold text-sm text-foreground transition-all duration-160 ease-out hover:-translate-y-0.5 hover:border-[#bfdbfe] hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)] hover:text-primary">
            <Upload className="h-4 w-4" />
            上传
          </button>
          <button className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-bold text-sm text-white border-0 transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]">
            <Send className="h-4 w-4" />
            发送
          </button>
        </div>
      )}
    </div>
  );
}
