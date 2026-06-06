'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Package } from 'lucide-react';
import { PRODUCTS } from '@/lib/constants';
import FilterPanel from '@/components/ui/FilterPanel';
import Toolbar from '@/components/ui/Toolbar';
import ProductCard from '@/components/cards/ProductCard';

const FILTER_GROUPS = [
  '能力分类',
  '部署方式',
  '价格模式',
  '行业场景',
  '认证状态',
];

export default function ProductsPage() {
  const [showPublish, setShowPublish] = useState(false);

  return (
    <section className="mx-auto max-w-7xl px-6 py-10 animate-fade-up">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Package className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">AI产品市场</h1>
        </div>
        <p className="text-sm text-muted">
          浏览并筛选平台上已发布的 AI 产品与能力，找到最适合你业务场景的解决方案。
        </p>
      </div>

      {/* Two-column layout: Filter sidebar + Content */}
      <div className="grid grid-cols-1 gap-8 items-start lg:grid-cols-[260px_1fr]">
        {/* Filter Sidebar */}
        <FilterPanel groups={FILTER_GROUPS} />

        {/* Content Area */}
        <div>
          {/* Toolbar */}
          <Toolbar
            count={`共找到 ${PRODUCTS.length} 个 AI 产品`}
            actionLabel="发布产品"
            onAction={() => setShowPublish(true)}
          />

          {/* Product Grid */}
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
            {PRODUCTS.map((product, idx) => (
              <div
                key={product.id}
                style={{ '--stagger': `${idx * 80}ms` } as React.CSSProperties}
              >
                <ProductCard product={product} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
