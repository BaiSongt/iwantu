'use client';

import React from 'react';
import Link from 'next/link';
import { Star, Zap } from 'lucide-react';
import type { Product } from '@/types';
import VisualShot from '@/components/ui/VisualShot';
import TagCloud from '@/components/ui/TagCloud';

interface ProductCardProps {
  product: Product;
  compact?: boolean;
  index?: number;
}

export default function ProductCard({ product, compact = false, index = 0 }: ProductCardProps) {
  return (
    <Link
      href={`/products/${product.id}`}
      className="group block animate-fade-up rounded-2xl border border-line bg-panel p-0 transition-all duration-300 hover:-translate-y-[6px] hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Visual Shot */}
      <div className="p-4 pb-0">
        <VisualShot variant={product.shot} accent={product.accent} />
      </div>

      <div className={`flex flex-col ${compact ? 'p-4 pt-3' : 'p-5 pt-4'}`}>
        {/* Badge + Title Row */}
        <div className="flex items-start justify-between gap-2">
          <h3 className="text-base font-semibold text-foreground leading-snug line-clamp-1 group-hover:text-primary transition-colors">
            {product.name}
          </h3>
          {product.supportPoc && (
            <span className="shrink-0 inline-flex items-center gap-1 rounded-full bg-green/10 px-2 py-0.5 text-[11px] font-semibold text-green">
              <Zap className="h-3 w-3" />
              可POC
            </span>
          )}
        </div>

        {/* Company */}
        <p className="mt-1 text-xs text-muted">{product.company}</p>

        {/* Description */}
        {!compact && (
          <p className="mt-2 text-sm text-muted/80 leading-relaxed line-clamp-2">
            {product.summary}
          </p>
        )}

        {/* Tags */}
        <div className="mt-3">
          <TagCloud tags={product.tags} />
        </div>

        {/* Meta Row */}
        <div className="mt-3 flex items-center gap-3 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <Star className="h-3.5 w-3.5 text-orange" />
            <span className="font-medium text-foreground">{product.score}</span>
          </span>
          <span className="h-3 w-px bg-line" />
          <span>{product.deploy}</span>
          <span className="h-3 w-px bg-line" />
          <span className="text-primary">{product.price}</span>
        </div>

        {/* CTA Button */}
        <div className="mt-4">
          <span className="inline-flex w-full items-center justify-center rounded-xl bg-primary/8 px-4 py-2 text-sm font-medium text-primary transition-colors group-hover:bg-primary group-hover:text-white">
            查看并联系
          </span>
        </div>
      </div>
    </Link>
  );
}
