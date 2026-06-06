'use client';

import Link from 'next/link';
import { PRODUCTS } from '@/lib/constants';
import SectionTitle from '@/components/ui/SectionTitle';
import VisualShot from '@/components/ui/VisualShot';
import FeatureCard from '@/components/cards/FeatureCard';
import FeaturedHero from '@/components/sections/FeaturedHero';

const featuredProducts = PRODUCTS.slice(0, 3);
const todayPicks = PRODUCTS.slice(5, 8);

export default function FeaturedPage() {
  return (
    <div className="flex flex-col gap-20 pb-20">
      {/* ===== Hero ===== */}
      <FeaturedHero />

      {/* ===== Featured Products & Teams ===== */}
      <section id="featured" className="mx-auto max-w-7xl px-6">
        <SectionTitle
          title="优秀产品与团队"
          desc="平台认证的优秀AI产品与交付团队"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
          {featuredProducts.map((product) => (
            <FeatureCard
              key={product.id}
              title={product.name}
              description={product.summary}
              shotVariant={product.shot}
              shotAccent={product.accent}
            />
          ))}
        </div>
      </section>

      {/* ===== Today's Picks ===== */}
      <section className="mx-auto max-w-7xl px-6">
        <SectionTitle
          title="今日推荐"
          desc="每日更新的AI产品推荐"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mt-8">
          {todayPicks.map((product) => (
            <Link
              key={product.id}
              href={`/products/${product.id}`}
              className="group block animate-fade-up rounded-2xl border border-line bg-panel overflow-hidden transition-all duration-300 hover:-translate-y-1.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/8"
            >
              {/* Image-first layout */}
              <VisualShot
                variant={product.shot}
                accent={product.accent}
                className="h-48"
              />
              <div className="p-5">
                <h3 className="text-base font-semibold text-foreground leading-snug group-hover:text-primary transition-colors">
                  {product.name}
                </h3>
                <p className="mt-1 text-xs text-muted">{product.company}</p>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
