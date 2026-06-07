'use client';

import { use, useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ChevronRight,
  Building2,
  Star,
  FileCheck,
  MessageSquare,
  GitCompare,
  Shield,
  Loader2,
} from 'lucide-react';
import type { Product } from '@/types';
import VisualShot from '@/components/ui/VisualShot';
import TagCloud from '@/components/ui/TagCloud';
import InfoRows from '@/components/ui/InfoRows';
import Tabs from '@/components/ui/Tabs';
import DetailBlock from '@/components/ui/DetailBlock';
import Panel from '@/components/ui/Panel';

export default function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState(0);

  const fetchProduct = useCallback(async () => {
    setLoading(true);
    setNotFound(false);
    try {
      const res = await fetch(`/api/public/products/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          setNotFound(true);
        }
        return;
      }
      const data = await res.json();
      setProduct(data);
    } catch {
      // network error — leave product null
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchProduct();
  }, [fetchProduct]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-20 flex flex-col items-center justify-center animate-fade-up">
        <Loader2 className="h-8 w-8 text-primary animate-spin mb-4" />
        <p className="text-sm text-muted">加载中...</p>
      </div>
    );
  }

  if (notFound || !product) {
    return (
      <section className="mx-auto max-w-7xl px-6 py-20 text-center animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground mb-3">
          产品未找到
        </h1>
        <p className="text-muted mb-6">
          未找到对应的产品信息，请返回产品列表重新查找。
        </p>
        <Link
          href="/products"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
        >
          返回产品列表
        </Link>
      </section>
    );
  }

  const tabs = ['产品概览', '技术参数', '案例展示', '用户评价'];
  const infoRows: [string, string][] = [
    ['评分', product.score],
    ['部署方式', product.deploy],
    ['价格模式', product.price],
    ['案例数量', `${product.caseCount} 个`],
    ['POC次数', `${product.pocCount} 次`],
    ['支持POC', product.supportPoc ? '是' : '否'],
    ['私有化部署', product.supportPrivateDeployment ? '支持' : '不支持'],
  ];

  return (
    <section className="mx-auto max-w-7xl px-6 py-10 animate-fade-up">
      {/* Top 3-column layout */}
      <div className="grid grid-cols-1 gap-8 items-start lg:grid-cols-[1fr_1fr_340px]">
        {/* Gallery */}
        <div>
          <VisualShot variant={product.shot} accent={product.accent} />
          <div className="mt-4 grid grid-cols-3 gap-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-20 rounded-lg border border-line bg-slate-50"
              />
            ))}
          </div>
        </div>

        {/* Decision Info */}
        <div>
          {/* Breadcrumb */}
          <nav className="flex items-center gap-1.5 text-xs text-muted mb-4">
            <Link href="/products" className="hover:text-primary transition-colors">
              AI产品
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground">{product.name}</span>
          </nav>

          {/* Title & Company */}
          <h1 className="text-2xl font-bold text-foreground mb-1">
            {product.name}
          </h1>
          <div className="flex items-center gap-2 text-sm text-muted mb-5">
            <Building2 className="h-4 w-4" />
            <span>{product.company}</span>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-4 mb-5">
            <span className="inline-flex items-center gap-1 text-sm">
              <Star className="h-4 w-4 text-orange" />
              <span className="font-semibold text-foreground">{product.score}</span>
            </span>
            <span className="h-4 w-px bg-line" />
            <span className="text-sm text-muted">{product.caseCount} 个案例</span>
            <span className="h-4 w-px bg-line" />
            <span className="text-sm text-muted">{product.pocCount} 次POC</span>
          </div>

          {/* Tags */}
          <div className="mb-5">
            <TagCloud tags={product.tags} />
          </div>

          {/* Info Rows */}
          <InfoRows rows={infoRows} />
        </div>

        {/* Consult Sidebar */}
        <div className="space-y-4">
          <Panel title="咨询与操作" icon={<Shield className="h-5 w-5 text-primary" />}>
            {/* Price */}
            <div className="mb-4 pb-4 border-b border-line">
              <p className="text-xs text-muted mb-1">价格</p>
              <p className="text-xl font-bold text-primary">{product.price}</p>
            </div>

            {/* Actions */}
            <div className="space-y-3">
              <Link
                href="/poc"
                className="flex items-center justify-center gap-2 w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
              >
                <FileCheck className="h-4 w-4" />
                申请POC
              </Link>
              <Link
                href="/messages"
                className="flex items-center justify-center gap-2 w-full rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-foreground hover:border-primary/30 hover:text-primary transition-colors"
              >
                <MessageSquare className="h-4 w-4" />
                联系供应商
              </Link>
              <Link
                href="/compare"
                className="flex items-center justify-center gap-2 w-full rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-foreground hover:border-primary/30 hover:text-primary transition-colors"
              >
                <GitCompare className="h-4 w-4" />
                加入对比
              </Link>
            </div>

            {/* Safety Note */}
            <div className="mt-4 p-3 rounded-lg bg-amber-50 border border-amber-200">
              <p className="text-xs text-amber-700 leading-relaxed">
                所有交易均通过平台担保，资金安全有保障。建议先完成POC验证再进行采购决策。
              </p>
            </div>
          </Panel>
        </div>
      </div>

      {/* Tabs */}
      <Tabs tabs={tabs} activeIndex={activeTab} onChange={setActiveTab} />

      {/* Tab Content */}
      <div>
        {activeTab === 0 && (
          <DetailBlock title="产品概览">
            <p className="text-sm text-muted leading-relaxed mt-3">
              {product.summary}
            </p>
            <div className="mt-6 grid grid-cols-3 gap-6 max-w-2xl">
              <div className="h-[82px] grid place-items-center rounded-[10px] text-primary bg-[#eff6ff] font-extrabold text-sm">
                能力标签
              </div>
              <div className="h-[82px] grid place-items-center rounded-[10px] text-primary bg-[#eff6ff] font-extrabold text-sm">
                行业场景
              </div>
              <div className="h-[82px] grid place-items-center rounded-[10px] text-primary bg-[#eff6ff] font-extrabold text-sm">
                部署方式
              </div>
            </div>
          </DetailBlock>
        )}

        {activeTab === 1 && (
          <DetailBlock title="技术参数">
            <div className="mt-4 space-y-3">
              <div className="flex justify-between py-2.5 border-b border-line text-sm">
                <span className="text-muted">部署方式</span>
                <span className="font-medium">{product.deploy}</span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-line text-sm">
                <span className="text-muted">价格模式</span>
                <span className="font-medium">{product.price}</span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-line text-sm">
                <span className="text-muted">支持POC</span>
                <span className="font-medium">{product.supportPoc ? '是' : '否'}</span>
              </div>
              <div className="flex justify-between py-2.5 border-b border-line text-sm">
                <span className="text-muted">私有化部署</span>
                <span className="font-medium">{product.supportPrivateDeployment ? '支持' : '不支持'}</span>
              </div>
            </div>
          </DetailBlock>
        )}

        {activeTab === 2 && (
          <DetailBlock title="案例展示">
            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
              {[1, 2, 3, 4].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border border-line p-5 hover:border-primary/30 transition-colors"
                >
                  <div className="h-3 w-2/3 rounded-full bg-slate-100 mb-3" />
                  <div className="h-2 w-full rounded-full bg-slate-50 mb-2" />
                  <div className="h-2 w-4/5 rounded-full bg-slate-50" />
                </div>
              ))}
            </div>
          </DetailBlock>
        )}

        {activeTab === 3 && (
          <DetailBlock title="用户评价">
            <div className="mt-4 space-y-4">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="rounded-xl border border-line p-5"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="h-8 w-8 rounded-full bg-slate-100" />
                    <div>
                      <div className="h-3 w-20 rounded-full bg-slate-100" />
                    </div>
                  </div>
                  <div className="h-2 w-full rounded-full bg-slate-50 mb-2" />
                  <div className="h-2 w-3/4 rounded-full bg-slate-50" />
                </div>
              ))}
            </div>
          </DetailBlock>
        )}
      </div>
    </section>
  );
}
