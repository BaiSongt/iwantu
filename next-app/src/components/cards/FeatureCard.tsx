'use client';

import React from 'react';
import VisualShot from '@/components/ui/VisualShot';

interface FeatureCardProps {
  title: string;
  description: string;
  shotVariant: string;
  shotAccent: string;
  onViewDetail?: () => void;
  onContact?: () => void;
  index?: number;
}

export default function FeatureCard({
  title,
  description,
  shotVariant,
  shotAccent,
  onViewDetail,
  onContact,
  index = 0,
}: FeatureCardProps) {
  return (
    <div
      className="group animate-fade-up min-h-[520px] rounded-2xl border border-line bg-panel overflow-hidden transition-all duration-300 hover:-translate-y-[6px] hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Visual Shot - larger for featured cards */}
      <div className="p-5 pb-0">
        <div className="h-[250px] rounded-[10px] overflow-hidden">
          <VisualShot
            variant={shotVariant}
            accent={shotAccent}
          />
        </div>
      </div>

      <div className="p-5 pt-4">
        {/* Title */}
        <h3 className="text-lg font-semibold text-foreground leading-snug group-hover:text-primary transition-colors">
          {title}
        </h3>

        {/* Description */}
        <p className="mt-2 text-sm text-muted/80 leading-relaxed line-clamp-3">
          {description}
        </p>

        {/* Action Buttons */}
        <div className="mt-5 flex gap-3">
          {onViewDetail && (
            <button
              type="button"
              onClick={onViewDetail}
              className="flex-1 inline-flex items-center justify-center rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted transition-colors hover:border-primary/30 hover:text-primary"
            >
              查看详情
            </button>
          )}
          {onContact && (
            <button
              type="button"
              onClick={onContact}
              className="flex-1 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary/90"
            >
              联系咨询
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
