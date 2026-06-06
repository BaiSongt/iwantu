'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DEMANDS } from '@/lib/constants';
import type { MetricItem } from '@/types';
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
            count="最新需求"
            actionLabel="发布需求"
            onAction={() => router.push('/demands/publish')}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {DEMANDS.map((demand, i) => (
              <div
                key={demand.id}
                style={{ '--stagger': `${i * 80}ms` } as React.CSSProperties}
              >
                <DemandCard demand={demand} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
