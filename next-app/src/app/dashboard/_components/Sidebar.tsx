'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  User,
  ShoppingCart,
  Package,
  MessageSquare,
  Users,
  Shield,
  Settings,
  FileSearch,
  FlaskConical,
  LogOut,
  ChevronLeft,
  X,
  ArrowRightLeft,
  Building2,
  Key,
} from 'lucide-react';
import type { UserRole } from '@/types';

interface NavConfig {
  label: string;
  href: string;
  icon: React.ElementType;
}

interface UserInfo {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: UserRole;
}

interface SidebarProps {
  user: UserInfo | null;
}

const ROLE_LABELS: Record<string, string> = {
  buyer: '需求方',
  supplier: '供应商',
  opc_team: 'OPC团队',
  operator: '运营',
  admin: '管理员',
  guest: '访客',
};

function getNavItems(role: UserRole): NavConfig[] {
  const common: NavConfig[] = [
    { label: '工作台', href: '/dashboard', icon: LayoutDashboard },
    { label: '组织管理', href: '/dashboard/org', icon: Building2 },
    { label: 'API 密钥', href: '/dashboard/api-keys', icon: Key },
    { label: '个人资料', href: '/dashboard/profile', icon: User },
  ];

  const roleItems: Record<string, NavConfig[]> = {
    buyer: [
      { label: '我的需求', href: '/dashboard/demands', icon: ShoppingCart },
      { label: '消息', href: '/dashboard/messages', icon: MessageSquare },
    ],
    supplier: [
      { label: '我的产品', href: '/dashboard/products', icon: Package },
      { label: '收到的需求', href: '/dashboard/leads', icon: FileSearch },
      { label: '消息', href: '/dashboard/messages', icon: MessageSquare },
    ],
    opc_team: [
      { label: '匹配管理', href: '/dashboard/matching', icon: ArrowRightLeft },
      { label: 'POC 管理', href: '/dashboard/poc', icon: FlaskConical },
      { label: '消息', href: '/dashboard/messages', icon: MessageSquare },
    ],
    operator: [
      { label: '消息', href: '/dashboard/messages', icon: MessageSquare },
    ],
    admin: [
      { label: '用户管理', href: '/dashboard/admin/users', icon: Users },
      { label: '内容审核', href: '/dashboard/admin/reviews', icon: Shield },
      { label: '系统设置', href: '/dashboard/admin/settings', icon: Settings },
      { label: '消息', href: '/dashboard/messages', icon: MessageSquare },
    ],
  };

  return [...common, ...(roleItems[role] || [])];
}

export default function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Close mobile sidebar on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Close mobile sidebar on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        mobileOpen &&
        sidebarRef.current &&
        !sidebarRef.current.contains(e.target as Node)
      ) {
        setMobileOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [mobileOpen]);

  const navItems = getNavItems(user?.role || 'guest');

  async function handleLogout() {
    try {
      const { logoutAction } = await import('@/lib/session');
      await logoutAction();
      window.location.href = '/';
    } catch {
      window.location.reload();
    }
  }

  const sidebarContent = (
    <div className="flex h-full flex-col">
      {/* Logo / Brand */}
      <div className="flex items-center justify-between border-b border-line/60 px-4 py-5">
        <Link href="/" className="flex items-center gap-3">
          <span className="grid h-[32px] w-[32px] place-items-center rounded-[10px] bg-gradient-to-br from-primary to-violet text-white font-extrabold text-sm">
            U
          </span>
          {!collapsed && (
            <strong className="text-lg tracking-tight text-foreground">
              iWantU
            </strong>
          )}
        </Link>
        {/* Desktop collapse toggle */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="hidden lg:flex items-center justify-center h-7 w-7 rounded-lg text-muted hover:text-foreground hover:bg-[#f1f5f9] transition-all duration-160"
        >
          <ChevronLeft
            className={`h-4 w-4 transition-transform duration-160 ${collapsed ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-1">
          {navItems.map((item) => {
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href);
            const Icon = item.icon;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={`flex items-center gap-3 rounded-xl px-3 py-2.5 font-medium text-sm transition-all duration-160 ease-out ${
                    isActive
                      ? 'bg-primary/10 text-primary -translate-x-0.5'
                      : 'text-muted hover:text-foreground hover:bg-[#f8fafc]'
                  } ${collapsed ? 'justify-center' : ''}`}
                >
                  <Icon className="h-[18px] w-[18px] shrink-0" />
                  {!collapsed && <span>{item.label}</span>}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {/* User info at bottom */}
      {user && (
        <div className="border-t border-line/60 px-3 py-4">
          <div
            className={`flex items-center gap-3 ${collapsed ? 'justify-center' : ''}`}
          >
            {/* Avatar */}
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-violet text-white text-sm font-bold">
              {user.avatar ? (
                <img
                  src={user.avatar}
                  alt={user.name}
                  className="h-9 w-9 rounded-full object-cover"
                />
              ) : (
                user.name.charAt(0).toUpperCase()
              )}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-foreground">
                  {user.name}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-flex items-center rounded-md bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary">
                    {ROLE_LABELS[user.role] || user.role}
                  </span>
                </div>
              </div>
            )}
          </div>
          {!collapsed && (
            <button
              onClick={handleLogout}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-line px-3 py-2 text-sm font-medium text-muted transition-all duration-160 hover:text-red-600 hover:border-red-200 hover:bg-red-50"
            >
              <LogOut className="h-4 w-4" />
              退出登录
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Mobile hamburger button */}
      <button
        onClick={() => setMobileOpen(true)}
        className="fixed left-4 top-4 z-30 flex lg:hidden items-center justify-center h-10 w-10 rounded-xl border border-line bg-white shadow-[0_4px_16px_rgba(15,23,42,0.06)] text-muted hover:text-foreground transition-all duration-160"
        aria-label="打开菜单"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm lg:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile sidebar */}
      <div
        ref={sidebarRef}
        className={`fixed inset-y-0 left-0 z-50 w-[260px] bg-white border-r border-line/60 shadow-[0_8px_40px_rgba(15,23,42,0.1)] transform transition-transform duration-200 ease-out lg:hidden ${
          mobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Close button */}
        <button
          onClick={() => setMobileOpen(false)}
          className="absolute right-3 top-4 flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-[#f1f5f9] transition-colors duration-160"
          aria-label="关闭菜单"
        >
          <X className="h-4 w-4" />
        </button>
        {sidebarContent}
      </div>

      {/* Desktop sidebar */}
      <aside
        className={`hidden lg:flex flex-col border-r border-line/60 bg-white transition-all duration-200 ease-out ${
          collapsed ? 'w-[68px]' : 'w-[240px]'
        }`}
      >
        {sidebarContent}
      </aside>
    </>
  );
}
