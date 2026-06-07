'use client';

import Link from 'next/link';
import { FileQuestion } from 'lucide-react';

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: string;
  action?: { label: string; href: string };
}

export default function EmptyState({
  icon,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-line bg-white px-6 py-16 text-center shadow-[0_8px_40px_rgba(15,23,42,0.06)]">
      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/8 text-muted">
        {icon ?? <FileQuestion className="h-8 w-8" />}
      </div>
      <h3 className="text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm text-muted">{description}</p>
      )}
      {action && (
        <Link
          href={action.href}
          className="mt-5 inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
        >
          {action.label}
        </Link>
      )}
    </div>
  );
}
