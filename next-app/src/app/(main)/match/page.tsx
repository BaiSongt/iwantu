'use client';

import Link from 'next/link';
import { Brain } from 'lucide-react';
import { PRODUCTS, COMPANIES } from '@/lib/constants';
import SectionTitle from '@/components/ui/SectionTitle';
import TagCloud from '@/components/ui/TagCloud';
import ProductCard from '@/components/cards/ProductCard';
import CompanyCard from '@/components/cards/CompanyCard';
import RiskCard from '@/components/cards/RiskCard';

const MATCH_TAGS = ['制造业', 'RAG', '私有化', '权限控制', '答案溯源', '需要POC'];

export default function MatchPage() {
  const matchedProducts = PRODUCTS.slice(0, 3);
  const matchedCompanies = COMPANIES.slice(0, 2);

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 animate-fade-up">
      {/* Summary Card */}
      <div className="bg-white rounded-xl border border-line p-6 mb-10 animate-soft-pop">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground">需求摘要</h1>
            <p className="mt-1 text-sm text-muted max-w-2xl">
              某制造企业需要建设内部制度知识库问答系统，支持私有云部署、权限控制与答案溯源，预算 10-30 万，1 个月内交付，需要 POC 验证。
            </p>
          </div>
        </div>
        <div className="mt-3">
          <TagCloud tags={MATCH_TAGS} />
        </div>
      </div>

      {/* Recommended Products */}
      <section className="mb-12">
        <SectionTitle
          title="推荐产品"
          desc="基于需求智能匹配的AI产品，按匹配度排序"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {matchedProducts.map((product, i) => (
            <div
              key={product.id}
              style={{ '--stagger': `${i * 100}ms` } as React.CSSProperties}
            >
              <ProductCard product={product} />
            </div>
          ))}
        </div>
      </section>

      {/* Recommended Companies + Risk */}
      <section>
        <SectionTitle
          title="推荐公司与下一步建议"
          desc="匹配的供应商团队和采购风险提示"
        />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {matchedCompanies.map((company, i) => (
            <div
              key={company.id}
              style={{ '--stagger': `${i * 100}ms` } as React.CSSProperties}
            >
              <CompanyCard company={company} />
            </div>
          ))}

          <div style={{ '--stagger': '200ms' } as React.CSSProperties}>
            <RiskCard
              title="采购风险提示"
              description="建议在正式采购前完成POC验证，以降低选型风险。部分产品在制造业场景的案例数量有限，需重点验证文档解析和权限控制能力。建议优先选择支持 RAG 架构、可通过 POC 验证的专业知识库产品。"
              actionLabel="生成POC方案"
              onAction={() => {}}
            />
          </div>
        </div>
      </section>
    </div>
  );
}
