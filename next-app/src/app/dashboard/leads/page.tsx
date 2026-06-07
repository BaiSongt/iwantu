'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Search,
  Eye,
  FileText,
  FlaskConical,
  MapPin,
  Clock,
  Inbox,
  X,
} from 'lucide-react';
import type { Demand, IndustryTag } from '@/types';

/* ------------------------------------------------------------------ */
/*  Industry tags                                                      */
/* ------------------------------------------------------------------ */

const INDUSTRY_OPTIONS: { value: IndustryTag; label: string }[] = [
  { value: 'manufacturing', label: '制造业' },
  { value: 'government', label: '政务' },
  { value: 'finance', label: '金融' },
  { value: 'education', label: '教育' },
  { value: 'research', label: '科研' },
  { value: 'healthcare', label: '医疗' },
  { value: 'retail', label: '零售' },
  { value: 'energy', label: '能源' },
  { value: 'industrial_software', label: '工业软件' },
];

/* ------------------------------------------------------------------ */
/*  Lead Card                                                          */
/* ------------------------------------------------------------------ */

function hashScore(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = ((h << 5) - h + id.charCodeAt(i)) | 0;
  }
  return (Math.abs(h) % 31) + 70; // 70..100
}

function LeadCard({ demand }: { demand: Demand }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)] transition-all duration-160 hover:-translate-y-0.5 hover:border-[#bfdbfe] hover:shadow-[0_24px_70px_rgba(21,94,239,0.12)]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{demand.title}</h3>
          <div className="mt-1 flex items-center gap-2 text-xs text-muted">
            <span className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {demand.industry}
            </span>
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {demand.createdAt}
            </span>
          </div>
        </div>
        {/* Match score placeholder */}
        <span className="shrink-0 inline-flex items-center rounded-full bg-primary/10 px-2.5 py-1 text-xs font-bold text-primary">
          {hashScore(demand.id)}% 匹配
        </span>
      </div>

      {/* Description */}
      {demand.description && (
        <p className="mt-3 text-xs text-muted line-clamp-2 leading-relaxed">
          {demand.description}
        </p>
      )}

      {/* Details row */}
      <div className="mt-3 flex flex-wrap items-center gap-3 text-xs">
        {demand.budgetRange && (
          <span className="rounded-md bg-emerald-50 px-2 py-0.5 text-emerald-700 font-medium">
            {demand.budgetRange}
          </span>
        )}
        {demand.deliveryPeriod && (
          <span className="text-muted">
            交付周期: {demand.deliveryPeriod}
          </span>
        )}
        {demand.supportPoc && (
          <span className="flex items-center gap-1 text-purple-600 font-medium">
            <FlaskConical className="h-3 w-3" />
            支持POC
          </span>
        )}
      </div>

      {/* Data types tags */}
      {demand.dataTypes && demand.dataTypes.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {demand.dataTypes.slice(0, 4).map((dt) => (
            <span
              key={dt}
              className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-muted"
            >
              {dt}
            </span>
          ))}
          {demand.dataTypes.length > 4 && (
            <span className="rounded-md bg-gray-100 px-2 py-0.5 text-[11px] text-muted">
              +{demand.dataTypes.length - 4}
            </span>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2 border-t border-line/60 pt-3">
        <Link
          href={`/demands/${demand.id}`}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-foreground hover:bg-gray-50 transition-colors"
        >
          <Eye className="h-3.5 w-3.5" />
          查看详情
        </Link>
        <Link
          href={`/demands/${demand.id}?tab=proposal`}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-primary/90"
        >
          <FileText className="h-3.5 w-3.5" />
          提交提案
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton Card                                                      */
/* ------------------------------------------------------------------ */

function SkeletonCard() {
  return (
    <div className="rounded-2xl border border-line bg-white p-5">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="h-4 w-3/4 rounded bg-gray-100 animate-pulse" />
          <div className="mt-2 h-3 w-1/2 rounded bg-gray-50 animate-pulse" />
        </div>
        <div className="h-6 w-16 rounded-full bg-gray-50 animate-pulse" />
      </div>
      <div className="mt-3 h-3 w-full rounded bg-gray-50 animate-pulse" />
      <div className="mt-2 h-3 w-2/3 rounded bg-gray-50 animate-pulse" />
      <div className="mt-3 flex gap-2">
        <div className="h-5 w-16 rounded-md bg-gray-50 animate-pulse" />
        <div className="h-5 w-20 rounded-md bg-gray-50 animate-pulse" />
      </div>
      <div className="mt-4 flex gap-2">
        <div className="h-7 w-20 rounded-lg bg-gray-50 animate-pulse" />
        <div className="h-7 w-20 rounded-lg bg-gray-50 animate-pulse" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function LeadsPage() {
  const [demands, setDemands] = useState<Demand[]>([]);
  const [loading, setLoading] = useState(true);
  const [industryFilter, setIndustryFilter] = useState<string>('');
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    async function fetchLeads() {
      try {
        const params = new URLSearchParams({ status: 'collecting_proposals' });
        if (industryFilter) {
          params.set('industry', industryFilter);
        }
        const res = await fetch(`/api/demands?${params.toString()}`);
        if (res.ok) {
          const json = await res.json();
          setDemands(Array.isArray(json) ? json : json.data ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    setLoading(true);
    fetchLeads();
  }, [industryFilter]);

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground">收到的需求</h2>
        <p className="mt-1 text-sm text-muted">
          浏览与您匹配的采购需求，提交方案
        </p>
      </div>

      {/* Industry Filter */}
      <div className="mb-4 flex items-center gap-2">
        <button
          onClick={() => setShowFilters(!showFilters)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-sm font-medium text-foreground hover:bg-gray-50 transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          行业筛选
          {industryFilter && (
            <span className="ml-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
              1
            </span>
          )}
        </button>
        {industryFilter && (
          <button
            onClick={() => setIndustryFilter('')}
            className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/20 transition-colors"
          >
            {INDUSTRY_OPTIONS.find((o) => o.value === industryFilter)?.label}
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {showFilters && (
        <div className="mb-4 flex flex-wrap gap-1.5 rounded-xl bg-gray-50 p-3">
          {INDUSTRY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              onClick={() => {
                setIndustryFilter(
                  industryFilter === opt.value ? '' : opt.value,
                );
                setShowFilters(false);
              }}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                industryFilter === opt.value
                  ? 'bg-primary text-white'
                  : 'bg-white border border-line text-foreground hover:bg-gray-100'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      )}

      {/* Demand Cards */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : demands.length === 0 ? (
        <div className="rounded-2xl bg-white border border-line shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-50 mb-4">
              <Inbox className="h-7 w-7 text-muted/40" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">
              暂无匹配的需求
            </p>
            <p className="text-xs text-muted">
              当前没有正在收集提案的需求，请稍后再来查看
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {demands.map((demand) => (
            <LeadCard key={demand.id} demand={demand} />
          ))}
        </div>
      )}
    </div>
  );
}
