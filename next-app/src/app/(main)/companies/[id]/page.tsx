'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { COMPANIES } from '@/lib/constants';
import TagCloud from '@/components/ui/TagCloud';
import Panel from '@/components/ui/Panel';

export default function CompanyProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const company = COMPANIES.find((c) => c.id === id);

  if (!company) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-10">
        <p className="text-sm text-muted">未找到该公司信息。</p>
        <Link href="/companies" className="mt-4 inline-block text-sm text-primary hover:underline">
          返回公司列表
        </Link>
      </div>
    );
  }

  const serviceCommitments = [
    '48小时响应',
    '标准验收指标',
    '交付资料归档',
    '平台沟通留痕',
  ];

  return (
    <div className="mx-auto max-w-7xl px-6 pb-20">
      {/* Back link */}
      <Link
        href="/companies"
        className="mt-6 inline-flex items-center gap-1 text-sm text-muted hover:text-primary transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        返回公司列表
      </Link>

      {/* Profile hero */}
      <div className="mt-6 animate-fade-up rounded-2xl border border-line bg-panel p-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-violet/20 text-xl font-bold text-primary">
            {company.name.slice(0, 2)}
          </div>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-foreground">{company.name}</h1>
            <p className="mt-1 text-sm text-muted">{company.slogan}</p>
          </div>
          {company.certified && (
            <span className="rounded-full bg-green/10 px-3 py-1 text-xs font-medium text-green">
              平台认证
            </span>
          )}
        </div>
        <div className="mt-4">
          <TagCloud tags={company.certifications} />
        </div>
      </div>

      {/* Dashboard grid */}
      <div className="mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <Panel title="核心能力" items={company.capabilities} />
        <Panel title="交付案例" items={company.caseStudies} />
        <Panel title="服务承诺" items={serviceCommitments} />
      </div>

      {/* Delivery scope */}
      <div className="mt-6 rounded-2xl border border-line bg-panel p-6">
        <h2 className="text-lg font-bold text-foreground">交付范围</h2>
        <div className="mt-3">
          <TagCloud tags={company.deliveryScope} />
        </div>
      </div>
    </div>
  );
}
