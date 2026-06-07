'use client';

import { useState } from 'react';
import { ChevronDown, SlidersHorizontal, X } from 'lucide-react';

export interface FilterOption {
  label: string;
  value: string;
}

export interface FilterGroupDef {
  key: string;
  label: string;
  type: 'select' | 'toggle' | 'range';
  options?: FilterOption[];
  placeholder?: string;
}

interface FilterPanelProps {
  groups: FilterGroupDef[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onClear?: () => void;
}

export default function FilterPanel({ groups, values, onChange, onClear }: FilterPanelProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const toggle = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const hasActiveFilters = Object.values(values).some((v) => v !== '' && v !== undefined);

  return (
    <aside className="bg-panel border border-line rounded-xl p-5 shadow-[0_10px_26px_rgba(15,23,42,0.04)] sticky top-24 transition-all duration-320 ease-out hover:-translate-y-1.5 hover:border-[#bfdbfe] hover:shadow-[0_24px_70px_rgba(21,94,239,0.16)]">
      <div className="flex items-center justify-between mb-4">
        <h2 className="flex items-center gap-2 m-0 text-lg font-bold">
          <SlidersHorizontal className="h-[18px] w-[18px] text-primary" />
          筛选条件
        </h2>
        {hasActiveFilters && onClear && (
          <button
            onClick={onClear}
            className="flex items-center gap-1 border-0 bg-transparent text-xs text-muted cursor-pointer hover:text-primary transition-colors"
          >
            <X className="h-3 w-3" />
            清除
          </button>
        )}
      </div>

      {groups.map((group) => (
        <div key={group.key} className="py-4 border-t border-line">
          <button
            onClick={() => toggle(group.key)}
            className="w-full flex justify-between items-center border-0 bg-transparent p-0 pb-2 font-extrabold text-foreground cursor-pointer"
          >
            {group.label}
            <ChevronDown
              className={`h-4 w-4 transition-transform duration-200 ${collapsed[group.key] ? '' : 'rotate-180'}`}
            />
          </button>
          {!collapsed[group.key] && (
            <div className="pt-1">
              {group.type === 'select' && group.options && (
                <div className="space-y-1">
                  <label className="flex items-center gap-2 py-1.5 text-muted text-sm cursor-pointer">
                    <input
                      type="radio"
                      name={group.key}
                      checked={!values[group.key] || values[group.key] === ''}
                      onChange={() => onChange(group.key, '')}
                      className="accent-primary"
                    />
                    全部
                  </label>
                  {group.options.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 py-1.5 text-muted text-sm cursor-pointer">
                      <input
                        type="radio"
                        name={group.key}
                        checked={values[group.key] === opt.value}
                        onChange={() => onChange(group.key, opt.value)}
                        className="accent-primary"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              )}

              {group.type === 'toggle' && group.options && (
                <div className="space-y-1">
                  <label className="flex items-center gap-2 py-1.5 text-muted text-sm cursor-pointer">
                    <input
                      type="radio"
                      name={group.key}
                      checked={!values[group.key] || values[group.key] === ''}
                      onChange={() => onChange(group.key, '')}
                      className="accent-primary"
                    />
                    全部
                  </label>
                  {group.options.map((opt) => (
                    <label key={opt.value} className="flex items-center gap-2 py-1.5 text-muted text-sm cursor-pointer">
                      <input
                        type="radio"
                        name={group.key}
                        checked={values[group.key] === opt.value}
                        onChange={() => onChange(group.key, opt.value)}
                        className="accent-primary"
                      />
                      {opt.label}
                    </label>
                  ))}
                </div>
              )}

              {group.type === 'range' && (
                <div className="flex gap-2 items-center">
                  <input
                    type="number"
                    placeholder={group.placeholder ?? '最小值'}
                    value={values[group.key]?.split('-')[0] ?? ''}
                    onChange={(e) => {
                      const parts = (values[group.key] ?? '-').split('-');
                      onChange(group.key, `${e.target.value}-${parts[1] ?? ''}`);
                    }}
                    className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                  <span className="text-muted text-sm">-</span>
                  <input
                    type="number"
                    placeholder="最大值"
                    value={values[group.key]?.split('-')[1] ?? ''}
                    onChange={(e) => {
                      const parts = (values[group.key] ?? '-').split('-');
                      onChange(group.key, `${parts[0] ?? ''}-${e.target.value}`);
                    }}
                    className="w-full rounded-lg border border-line bg-transparent px-3 py-2 text-sm text-foreground focus:border-primary focus:outline-none"
                  />
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </aside>
  );
}
