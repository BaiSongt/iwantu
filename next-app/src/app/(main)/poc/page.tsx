'use client';

import { POC_STEPS } from '@/lib/constants';
import SectionTitle from '@/components/ui/SectionTitle';
import StepFlow from '@/components/ui/StepFlow';

export default function PocPage() {
  return (
    <div className="mx-auto max-w-7xl px-6 pb-20">
      <SectionTitle
        title="POC流程页"
        desc="标准化POC验证流程，保障供需双方高效协作，每一步均有平台记录留痕。"
      />
      <StepFlow steps={POC_STEPS} />
    </div>
  );
}
