'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { SOLUTIONS, PRODUCTS, COMPANIES } from '@/lib/constants';
import SectionTitle from '@/components/ui/SectionTitle';
import DetailBlock from '@/components/ui/DetailBlock';
import TwoColumn from '@/components/ui/TwoColumn';
import Panel from '@/components/ui/Panel';
import TagCloud from '@/components/ui/TagCloud';

export default function SolutionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const solution = SOLUTIONS.find((s) => s.id === id);

  if (!solution) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <p className="text-sm text-muted">未找到该解决方案。</p>
        <Link href="/solutions" className="mt-4 inline-block text-sm text-primary hover:underline">
          返回解决方案列表
        </Link>
      </div>
    );
  }

  const recommendedProducts = PRODUCTS.filter((p) =>
    solution.recommendedProducts.includes(p.id),
  );
  const recommendedCompanies = COMPANIES.filter((c) =>
    solution.recommendedCompanies.includes(c.id),
  );

  const suitableItems = [
    '文档分散',
    '制度查询频繁',
    '工艺知识依赖专家',
    '需要私有化部署',
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 pb-20">
      {/* Back link */}
      <Link
        href="/solutions"
        className="mt-6 inline-flex items-center gap-1 text-sm text-muted hover:text-primary transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        返回解决方案列表
      </Link>

      <SectionTitle title={solution.title} desc={solution.summary} />

      <TwoColumn
        main={
          <div>
            {/* Architecture */}
            <DetailBlock title="方案架构" visuals>
              <div className="mt-3">
                <TagCloud tags={solution.components} />
              </div>
              <p className="mt-3 text-sm text-muted">
                支持 {solution.deploymentModes.join(' / ')} 部署，预算范围 {solution.budgetRange}，实施周期 {solution.deliveryPeriod}。
              </p>
            </DetailBlock>

            {/* Recommended products & companies */}
            <DetailBlock title="推荐产品与公司">
              {recommendedProducts.length > 0 && (
                <div className="mt-2">
                  <h4 className="mb-2 text-xs font-semibold text-muted">推荐产品</h4>
                  <div className="flex flex-wrap gap-2">
                    {recommendedProducts.map((product) => (
                      <Link
                        key={product.id}
                        href={`/products/${product.id}`}
                        className="inline-flex items-center rounded-lg bg-primary/8 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary hover:text-white transition-colors"
                      >
                        {product.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
              {recommendedCompanies.length > 0 && (
                <div className="mt-4">
                  <h4 className="mb-2 text-xs font-semibold text-muted">推荐供应商</h4>
                  <div className="flex flex-wrap gap-2">
                    {recommendedCompanies.map((company) => (
                      <Link
                        key={company.id}
                        href={`/companies/${company.id}`}
                        className="inline-flex items-center rounded-lg bg-violet/8 px-3 py-1.5 text-sm font-medium text-violet hover:bg-violet hover:text-white transition-colors"
                      >
                        {company.name}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </DetailBlock>

            {/* Implementation path */}
            <DetailBlock title="实施路径">
              <div className="space-y-3 mt-2">
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-white">1</span>
                  需求确认与方案设计 — 明确业务场景与验收标准
                </div>
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet text-xs font-bold text-white">2</span>
                  POC 验证 — 小范围试点，验证核心指标
                </div>
                <div className="flex items-center gap-3 text-sm text-foreground">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green text-xs font-bold text-white">3</span>
                  正式交付与运维 — 全量部署、培训与持续优化
                </div>
              </div>
            </DetailBlock>
          </div>
        }
        side={
          <div className="space-y-6">
            <Panel title="适用企业" items={suitableItems} />
            {solution.supportPoc && (
              <div className="rounded-2xl border border-line bg-panel p-6 shadow-[0_10px_26px_rgba(15,23,42,0.04)]">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-full bg-green" />
                  <span className="text-sm font-bold text-green">支持 POC 验证</span>
                </div>
                <p className="mt-2 text-sm text-muted">可先试点再采购，降低决策风险。</p>
              </div>
            )}
          </div>
        }
      />
    </div>
  );
}
