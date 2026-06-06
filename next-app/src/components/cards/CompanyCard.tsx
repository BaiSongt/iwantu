'use client';

import React from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import type { CompanyProfile } from '@/types';
import TagCloud from '@/components/ui/TagCloud';

interface CompanyCardProps {
  company: CompanyProfile;
  index?: number;
}

export default function CompanyCard({ company, index = 0 }: CompanyCardProps) {
  const initials = company.name.slice(0, 2);

  return (
    <div
      className="group animate-fade-up rounded-2xl border border-line bg-panel p-5 transition-all duration-300 hover:-translate-y-[6px] hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Avatar + Name + Certification */}
      <div className="flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-violet text-base font-bold text-white">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold text-foreground truncate group-hover:text-primary transition-colors">
              {company.name}
            </h3>
            {company.certified && (
              <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-green/10 px-2 py-0.5 text-[11px] font-semibold text-green">
                <CheckCircle2 className="h-3 w-3" />
                已认证
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Description */}
      <p className="mt-3 text-sm text-muted/80 leading-relaxed line-clamp-2">
        {company.description}
      </p>

      {/* Tags */}
      <div className="mt-3">
        <TagCloud tags={company.tags} />
      </div>

      {/* Action Buttons */}
      <div className="mt-4 flex gap-2">
        <Link
          href={`/companies/${company.id}`}
          className="flex-1 inline-flex items-center justify-center rounded-xl bg-primary/8 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary hover:text-white"
        >
          查看主页
        </Link>
        <Link
          href="/messages"
          className="flex-1 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
        >
          联系公司
        </Link>
      </div>
    </div>
  );
}
