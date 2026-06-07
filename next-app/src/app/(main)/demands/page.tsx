'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { Demand, MetricItem } from '@/types';
import MetricGrid from '@/components/ui/MetricGrid';
import FilterPanel, { type FilterGroupDef } from '@/components/ui/FilterPanel';
import Toolbar from '@/components/ui/Toolbar';
import DemandCard from '@/components/cards/DemandCard';

const METRICS: MetricItem[] = [
  { value: '128', label: '待报价需求' },
  { value: '47', label: 'POC进行中' },
  { value: '86%', label: '平均匹配度' },
  { value: '24h', label: '平均响应' },
];

const INDUSTRY_OPTIONS = [
  { label: '制造业', value: 'manufacturing' },
  { label: '政务', value: 'government' },
  { label: '金融', value: 'finance' },
  { label: '教育', value: 'education' },
  { label: '科研', value: 'research' },
  { label: '医疗', value: 'healthcare' },
  { label: '零售', value: 'retail' },
  { label: '能源', value: 'energy' },
  { label: '工业软件', value: 'industrial_software' },
];

const STATUS_OPTIONS = [
  { label: '征集中', value: 'collecting_proposals' },
  { label: '需求澄清', value: 'clarifying' },
  { label: 'POC进行中', value: 'in_poc' },
];

const POC_OPTIONS = [
  { label: '支持', value: 'true' },
  { label: '不支持', value: 'false' },
];

const DEMAND_FILTER_GROUPS: FilterGroupDef[] = [
  {
    key: 'industry',
    label: '行业',
    type: 'select',
    options: INDUSTRY_OPTIONS,
  },
  {
    key: 'status',
    label: '状态',
    type: 'select',
    options: STATUS_OPTIONS,
  },
  {
    key: 'budget',
    label: '预算范围',
    type: 'range',
    placeholder: '预算(万)',
  },
  {
    key: 'supportPoc',
    label: '是否POC',
    type: 'toggle',
    options: POC_OPTIONS,
  },
];

export default function DemandsPage() {
  const router = useRouter();
  const [demands, setDemands] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});

  const handleFilterChange = useCallback((key: string, value: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === '' || value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({});
    setSearchText('');
  }, []);

  const fetchDemands = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.industry) params.set('industry', filters.industry);
      if (filters.status) params.set('status', filters.status);
      if (filters.supportPoc) params.set('supportPoc', filters.supportPoc);
      if (searchText) params.set('search', searchText);

      // Budget range: format is "min-max"
      if (filters.budget) {
        const [min, max] = filters.budget.split('-');
        if (min) params.set('budgetMin', min);
        if (max) params.set('budgetMax', max);
      }

      const res = await fetch(`/api/demands?${params.toString()}`);
      if (!res.ok) throw new Error('获取需求失败');
      const data = await res.json();
      setDemands(Array.isArray(data) ? data : data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [filters, searchText]);

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

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative max-w-xl">
          <input
            type="text"
            placeholder="搜索需求..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full rounded-xl border border-line bg-panel px-4 py-3 pl-4 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground border-0 bg-transparent cursor-pointer"
            >
              &#10005;
            </button>
          )}
        </div>
      </div>

      {/* Sidebar + Content */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Sidebar */}
        <div className="lg:col-span-1">
          <FilterPanel
            groups={DEMAND_FILTER_GROUPS}
            values={filters}
            onChange={handleFilterChange}
            onClear={handleClearFilters}
          />
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
