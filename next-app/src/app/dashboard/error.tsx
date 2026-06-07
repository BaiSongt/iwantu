'use client';

import Link from 'next/link';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="flex items-center justify-center p-6">
      <div className="flex flex-col items-center rounded-2xl border border-red-100 bg-white px-6 py-16 text-center shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-red-50 text-red-500">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h2 className="text-lg font-semibold text-foreground">
          控制台加载失败
        </h2>
        <p className="mt-1.5 max-w-md text-sm text-muted">
          {error.message || '发生了未知错误，请稍后重试。'}
        </p>
        <div className="mt-6 flex items-center gap-3">
          <button
            onClick={reset}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
          >
            <RefreshCw className="h-4 w-4" />
            重试
          </button>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-5 py-2.5 font-medium text-sm text-foreground transition-all duration-160 ease-out hover:-translate-y-0.5 hover:border-primary/30 hover:text-primary"
          >
            <Home className="h-4 w-4" />
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
