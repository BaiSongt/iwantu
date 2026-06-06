'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_ITEMS } from '@/lib/constants';
import UserMenu from '@/components/auth/UserMenu';

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-20 flex h-[76px] items-center gap-4 border-b border-line bg-white/92 px-4 backdrop-blur-[18px] shadow-[0_8px_30px_rgba(15,23,42,0.04)] md:gap-9 md:px-[72px]">
      {/* Logo */}
      <Link href="/" className="flex items-center gap-3 min-w-[132px] shrink-0">
        <span className="grid h-[34px] w-[34px] place-items-center rounded-[10px] bg-gradient-to-br from-primary to-violet text-white font-extrabold animate-pulse-glow">
          U
        </span>
        <strong className="text-[22px] tracking-tight">iWantU</strong>
      </Link>

      {/* Navigation */}
      <nav className="flex flex-1 items-center gap-2 overflow-x-auto overscroll-x-contain scroll-snap-x-proximity scrollbar-thin">
        {NAV_ITEMS.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);

          return (
            <Link
              key={item.id}
              href={item.href}
              className={`shrink-0 rounded-lg px-3 py-2.5 font-medium text-sm whitespace-nowrap transition-all duration-160 ease-out scroll-snap-start ${
                isActive
                  ? 'text-primary bg-[#eff6ff] -translate-y-px'
                  : 'text-muted hover:text-primary hover:bg-[#eff6ff] hover:-translate-y-px'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      {/* Action Buttons & User Menu */}
      <div className="flex items-center gap-3 shrink-0 max-[720px]:w-full">
        <Link
          href="/demands/publish"
          className="hidden md:inline-flex items-center justify-center rounded-lg border border-line bg-white px-4 py-2.5 font-bold text-sm text-foreground transition-all duration-160 ease-out hover:-translate-y-0.5 hover:border-[#bfdbfe] hover:shadow-[0_12px_28px_rgba(15,23,42,0.08)] hover:text-primary"
        >
          发布需求
        </Link>
        <Link
          href="/products/publish"
          className="hidden md:inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2.5 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
        >
          发布产品
        </Link>
        <UserMenu />
      </div>
    </header>
  );
}
