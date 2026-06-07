'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Users,
  Search,
  Filter,
  Loader2,
  Inbox,
  Shield,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import type { UserRole } from '@/types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface UserRow {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  role: UserRole;
  orgId: string | null;
  orgName: string | null;
  orgLogo: string | null;
  phone: string | null;
  emailVerified: string | null;
  createdAt: string;
}

interface UserListResponse {
  items: UserRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ------------------------------------------------------------------ */
/*  Role config                                                        */
/* ------------------------------------------------------------------ */

const ROLE_OPTIONS: { value: string; label: string; bg: string; text: string }[] = [
  { value: 'guest', label: '访客', bg: 'bg-gray-100', text: 'text-gray-600' },
  { value: 'buyer', label: '需求方', bg: 'bg-blue-50', text: 'text-blue-600' },
  { value: 'supplier', label: '供应商', bg: 'bg-green-50', text: 'text-green-600' },
  { value: 'opc_team', label: 'OPC团队', bg: 'bg-purple-50', text: 'text-purple-600' },
  { value: 'operator', label: '运营', bg: 'bg-amber-50', text: 'text-amber-600' },
  { value: 'admin', label: '管理员', bg: 'bg-red-50', text: 'text-red-600' },
];

const ROLE_MAP = Object.fromEntries(ROLE_OPTIONS.map((r) => [r.value, r]));

/* ------------------------------------------------------------------ */
/*  Role Badge                                                         */
/* ------------------------------------------------------------------ */

function RoleBadge({ role }: { role: string }) {
  const cfg = ROLE_MAP[role] ?? { label: role, bg: 'bg-gray-100', text: 'text-gray-600' };
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${cfg.bg} ${cfg.text}`}>
      {cfg.label}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Avatar                                                             */
/* ------------------------------------------------------------------ */

function UserAvatar({ name, avatar }: { name: string; avatar: string | null }) {
  if (avatar) {
    return (
      <img src={avatar} alt={name} className="h-8 w-8 rounded-full object-cover" />
    );
  }
  return (
    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-primary to-violet text-white text-xs font-bold">
      {name.charAt(0).toUpperCase()}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton row                                                       */
/* ------------------------------------------------------------------ */

function SkeletonRow() {
  return (
    <tr className="border-b border-line/40">
      <td className="py-3 px-4"><div className="h-8 w-8 rounded-full bg-gray-100 animate-pulse" /></td>
      <td className="py-3 px-4"><div className="h-4 w-24 rounded bg-gray-100 animate-pulse" /></td>
      <td className="py-3 px-4"><div className="h-4 w-32 rounded bg-gray-50 animate-pulse" /></td>
      <td className="py-3 px-4"><div className="h-5 w-14 rounded-md bg-gray-50 animate-pulse" /></td>
      <td className="py-3 px-4"><div className="h-4 w-20 rounded bg-gray-50 animate-pulse" /></td>
      <td className="py-3 px-4"><div className="h-4 w-16 rounded bg-gray-50 animate-pulse" /></td>
      <td className="py-3 px-4"><div className="h-7 w-16 rounded-lg bg-gray-50 animate-pulse" /></td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const limit = 15;

  const fetchUsers = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (search) params.set('search', search);
      if (roleFilter) params.set('role', roleFilter);

      const res = await fetch(`/api/admin/users?${params}`);
      if (res.ok) {
        const json = await res.json();
        const data = json.data as UserListResponse;
        setUsers(data.items);
        setTotal(data.total);
        setTotalPages(data.totalPages);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, [page, search, roleFilter]);

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  function handleSearch() {
    setPage(1);
    fetchUsers();
  }

  function handleRoleChange(role: string) {
    setRoleFilter(role);
    setPage(1);
  }

  async function handleChangeRole(userId: string, newRole: string) {
    if (!confirm(`确定要将该用户角色更改为「${ROLE_MAP[newRole]?.label ?? newRole}」吗？`)) return;
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: newRole }),
      });
      if (res.ok) {
        await fetchUsers();
      } else {
        const json = await res.json();
        alert(json.error || '更新角色失败');
      }
    } catch {
      alert('网络错误，请重试');
    }
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground">用户管理</h2>
        <p className="mt-1 text-sm text-muted">
          管理平台所有用户账户与角色权限
        </p>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
          <Search className="h-4 w-4 text-muted" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="搜索用户名或邮箱…"
            className="w-48 bg-transparent text-sm text-foreground placeholder:text-muted outline-none"
          />
        </div>

        {/* Role filter */}
        <div className="flex items-center gap-2 rounded-xl border border-line bg-white px-3 py-2 shadow-[0_4px_16px_rgba(15,23,42,0.04)]">
          <Filter className="h-4 w-4 text-muted" />
          <select
            value={roleFilter}
            onChange={(e) => handleRoleChange(e.target.value)}
            className="bg-transparent text-sm text-foreground outline-none cursor-pointer"
          >
            <option value="">全部角色</option>
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>

        {/* Count */}
        <span className="text-xs text-muted ml-auto">
          共 {total} 位用户
        </span>
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-line bg-white shadow-[0_8px_40px_rgba(15,23,42,0.08)] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-line bg-gray-50/50">
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">头像</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">姓名</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">邮箱</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">角色</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">组织</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">状态</th>
                <th className="py-3 px-4 text-left text-xs font-semibold text-muted">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <>
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                  <SkeletonRow />
                </>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-50 mb-3">
                        <Inbox className="h-6 w-6 text-muted/40" />
                      </div>
                      <p className="text-sm text-muted">暂无用户数据</p>
                    </div>
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="border-b border-line/40 hover:bg-gray-50/50 transition-colors">
                    <td className="py-3 px-4">
                      <UserAvatar name={user.name} avatar={user.avatar} />
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-sm font-medium text-foreground">{user.name}</p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-sm text-muted">{user.email}</p>
                    </td>
                    <td className="py-3 px-4">
                      <RoleBadge role={user.role} />
                    </td>
                    <td className="py-3 px-4">
                      <p className="text-sm text-muted">{user.orgName ?? '-'}</p>
                    </td>
                    <td className="py-3 px-4">
                      {user.emailVerified ? (
                        <span className="inline-flex items-center gap-1 text-xs text-green-600">
                          <Shield className="h-3 w-3" />
                          已验证
                        </span>
                      ) : (
                        <span className="text-xs text-muted">未验证</span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      <select
                        value={user.role}
                        onChange={(e) => handleChangeRole(user.id, e.target.value)}
                        className="rounded-lg border border-line bg-white px-2 py-1 text-xs text-foreground outline-none focus:border-primary cursor-pointer hover:bg-gray-50 transition-colors"
                      >
                        {ROLE_OPTIONS.map((r) => (
                          <option key={r.value} value={r.value}>{r.label}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between border-t border-line px-4 py-3">
            <span className="text-xs text-muted">
              第 {page} 页 / 共 {totalPages} 页
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted hover:text-foreground hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted hover:text-foreground hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
