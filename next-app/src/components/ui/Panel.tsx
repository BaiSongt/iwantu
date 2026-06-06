'use client';

import { ReactNode } from 'react';

interface PanelProps {
  title: string;
  icon?: ReactNode;
  items?: string[];
  children?: ReactNode;
}

export default function Panel({ title, icon, items, children }: PanelProps) {
  return (
    <div className="bg-panel border border-line rounded-xl p-5 animate-soft-pop">
      <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
        {icon}
        {title}
      </h3>
      {children}
      {items && (
        <ul className="divide-y divide-line">
          {items.map((item) => (
            <li key={item} className="py-2.5 text-sm text-foreground">
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
