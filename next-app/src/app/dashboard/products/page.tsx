'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  Plus,
  Eye,
  Pencil,
  Undo2,
  Star,
  FlaskConical,
  Package,
  Inbox,
} from 'lucide-react';
import type { Product, ProductStatus } from '@/types';

/* ------------------------------------------------------------------ */
/*  Status badge config                                                */
/* ------------------------------------------------------------------ */

const STATUS_CONFIG: Record<
  ProductStatus,
  { label: string; bg: string; text: string }
> = {
  draft: { label: '草稿', bg: 'bg-gray-100', text: 'text-gray-600' },
  pending_review: {
    label: '待审核',
    bg: 'bg-amber-50',
    text: 'text-amber-700',
  },
  published: { label: '已发布', bg: 'bg-green-50', text: 'text-green-700' },
  needs_info: {
    label: '需补充信息',
    bg: 'bg-red-50',
    text: 'text-red-700',
  },
  delisted: { label: '已下架', bg: 'bg-gray-100', text: 'text-gray-600' },
  flagged: {
    label: '被标记',
    bg: 'bg-orange-50',
    text: 'text-orange-700',
  },
};

/* ------------------------------------------------------------------ */
/*  Status Badge                                                       */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: ProductStatus }) {
  const cfg = STATUS_CONFIG[status] ?? {
    label: status,
    bg: 'bg-gray-100',
    text: 'text-gray-600',
  };
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text}`}
    >
      {cfg.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Product Card                                                       */
/* ------------------------------------------------------------------ */

function ProductCard({
  product,
  onDelist,
}: {
  product: Product;
  onDelist: (id: string) => void;
}) {
  return (
    <div className="flex gap-4 rounded-2xl border border-line bg-white p-4 shadow-[0_8px_40px_rgba(15,23,42,0.08)] transition-all duration-160 hover:-translate-y-0.5 hover:border-[#bfdbfe] hover:shadow-[0_24px_70px_rgba(21,94,239,0.12)]">
      {/* Cover */}
      <div className="h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-gray-50">
        {product.coverImage ? (
          <Image
            src={product.coverImage}
            alt={product.name}
            width={80}
            height={80}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package className="h-8 w-8 text-muted/30" />
          </div>
        )}
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground truncate">
              {product.name}
            </h3>
            <p className="mt-0.5 text-xs text-muted">
              {product.category}
              {product.tags?.length > 0 && (
                <span className="ml-2">
                  {product.tags.slice(0, 2).join(' / ')}
                </span>
              )}
            </p>
          </div>
          <StatusBadge status={product.status} />
        </div>

        {/* Stats row */}
        <div className="mt-2.5 flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1">
            <FlaskConical className="h-3.5 w-3.5" />
            POC {product.pocCount}
          </span>
          <span className="flex items-center gap-1">
            <Star className="h-3.5 w-3.5 text-amber-400" />
            {product.rating > 0 ? product.rating.toFixed(1) : '-'}
          </span>
        </div>

        {/* Actions */}
        <div className="mt-3 flex items-center gap-2">
          <Link
            href={`/products/${product.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-foreground hover:bg-gray-50 transition-colors"
          >
            <Eye className="h-3.5 w-3.5" />
            查看详情
          </Link>
          <Link
            href={`/products/${product.id}`}
            className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-foreground hover:bg-gray-50 transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            编辑
          </Link>
          {(product.status === 'published' || product.status === 'pending_review') && (
            <button
              onClick={() => onDelist(product.id)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors"
            >
              <Undo2 className="h-3.5 w-3.5" />
              撤回
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton Card                                                      */
/* ------------------------------------------------------------------ */

function SkeletonCard() {
  return (
    <div className="flex gap-4 rounded-2xl border border-line bg-white p-4">
      <div className="h-20 w-20 shrink-0 rounded-xl bg-gray-100 animate-pulse" />
      <div className="flex-1">
        <div className="h-4 w-1/2 rounded bg-gray-100 animate-pulse" />
        <div className="mt-2 h-3 w-1/3 rounded bg-gray-50 animate-pulse" />
        <div className="mt-3 h-3 w-2/5 rounded bg-gray-50 animate-pulse" />
        <div className="mt-3 flex gap-2">
          <div className="h-7 w-20 rounded-lg bg-gray-50 animate-pulse" />
          <div className="h-7 w-16 rounded-lg bg-gray-50 animate-pulse" />
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchProducts() {
      try {
        const res = await fetch('/api/supplier/products');
        if (res.ok) {
          const json = await res.json();
          setProducts(Array.isArray(json) ? json : json.data ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }
    fetchProducts();
  }, []);

  async function handleDelist(id: string) {
    if (!confirm('确定要撤回这个产品吗？')) return;
    try {
      const res = await fetch(`/api/supplier/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'delisted' }),
      });
      if (res.ok) {
        setProducts((prev) =>
          prev.map((p) =>
            p.id === id ? { ...p, status: 'delisted' as ProductStatus } : p,
          ),
        );
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">我的产品</h2>
          <p className="mt-1 text-sm text-muted">
            管理您发布的产品与服务
          </p>
        </div>
        <Link
          href="/products/publish"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
        >
          <Plus className="h-4 w-4" />
          发布新产品
        </Link>
      </div>

      {/* Product Grid */}
      {loading ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : products.length === 0 ? (
        <div className="rounded-2xl bg-white border border-line shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-50 mb-4">
              <Inbox className="h-7 w-7 text-muted/40" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">
              还没有发布过产品
            </p>
            <p className="text-xs text-muted mb-5">
              发布您的第一个产品，让需求方找到您
            </p>
            <Link
              href="/products/publish"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition-all duration-160 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
            >
              <Plus className="h-4 w-4" />
              发布新产品
            </Link>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {products.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              onDelist={handleDelist}
            />
          ))}
        </div>
      )}
    </div>
  );
}
