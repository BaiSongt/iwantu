'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { Package } from 'lucide-react';
import type { Product } from '@/types';
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
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<Record<string, string>>({});

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.category) params.set('category', filters.category);
      if (filters.industry) params.set('industry', filters.industry);
      if (filters.search) params.set('search', filters.search);
      params.set('status', 'published');

      const res = await fetch(`/api/products?${params.toString()}`);
      if (!res.ok) throw new Error('获取产品失败');
      const data = await res.json();
      setProducts(Array.isArray(data) ? data : data.data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败，请重试');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchProducts();
  }, [fetchProducts]);

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
            count={
              loading
                ? '加载中...'
                : `共找到 ${products.length} 个 AI 产品`
            }
            actionLabel="发布产品"
            onAction={() => setShowPublish(true)}
          />

          {error && (
            <div className="mb-6 rounded-xl border border-red-200 bg-red-50 p-5 text-center">
              <p className="text-sm text-red-600 mb-3">{error}</p>
              <button
                onClick={fetchProducts}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white border-0 cursor-pointer transition-colors hover:bg-red-700"
              >
                重试
              </button>
            </div>
          )}

          {!error && loading && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-2xl border border-line bg-panel p-5"
                >
                  <div className="h-28 rounded-xl bg-muted/20" />
                  <div className="mt-3 h-5 w-3/4 rounded bg-muted/20" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-muted/20" />
                  <div className="mt-3 h-4 w-full rounded bg-muted/20" />
                  <div className="mt-3 h-8 w-full rounded-xl bg-muted/20" />
                </div>
              ))}
            </div>
          )}

          {!error && !loading && products.length === 0 && (
            <div className="rounded-xl border border-line bg-panel p-12 text-center">
              <p className="text-muted text-sm">暂无产品</p>
            </div>
          )}

          {!error && !loading && products.length > 0 && (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
              {products.map((product, idx) => (
                <div
                  key={product.id}
                  style={{ '--stagger': `${idx * 80}ms` } as React.CSSProperties}
                >
                  <ProductCard product={product} index={idx} />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
