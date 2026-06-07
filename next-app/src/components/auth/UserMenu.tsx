'use client';

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import { User, LogOut, ChevronDown, Loader2 } from 'lucide-react';

interface UserInfo {
  id: string;
  name: string;
  email: string;
  avatar?: string;
  role: string;
}

export default function UserMenu() {
  const [user, setUser] = useState<UserInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const json = await res.json();
          setUser(json.user);
        }
      } catch {
        // Not authenticated
      } finally {
        setLoading(false);
      }
    }
    fetchUser();
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function handleLogout() {
    try {
      const { logoutAction } = await import('@/lib/session');
      await logoutAction();
      setUser(null);
      setOpen(false);
      window.location.reload();
    } catch {
      // Force reload on error
      window.location.reload();
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2">
        <Loader2 className="h-4 w-4 animate-spin text-muted" />
      </div>
    );
  }

  // Not logged in - show login/register buttons
  if (!user) {
    return (
      <div className="flex items-center gap-2">
        <Link
          href="/auth/login"
          className="inline-flex items-center justify-center rounded-lg px-4 py-2 font-medium text-sm text-foreground transition-all duration-160 ease-out hover:text-primary hover:bg-[#eff6ff]"
        >
          登录
        </Link>
        <Link
          href="/auth/register"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-2 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
        >
          注册
        </Link>
      </div>
    );
  }

  // Logged in - show avatar dropdown
  const roleLabels: Record<string, string> = {
    buyer: '需求方',
    supplier: '供应商',
    opc_team: 'OPC团队',
    operator: '运营',
    admin: '管理员',
  };

  return (
    <div ref={menuRef} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 rounded-lg px-3 py-2 transition-all duration-160 ease-out hover:bg-[#f1f5f9]"
      >
        {/* Avatar */}
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-violet text-white text-xs font-bold">
          {user.avatar ? (
            <img src={user.avatar} alt={user.name} className="h-8 w-8 rounded-full object-cover" />
          ) : (
            user.name.charAt(0).toUpperCase()
          )}
        </div>
        <div className="hidden sm:block text-left">
          <div className="text-sm font-semibold text-foreground leading-tight">{user.name}</div>
          <div className="text-xs text-muted leading-tight">{roleLabels[user.role] || user.role}</div>
        </div>
        <ChevronDown
          className={`h-4 w-4 text-muted transition-transform duration-160 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full mt-1 w-52 rounded-xl border border-line bg-white shadow-[0_8px_30px_rgba(15,23,42,0.08)] py-1.5 z-50 animate-[fade-up_0.15s_ease-out]">
          {/* User info */}
          <div className="px-4 py-3 border-b border-line">
            <div className="text-sm font-semibold text-foreground">{user.name}</div>
            <div className="text-xs text-muted truncate">{user.email}</div>
          </div>

          {/* Menu items */}
          <Link
            href="/dashboard"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-foreground hover:bg-[#f8fafc] transition-colors duration-100"
          >
            <User className="h-4 w-4 text-muted" />
            个人中心
          </Link>

          <button
            onClick={handleLogout}
            className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors duration-100"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      )}
    </div>
  );
}
