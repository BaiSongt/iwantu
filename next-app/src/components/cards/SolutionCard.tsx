'use client';

import React from 'react';
import Link from 'next/link';
import { Workflow, ArrowRight } from 'lucide-react';
import type { Solution } from '@/types';

interface SolutionCardProps {
  solution: Solution;
  index?: number;
}

export default function SolutionCard({ solution, index = 0 }: SolutionCardProps) {
  return (
    <Link
      href={`/solutions/${solution.id}`}
      className="group block animate-fade-up rounded-2xl border border-line bg-panel p-5 transition-all duration-300 hover:-translate-y-[6px] hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Icon + Title */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Workflow className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-foreground leading-snug line-clamp-1 group-hover:text-primary transition-colors">
            {solution.title}
          </h3>
        </div>
      </div>

      {/* Summary */}
      <p className="mt-3 text-sm text-muted/80 leading-relaxed line-clamp-2">
        {solution.summary}
      </p>

      {/* View Link */}
      <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
        查看方案
        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
      </div>
    </Link>
  );
}
