'use client';

import { useState, useEffect, useCallback } from 'react';
import { Package } from 'lucide-react';
import type { Product } from '@/types';
import FilterPanel, { type FilterGroupDef } from '@/components/ui/FilterPanel';
import Toolbar from '@/components/ui/Toolbar';
import ProductCard from '@/components/cards/ProductCard';

const CATEGORY_OPTIONS = [
  { label: 'AI对话', value: 'ai_chat' },
  { label: 'AI写作', value: 'ai_writing' },
  { label: 'AI绘画', value: 'ai_image' },
  { label: 'AI视频', value: 'ai_video' },
  { label: 'AI音频', value: 'ai_audio' },
  { label: 'AI代码', value: 'ai_code' },
  { label: 'AI数据分析', value: 'ai_data' },
  { label: 'AI安全', value: 'ai_security' },
  { label: 'AI OCR', value: 'ai_ocr' },
  { label: 'AI Agent', value: 'ai_agent' },
  { label: 'AI搜索', value: 'ai_search' },
  { label: 'AI翻译', value: 'ai_translate' },
  { label: '数字人', value: 'digital_human' },
  { label: 'AI知识库', value: 'ai_knowledge' },
  { label: '其他', value: 'other' },
];

const DEPLOYMENT_OPTIONS = [
  { label: 'SaaS', value: 'saas' },
  { label: '私有云', value: 'private_cloud' },
  { label: '本地化', value: 'on_premise' },
  { label: '混合', value: 'hybrid' },
];

const PRICING_OPTIONS = [
  { label: '订阅制', value: 'subscription' },
  { label: '按项目', value: 'per_project' },
  { label: '按席位', value: 'per_seat' },
  { label: '按用量', value: 'pay_per_use' },
  { label: '定制', value: 'custom' },
];

const INDUSTRY_OPTIONS = [
  { label: '制造业', value: 'manufacturing' },
  { label: '政务', value: 'government' },
  { label: '金融', value: 'finance' },
  { label: '教育', value: 'education' },
  { label: '科研', value: 'research' },
  { label: '医疗', value: 'healthcare' },
  { label: '零售', value: 'retail' },
  { label: '能源', value: 'energy' },
  { label: '工业软件', value: 'industrial_software' },
];

const PRODUCT_FILTER_GROUPS: FilterGroupDef[] = [
  {
    key: 'category',
    label: '能力分类',
    type: 'select',
    options: CATEGORY_OPTIONS,
  },
  {
    key: 'deploymentMode',
    label: '部署方式',
    type: 'select',
    options: DEPLOYMENT_OPTIONS,
  },
  {
    key: 'pricingModel',
    label: '价格模式',
    type: 'select',
    options: PRICING_OPTIONS,
  },
  {
    key: 'industry',
    label: '行业场景',
    type: 'select',
    options: INDUSTRY_OPTIONS,
  },
];

export default function ProductsPage() {
  const [showPublish, setShowPublish] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState('');
  const [filters, setFilters] = useState<Record<string, string>>({});

  const handleFilterChange = useCallback((key: string, value: string) => {
    setFilters((prev) => {
      const next = { ...prev };
      if (value === '' || value === undefined) {
        delete next[key];
      } else {
        next[key] = value;
      }
      return next;
    });
  }, []);

  const handleClearFilters = useCallback(() => {
    setFilters({});
    setSearchText('');
  }, []);

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.category) params.set('category', filters.category);
      if (filters.industry) params.set('industry', filters.industry);
      if (filters.deploymentMode) params.set('deploymentMode', filters.deploymentMode);
      if (filters.pricingModel) params.set('pricingModel', filters.pricingModel);
      if (searchText) params.set('search', searchText);
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
  }, [filters, searchText]);

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

      {/* Search Bar */}
      <div className="mb-6">
        <div className="relative max-w-xl">
          <input
            type="text"
            placeholder="搜索产品..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            className="w-full rounded-xl border border-line bg-panel px-4 py-3 pl-4 text-sm text-foreground placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/20 transition-colors"
          />
          {searchText && (
            <button
              onClick={() => setSearchText('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-foreground border-0 bg-transparent cursor-pointer"
            >
              &#10005;
            </button>
          )}
        </div>
      </div>

      {/* Two-column layout: Filter sidebar + Content */}
      <div className="grid grid-cols-1 gap-8 items-start lg:grid-cols-[260px_1fr]">
        {/* Filter Sidebar */}
        <FilterPanel
          groups={PRODUCT_FILTER_GROUPS}
          values={filters}
          onChange={handleFilterChange}
          onClear={handleClearFilters}
        />

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
