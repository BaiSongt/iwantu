'use client';

import { PRODUCTS } from '@/lib/constants';

const products = PRODUCTS.slice(0, 3);

const rows: { label: string; key: string }[] = [
  { label: '公司', key: 'company' },
  { label: '评分', key: 'score' },
  { label: '部署', key: 'deploy' },
  { label: '价格', key: 'price' },
  { label: '核心能力', key: 'tags' },
  { label: '适用场景', key: 'category' },
];

function getCellValue(product: (typeof products)[number], key: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const value = (product as any)[key];
  if (Array.isArray(value)) return (value as string[]).join('、');
  return String(value ?? '');
}

export default function ComparePage() {
  return (
    <section className="mx-auto max-w-6xl px-4 py-8 animate-fade-up">
      <h1 className="text-2xl font-bold text-foreground mb-1">产品对比</h1>
      <p className="text-sm text-muted mb-6">
        最多同时对比 3 款产品的核心参数与能力。
      </p>

      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full min-w-[640px] text-sm">
          {/* Product Header */}
          <thead>
            <tr className="bg-primary text-white">
              <th className="px-5 py-4 text-left font-semibold w-28">
                对比项
              </th>
              {products.map((p) => (
                <th key={p.id} className="px-5 py-4 text-left font-semibold">
                  {p.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => (
              <tr
                key={row.key}
                className={idx % 2 === 0 ? 'bg-white' : 'bg-gray-50'}
              >
                <td className="px-5 py-3.5 font-medium text-muted whitespace-nowrap">
                  {row.label}
                </td>
                {products.map((p) => (
                  <td
                    key={p.id}
                    className="px-5 py-3.5 text-foreground"
                  >
                    {row.key === 'tags'
                      ? (p.tags as string[]).map((tag) => (
                          <span
                            key={tag}
                            className="mr-1.5 mb-1 inline-block rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
                          >
                            {tag}
                          </span>
                        ))
                      : getCellValue(p, row.key)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
