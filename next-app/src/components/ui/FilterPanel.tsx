'use client';

import { useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';

interface FilterPanelProps {
  groups: string[];
}

export default function FilterPanel({ groups }: FilterPanelProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (label: string) => {
    setCollapsed((prev) => ({ ...prev, [label]: !prev[label] }));
  };

  return (
    <aside className="bg-panel border border-line rounded-xl p-5 shadow-[0_10px_26px_rgba(15,23,42,0.04)] sticky top-24 transition-all duration-320 ease-out hover:-translate-y-1.5 hover:border-[#bfdbfe] hover:shadow-[0_24px_70px_rgba(21,94,239,0.16)]">
      <h2 className="flex items-center gap-2 m-0 mb-4 text-lg font-bold">
        <SlidersHorizontal className="h-[18px] w-[18px] text-primary" />
        筛选条件
      </h2>

      {groups.map((group) => (
        <div key={group} className="py-4 border-t border-line">
          <button
            onClick={() => toggle(group)}
            className="w-full flex justify-between items-center border-0 bg-transparent p-0 pb-2 font-extrabold text-foreground cursor-pointer"
          >
            {group}
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${collapsed[group] ? '' : 'rotate-180'}`}
            />
          </button>
          {!collapsed[group] && (
            <div className="space-y-1 pt-1">
              <label className="flex items-center gap-2 py-1.5 text-muted text-sm cursor-pointer">
                <input type="checkbox" className="accent-primary" />
                全部
              </label>
              <label className="flex items-center gap-2 py-1.5 text-muted text-sm cursor-pointer">
                <input type="checkbox" className="accent-primary" />
                选项A
              </label>
              <label className="flex items-center gap-2 py-1.5 text-muted text-sm cursor-pointer">
                <input type="checkbox" className="accent-primary" />
                选项B
              </label>
            </div>
          )}
        </div>
      ))}
    </aside>
  );
}
