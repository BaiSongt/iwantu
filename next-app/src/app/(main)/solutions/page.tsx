'use client';

import { SOLUTIONS } from '@/lib/constants';
import SolutionCard from '@/components/cards/SolutionCard';
import SectionTitle from '@/components/ui/SectionTitle';

export default function SolutionsPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 pb-20">
      <SectionTitle
        title="解决方案专区"
        desc="覆盖制造业、金融、政企、研发等行业的端到端AI解决方案。"
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {SOLUTIONS.map((solution, i) => (
          <div key={solution.id} style={{ '--stagger': `${i * 60}ms` } as React.CSSProperties}>
            <SolutionCard solution={solution} />
          </div>
        ))}
      </div>
    </div>
  );
}
