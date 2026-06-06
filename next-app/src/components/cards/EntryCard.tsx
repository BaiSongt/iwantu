'use client';

import React from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';

interface EntryCardProps {
  num: string;
  title: string;
  desc: string;
  href: string;
  index?: number;
}

export default function EntryCard({ num, title, desc, href, index = 0 }: EntryCardProps) {
  return (
    <Link
      href={href}
      className="group block animate-fade-up rounded-2xl border border-line bg-panel p-6 transition-all duration-300 hover:-translate-y-[6px] hover:border-primary/30 hover:shadow-lg hover:shadow-primary/10 relative"
      style={{ animationDelay: `${index * 80}ms` }}
    >
      {/* Number */}
      <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-primary/8 text-sm font-bold text-primary">
        {num}
      </span>

      {/* Title */}
      <h3 className="mt-4 text-lg font-semibold text-foreground leading-snug group-hover:text-primary transition-colors">
        {title}
      </h3>

      {/* Description */}
      <p className="mt-2 text-sm text-muted/80 leading-relaxed line-clamp-2">
        {desc}
      </p>

      {/* Arrow indicator - positioned bottom-right */}
      <div className="absolute right-5 bottom-5 text-primary/40 transition-all group-hover:text-primary group-hover:translate-x-1">
        <ArrowRight className="h-5 w-5" />
      </div>
    </Link>
  );
}
