'use client';

import { COMPANIES } from '@/lib/constants';
import CompanyCard from '@/components/cards/CompanyCard';
import SectionTitle from '@/components/ui/SectionTitle';

export default function CompaniesPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 pb-20">
      <SectionTitle
        title="AI公司与OPC"
        desc="精选平台认证AI供应商，涵盖知识库、Agent开发、工业AI等核心能力。"
      />
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {COMPANIES.map((company, i) => (
          <div key={company.id} style={{ '--stagger': `${i * 60}ms` } as React.CSSProperties}>
            <CompanyCard company={company} />
          </div>
        ))}
      </div>
    </div>
  );
}
