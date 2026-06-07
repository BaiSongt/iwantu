'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { Demand, MetricItem } from '@/types';
import MetricGrid from '@/components/ui/MetricGrid';
import FilterPanel from '@/components/ui/FilterPanel';
import Toolbar from '@/components/ui/Toolbar';
import DemandCard from '@/components/cards/DemandCard';

const METRICS: MetricItem[] = [
  { value: '128', label: '待报价需求' },
  { value: '47', label: 'POC进行中' },
  { value: '86%', label: '平均匹配度' },
  { value: '24h', label: '平均响应' },
];

const FILTER_GROUPS = ['行业', '预算', '周期', '是否POC', '数据类型'];

export default function DemandsPage() {
  const router = useRouter();
  const [demands, setDemands] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const fetchDemands = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.industry) params.set('industry', filters.industry);
      if (filters.status) params.set('status', filters.status);
      if (filters.search) params.set('search', filters.search);

      const res = await fetch(`/api/demands?${params.toString()}`);
      if (!res.ok) throw new Error('获取需求失败');
      const data = await res.json();
      setDemands(Array.isArray(data) ? data : data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchDemands();
  }, [fetchDemands]);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-foreground">AI需求大厅</h1>
        <p className="mt-1 text-sm text-muted max-w-xl">
          浏览企业发布的AI需求，找到匹配你能力的项目，快速响应获取商机。
        </p>
      </div>

      {/* Metrics */}
      <div className="mb-8">
        <MetricGrid items={METRICS} />
      </div>

      {/* Sidebar + Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1">
          <FilterPanel groups={FILTER_GROUPS} />
        </div>

        {/* Content */}
        <div className="lg:col-span-3">
          <Toolbar
            count={loading ? '加载中...' : `最新需求（${demands.length}）`}
            actionLabel="发布需求"
            onAction={() => router.push('/demands/publish')}
          />

          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5 text-center">
              <p className="text-sm text-red-600 mb-3">{error}</p>
              <button
                onClick={fetchDemands}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white border-0 cursor-pointer transition-colors hover:bg-red-700"
              >
                重试
              </button>
            </div>
          )}

          {!error && loading && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-2xl border border-line bg-panel p-5"
                >
                  <div className="h-4 w-16 rounded bg-muted/20" />
                  <div className="mt-3 h-5 w-3/4 rounded bg-muted/20" />
                  <div className="mt-3 flex gap-4">
                    <div className="h-4 w-20 rounded bg-muted/20" />
                    <div className="h-4 w-16 rounded bg-muted/20" />
                  </div>
                  <div className="mt-4 flex justify-between">
                    <div className="h-4 w-24 rounded bg-muted/20" />
                    <div className="h-8 w-16 rounded-xl bg-muted/20" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {!error && !loading && demands.length === 0 && (
            <div className="rounded-xl border border-line bg-panel p-12 text-center">
              <p className="text-muted text-sm">暂无需求</p>
            </div>
          )}

          {!error && !loading && demands.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {demands.map((demand, i) => (
                <div
                  key={demand.id}
                  style={{ '--stagger': `${i * 80}ms` } as React.CSSProperties}
                >
                  <DemandCard demand={demand} index={i} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
