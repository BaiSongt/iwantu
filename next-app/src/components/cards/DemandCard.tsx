'use client';

import React from 'react';
import Link from 'next/link';
import { Building2, Clock, Target, FlaskConical } from 'lucide-react';
import type { Demand } from '@/types';
import TagCloud from '@/components/ui/TagCloud';

interface DemandCardProps {
  demand: Demand;
  index?: number;
}

export default function DemandCard({ demand, index = 0 }: DemandCardProps) {
  return (
    <Link
      href={`/demands/${demand.id}`}
      className="group block animate-fade-up rounded-2xl border border-line bg-panel p-5 transition-all duration-300 hover:-translate-y-[6px] hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Tags Row */}
      <TagCloud tags={[demand.industry, '待报价']} />

      {/* Title */}
      <h3 className="mt-3 text-base font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
        {demand.title}
      </h3>

      {/* Budget & Period */}
      <div className="mt-3 flex items-center gap-4 text-sm text-muted">
        <span className="inline-flex items-center gap-1.5">
          <Building2 className="h-3.5 w-3.5" />
          {demand.budgetRange}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" />
          {demand.deliveryPeriod}
        </span>
      </div>

      {/* POC Info */}
      {demand.supportPoc && (
        <div className="mt-2 flex items-center gap-1.5 text-xs text-green">
          <FlaskConical className="h-3.5 w-3.5" />
          <span className="font-medium">支持POC验证</span>
        </div>
      )}

      {/* Match Score + CTA */}
      <div className="mt-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <span className="text-sm text-muted">匹配度</span>
          <span className="text-lg font-bold text-primary">
            {demand.matchScore}
          </span>
        </div>
        <span className="inline-flex items-center justify-center rounded-xl bg-primary/8 px-4 py-2 text-sm font-medium text-primary transition-colors group-hover:bg-primary group-hover:text-white">
          查看
        </span>
      </div>
    </Link>
  );
}
