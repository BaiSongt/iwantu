import type { MetricItem } from '@/types';

interface MetricGridProps {
  items: MetricItem[];
}

export default function MetricGrid({ items }: MetricGridProps) {
  return (
    <div className="grid grid-cols-2 gap-4 my-9 md:grid-cols-4 max-[720px]:grid-cols-1">
      {items.map((item, i) => (
        <article
          key={i}
          className="bg-panel border border-line rounded-xl p-5 shadow-[0_10px_26px_rgba(15,23,42,0.04)] animate-soft-pop transition-all duration-320 ease-out hover:-translate-y-1.5 hover:border-[#bfdbfe] hover:shadow-[0_24px_70px_rgba(21,94,239,0.16)]"
          style={{ animationDelay: `${i * 70}ms` }}
        >
          <strong className="block text-[26px]">{item.value}</strong>
          <span className="text-muted text-[13px]">{item.label}</span>
        </article>
      ))}
    </div>
  );
}
