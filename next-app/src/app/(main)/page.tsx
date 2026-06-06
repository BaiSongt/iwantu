'use client';

import Link from 'next/link';
import { Search } from 'lucide-react';
import { PRODUCTS, CAPABILITY_CATEGORIES } from '@/lib/constants';
import MetricGrid from '@/components/ui/MetricGrid';
import TagCloud from '@/components/ui/TagCloud';
import SectionTitle from '@/components/ui/SectionTitle';
import ProductCard from '@/components/cards/ProductCard';
import EntryCard from '@/components/cards/EntryCard';
import HeroGraphic from '@/components/sections/HeroGraphic';

import type { MetricItem } from '@/types';

const METRICS: MetricItem[] = [
  { value: '3000+', label: 'AI产品与Agent' },
  { value: '600+', label: '企业需求线索' },
  { value: '120+', label: '平台认证公司' },
  { value: '48h', label: '平均匹配响应' },
];

const ENTRIES = [
  { num: '01', title: '我要找AI', desc: '发布需求，智能匹配产品与供应商', href: '/demands/publish' },
  { num: '02', title: '我要卖AI', desc: '上架AI产品，触达精准客户', href: '/products/publish' },
  { num: '03', title: '我是AI公司', desc: '展示能力，获取高质量商机', href: '/companies' },
  { num: '04', title: '我要做POC', desc: '快速验证，降低采购决策风险', href: '/poc' },
];

export default function HomePage() {
  const recommendedProducts = PRODUCTS.slice(0, 3);

  return (
    <div className="flex flex-col gap-20 pb-20">
      {/* ===== Hero Section ===== */}
      <section className="relative overflow-hidden bg-gradient-to-b from-blue-50/80 via-white to-white">
        <div className="mx-auto max-w-7xl px-6 pt-20 pb-16 lg:pt-28 lg:pb-24">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Left: text content */}
            <div className="flex flex-col gap-6">
              <span className="inline-block w-fit px-3 py-1 rounded-full bg-primary/10 text-primary text-sm font-semibold">
                AI能力供需撮合平台
              </span>
              <h1 className="text-4xl lg:text-5xl font-bold leading-tight text-foreground">
                找到你真正需要的
                <span className="bg-gradient-to-r from-primary via-violet to-cyan bg-clip-text text-transparent">
                  {' '}AI 能力
                </span>
              </h1>
              <p className="text-lg text-muted leading-relaxed max-w-lg">
                iWantU 帮助企业精准描述 AI 需求，智能匹配产品、Agent 和交付团队，从 POC 验证到采购落地一站式完成。
              </p>

              {/* Search bar */}
              <div className="flex items-center gap-2 p-2 bg-white rounded-2xl border border-line shadow-sm max-w-lg">
                <div className="flex items-center gap-2 flex-1 px-3">
                  <Search className="w-5 h-5 text-muted" />
                  <span className="text-sm text-muted">描述你的AI需求...</span>
                </div>
                <Link
                  href="/match"
                  className="px-5 py-2.5 rounded-xl bg-primary text-white text-sm font-semibold hover:bg-primary/90 transition-colors"
                >
                  智能匹配
                </Link>
              </div>

              {/* CTA buttons */}
              <div className="flex flex-wrap gap-3 mt-2">
                <Link
                  href="/demands/publish"
                  className="px-6 py-3 rounded-xl bg-foreground text-white font-semibold text-sm hover:bg-foreground/90 transition-colors"
                >
                  发布AI需求
                </Link>
                <Link
                  href="/products"
                  className="px-6 py-3 rounded-xl border border-line text-foreground font-semibold text-sm hover:bg-slate-50 transition-colors"
                >
                  寻找AI产品
                </Link>
              </div>
            </div>

            {/* Right: Hero Graphic */}
            <div className="hidden lg:block">
              <HeroGraphic />
            </div>
          </div>
        </div>
      </section>

      {/* ===== Metrics ===== */}
      <section className="mx-auto max-w-7xl px-6 -mt-8">
        <MetricGrid items={METRICS} />
      </section>

      {/* ===== Entry Grid ===== */}
      <section className="mx-auto max-w-7xl px-6">
        <SectionTitle title="选择你的入口" desc="根据你的角色，快速开始" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mt-8">
          {ENTRIES.map((entry) => (
            <EntryCard key={entry.num} {...entry} />
          ))}
        </div>
      </section>

      {/* ===== Category Tags ===== */}
      <section className="mx-auto max-w-7xl px-6">
        <SectionTitle title="热门AI能力分类" desc="探索各领域的AI能力" />
        <div className="mt-8">
          <TagCloud tags={CAPABILITY_CATEGORIES} />
        </div>
      </section>

      {/* ===== Recommended Products ===== */}
      <section className="mx-auto max-w-7xl px-6">
        <SectionTitle
          title="推荐AI产品"
          desc="平台精选的优质AI产品"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
          {recommendedProducts.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
        <div className="flex justify-center mt-8">
          <Link
            href="/products"
            className="px-6 py-3 rounded-xl border border-line text-sm font-semibold text-foreground hover:bg-slate-50 transition-colors"
          >
            查看全部产品
          </Link>
        </div>
      </section>
    </div>
  );
}
