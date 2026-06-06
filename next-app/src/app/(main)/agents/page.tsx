'use client';

import Link from 'next/link';
import { Bot } from 'lucide-react';
import { PRODUCTS } from '@/lib/constants';
import ProductCard from '@/components/cards/ProductCard';

const agentProducts = PRODUCTS.filter((p) =>
  p.tags.some((tag) => tag.includes('Agent'))
);

export default function AgentsPage() {
  return (
    <section className="mx-auto max-w-7xl px-6 py-10 animate-fade-up">
      {/* Page Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <Bot className="h-7 w-7 text-violet" />
          <h1 className="text-2xl font-bold text-foreground">AI Agent专区</h1>
        </div>
        <p className="text-sm text-muted">
          探索平台上所有 AI Agent 产品，找到能自动执行任务、提升效率的智能助手。
        </p>
      </div>

      {/* Agent Grid */}
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
        {agentProducts.map((product, idx) => (
          <div
            key={product.id}
            style={{ '--stagger': `${idx * 80}ms` } as React.CSSProperties}
          >
            <ProductCard product={product} />
          </div>
        ))}
      </div>

      {/* Empty State */}
      {agentProducts.length === 0 && (
        <div className="text-center py-20">
          <p className="text-muted">暂无 Agent 产品</p>
        </div>
      )}
    </section>
  );
}
