'use client';

import React from 'react';
import { ShieldCheck } from 'lucide-react';

interface RiskCardProps {
  title?: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
  index?: number;
}

export default function RiskCard({
  title = '风险提示',
  description,
  actionLabel,
  onAction,
  index = 0,
}: RiskCardProps) {
  return (
    <div
      className="group animate-fade-up rounded-2xl border border-orange/20 bg-gradient-to-br from-orange/5 to-orange/[0.02] p-5 transition-all duration-300 hover:-translate-y-[6px] hover:border-orange/40 hover:shadow-lg hover:shadow-orange/8"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Icon + Title */}
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange/10 text-orange">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <h3 className="text-base font-semibold text-foreground leading-snug">
          {title}
        </h3>
      </div>

      {/* Warning Text */}
      <p className="mt-3 text-sm text-muted/80 leading-relaxed">
        {description}
      </p>

      {/* Action Button */}
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          className="mt-4 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary/90"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
