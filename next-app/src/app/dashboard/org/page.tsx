'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Building2,
  Users,
  UserPlus,
  Shield,
  Edit,
  Trash2,
  Crown,
  Loader2,
  CheckCircle2,
  XCircle,
  X,
} from 'lucide-react';
import type { User, IndustryTag } from '@/types';

// ── Constants ──────────────────────────────────────────────

const ORG_TYPES = [
  { value: 'buyer', label: '需求方', color: 'bg-blue-100 text-blue-700' },
  { value: 'supplier', label: '供应商', color: 'bg-green-100 text-green-700' },
  { value: 'opc_team', label: 'OPC团队', color: 'bg-purple-100 text-purple-700' },
] as const;

const INDUSTRY_OPTIONS: { value: IndustryTag; label: string }[] = [
  { value: 'manufacturing', label: '制造业' },
  { value: 'government', label: '政务' },
  { value: 'finance', label: '金融' },
  { value: 'education', label: '教育' },
  { value: 'research', label: '科研' },
  { value: 'healthcare', label: '医疗健康' },
  { value: 'retail', label: '零售' },
  { value: 'energy', label: '能源' },
  { value: 'industrial_software', label: '工业软件' },
];

const ROLE_CONFIG: Record<string, { label: string; color: string; icon: typeof Crown }> = {
  owner: { label: '所有者', color: 'bg-amber-100 text-amber-700 border-amber-200', icon: Crown },
  admin: { label: '管理员', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: Shield },
  member: { label: '成员', color: 'bg-gray-100 text-gray-600 border-gray-200', icon: Users },
};

// ── Types ──────────────────────────────────────────────────

interface OrgMember {
  id: string;
  role: string;
  createdAt: string;
  user: { id: string; name: string; email: string; avatar: string | null };
}

interface OrgData {
  id: string;
  name: string;
  logo: string | null;
  type: string;
  industry: string | null;
  description: string | null;
  certified: boolean;
  memberCount: number;
  members?: OrgMember[];
}

// ── Component ──────────────────────────────────────────────

export default function OrgManagementPage() {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [org, setOrg] = useState<OrgData | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Form state
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [showInviteForm, setShowInviteForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Create form fields
  const [createForm, setCreateForm] = useState({
    name: '',
    type: 'buyer' as string,
    industry: '',
    description: '',
  });

  // Edit form fields
  const [editForm, setEditForm] = useState({
    name: '',
    industry: '',
    description: '',
  });

  // Invite form fields
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');

  const fetchOrgData = useCallback(async () => {
    try {
      // Fetch current user
      const meRes = await fetch('/api/auth/me');
      if (!meRes.ok) throw new Error('获取用户信息失败');
      const meData = await meRes.json();
      const user = (meData.user ?? meData.data) as User | null;
      if (user) setCurrentUser(user);

      if (!user?.orgId) {
        setLoading(false);
        return;
      }

      const [orgRes, membersRes] = await Promise.all([
        fetch(`/api/organizations/${user.orgId}`),
        fetch(`/api/organizations/${user.orgId}/members`),
      ]);

      if (!orgRes.ok) throw new Error('获取组织信息失败');

      const orgData = await orgRes.json();
      setOrg(orgData.data ?? orgData);
      setEditForm({
        name: (orgData.data ?? orgData).name || '',
        industry: (orgData.data ?? orgData).industry || '',
        description: (orgData.data ?? orgData).description || '',
      });

      if (membersRes.ok) {
        const membersData = await membersRes.json();
        const list = membersData.data ?? (Array.isArray(membersData) ? membersData : membersData.items ?? []);
        setMembers(list);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrgData();
  }, [fetchOrgData]);

  // ── Create Org ──────────────────────────────────────────

  async function handleCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch('/api/organizations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(createForm),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '创建失败');

      setCreateForm({ name: '', type: 'buyer', industry: '', description: '' });
      setShowCreateForm(false);

      // Refetch everything since the user now has an orgId
      setLoading(true);
      await fetchOrgData();
    } catch (err) {
      setError(err instanceof Error ? err.message : '创建失败');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Update Org ──────────────────────────────────────────

  async function handleUpdateOrg(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch(`/api/organizations/${org.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(editForm),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '更新失败');

      const updated = data.data ?? data;
      setOrg(updated);
      setEditMode(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新失败');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Invite Member ───────────────────────────────────────

  async function handleInviteMember(e: React.FormEvent) {
    e.preventDefault();
    if (!org) return;
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch(`/api/organizations/${org.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '邀请失败');

      // Refresh members list
      const membersRes = await fetch(`/api/organizations/${org.id}/members`);
      if (membersRes.ok) {
        const membersData = await membersRes.json();
        const list = membersData.data ?? (Array.isArray(membersData) ? membersData : membersData.items ?? []);
        setMembers(list);
      }

      setOrg((prev) => prev ? { ...prev, memberCount: prev.memberCount + 1 } : prev);

      setInviteEmail('');
      setInviteRole('member');
      setShowInviteForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '邀请失败');
    } finally {
      setSubmitting(false);
    }
  }

  // ── Remove Member ───────────────────────────────────────

  async function handleRemoveMember(userId: string) {
    if (!org) return;
    setError('');

    try {
      const res = await fetch(`/api/organizations/${org.id}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '移除失败');

      setMembers((prev) => prev.filter((m) => m.user.id !== userId));
      setOrg((prev) => prev ? { ...prev, memberCount: prev.memberCount - 1 } : prev);
    } catch (err) {
      setError(err instanceof Error ? err.message : '移除失败');
    }
  }

  // ── Helpers ──────────────────────────────────────────────

  function getUserMembership(): OrgMember | undefined {
    if (!currentUser) return undefined;
    return members.find((m) => m.user.id === currentUser.id);
  }

  function isAdminOrOwner(): boolean {
    const membership = getUserMembership();
    return membership?.role === 'owner' || membership?.role === 'admin';
  }

  function getOrgTypeBadge(type: string) {
    return ORG_TYPES.find((t) => t.value === type) ?? ORG_TYPES[0];
  }

  function getIndustryLabel(value: string | null): string {
    if (!value) return '未设置';
    return INDUSTRY_OPTIONS.find((i) => i.value === value)?.label ?? value;
  }

  // ── Render ───────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <Building2 className="h-6 w-6 text-primary" />
          组织管理
        </h1>
        <p className="mt-1 text-sm text-muted">
          管理您的组织信息和成员
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
          <XCircle className="h-4 w-4 shrink-0" />
          {error}
          <button onClick={() => setError('')} className="ml-auto">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* ─── State 1: No Organization ─── */}
      {!org && !showCreateForm && (
        <div className="rounded-2xl bg-white shadow-[0_8px_40px_rgba(15,23,42,0.08)] border border-line/60 p-8 text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-primary/10 text-primary mb-4">
            <Building2 className="h-8 w-8" />
          </div>
          <h2 className="text-lg font-bold text-foreground mb-2">您还没有加入任何组织</h2>
          <p className="text-sm text-muted mb-6">创建一个组织以开始协作</p>
          <button
            onClick={() => {
              setError('');
              if (currentUser?.role) {
                const roleToType: Record<string, string> = {
                  buyer: 'buyer',
                  supplier: 'supplier',
                  opc_team: 'opc_team',
                };
                setCreateForm((prev) => ({
                  ...prev,
                  type: roleToType[currentUser.role] ?? 'buyer',
                }));
              }
              setShowCreateForm(true);
            }}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
          >
            <Building2 className="h-4 w-4" />
            创建组织
          </button>
        </div>
      )}

      {/* ─── Create Organization Form ─── */}
      {!org && showCreateForm && (
        <div className="rounded-2xl bg-white shadow-[0_8px_40px_rgba(15,23,42,0.08)] border border-line/60 p-8">
          <h2 className="text-lg font-bold text-foreground mb-6">创建组织</h2>

          <form onSubmit={handleCreateOrg} className="space-y-5">
            {/* Name */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                组织名称 <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={createForm.name}
                onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="输入组织名称"
                required
                className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none transition-all duration-160 focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>

            {/* Type */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-2">
                组织类型 <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-3">
                {ORG_TYPES.map((t) => {
                  const selected = createForm.type === t.value;
                  return (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => setCreateForm((f) => ({ ...f, type: t.value }))}
                      className={`rounded-lg border p-3 text-center text-sm font-medium transition-all duration-160 ${
                        selected
                          ? 'border-primary bg-primary/5 ring-2 ring-primary/10 text-primary'
                          : 'border-line bg-white text-foreground hover:border-primary/30'
                      }`}
                    >
                      {t.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Industry */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                行业
              </label>
              <select
                value={createForm.industry}
                onChange={(e) => setCreateForm((f) => ({ ...f, industry: e.target.value }))}
                className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-160 focus:border-primary focus:ring-2 focus:ring-primary/10"
              >
                <option value="">请选择行业</option>
                {INDUSTRY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-foreground mb-1.5">
                描述
              </label>
              <textarea
                value={createForm.description}
                onChange={(e) => setCreateForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="简要描述您的组织..."
                rows={3}
                className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none transition-all duration-160 focus:border-primary focus:ring-2 focus:ring-primary/10 resize-none"
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={submitting}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-6 py-2.5 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)] disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
              >
                {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
                创建
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowCreateForm(false);
                  setError('');
                }}
                className="rounded-lg border border-line px-6 py-2.5 text-sm font-medium text-foreground transition-all duration-160 hover:bg-gray-50"
              >
                取消
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ─── State 2: Has Organization ─── */}
      {org && (
        <>
          {/* Org Info Card */}
          <div className="rounded-2xl bg-white shadow-[0_8px_40px_rgba(15,23,42,0.08)] border border-line/60 p-6 mb-6">
            {!editMode ? (
              <>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-4">
                    {/* Logo */}
                    <div className="grid h-14 w-14 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                      {org.logo ? (
                        <img src={org.logo} alt={org.name} className="h-10 w-10 rounded-lg object-cover" />
                      ) : (
                        <Building2 className="h-7 w-7" />
                      )}
                    </div>
                    <div>
                      <h2 className="text-xl font-bold text-foreground">{org.name}</h2>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${getOrgTypeBadge(org.type).color}`}>
                          {getOrgTypeBadge(org.type).label}
                        </span>
                        <span className="text-xs text-muted">
                          {getIndustryLabel(org.industry)}
                        </span>
                      </div>
                    </div>
                  </div>
                  {isAdminOrOwner() && (
                    <button
                      onClick={() => {
                        setEditMode(true);
                        setError('');
                      }}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-foreground transition-all duration-160 hover:border-primary/30 hover:text-primary"
                    >
                      <Edit className="h-3.5 w-3.5" />
                      编辑
                    </button>
                  )}
                </div>

                {/* Description */}
                {org.description && (
                  <p className="mt-4 text-sm text-muted leading-relaxed">{org.description}</p>
                )}

                {/* Meta */}
                <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
                  <div className="flex items-center gap-1.5 text-muted">
                    <Users className="h-4 w-4" />
                    <span>成员数: <strong className="text-foreground">{org.memberCount}</strong></span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {org.certified ? (
                      <>
                        <CheckCircle2 className="h-4 w-4 text-green" />
                        <span className="text-green text-sm font-medium">已认证</span>
                      </>
                    ) : (
                      <>
                        <Shield className="h-4 w-4 text-muted" />
                        <span className="text-muted text-sm">未认证</span>
                      </>
                    )}
                  </div>
                </div>
              </>
            ) : (
              /* Edit Mode */
              <form onSubmit={handleUpdateOrg} className="space-y-5">
                <h3 className="text-lg font-bold text-foreground">编辑组织信息</h3>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">组织名称</label>
                  <input
                    type="text"
                    value={editForm.name}
                    onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                    required
                    className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-160 focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">行业</label>
                  <select
                    value={editForm.industry}
                    onChange={(e) => setEditForm((f) => ({ ...f, industry: e.target.value }))}
                    className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-160 focus:border-primary focus:ring-2 focus:ring-primary/10"
                  >
                    <option value="">请选择行业</option>
                    {INDUSTRY_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-foreground mb-1.5">描述</label>
                  <textarea
                    value={editForm.description}
                    onChange={(e) => setEditForm((f) => ({ ...f, description: e.target.value }))}
                    rows={3}
                    className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-sm text-foreground outline-none transition-all duration-160 focus:border-primary focus:ring-2 focus:ring-primary/10 resize-none"
                  />
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-bold text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)] disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
                  >
                    {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    保存
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditMode(false);
                      setError('');
                    }}
                    className="rounded-lg border border-line px-5 py-2 text-sm font-medium text-foreground transition-all duration-160 hover:bg-gray-50"
                  >
                    取消
                  </button>
                </div>
              </form>
            )}
          </div>

          {/* Members Section */}
          <div className="rounded-2xl bg-white shadow-[0_8px_40px_rgba(15,23,42,0.08)] border border-line/60 p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="flex items-center gap-2 text-base font-semibold text-foreground">
                <Users className="h-5 w-5 text-primary" />
                成员管理
                <span className="text-sm font-normal text-muted">({org.memberCount})</span>
              </h3>
              {isAdminOrOwner() && (
                <button
                  onClick={() => {
                    setShowInviteForm(!showInviteForm);
                    setError('');
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-bold text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
                >
                  <UserPlus className="h-3.5 w-3.5" />
                  邀请成员
                </button>
              )}
            </div>

            {/* Invite Form */}
            {showInviteForm && (
              <form
                onSubmit={handleInviteMember}
                className="mb-5 flex flex-col sm:flex-row items-stretch sm:items-end gap-3 rounded-lg border border-primary/20 bg-primary/5 p-4"
              >
                <div className="flex-1">
                  <label className="block text-xs font-medium text-foreground mb-1">
                    邮箱地址
                  </label>
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="输入用户邮箱"
                    required
                    className="w-full rounded-lg border border-line bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted/60 outline-none transition-all duration-160 focus:border-primary focus:ring-2 focus:ring-primary/10"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-foreground mb-1">
                    角色
                  </label>
                  <select
                    value={inviteRole}
                    onChange={(e) => setInviteRole(e.target.value as 'member' | 'admin')}
                    className="rounded-lg border border-line bg-white px-3 py-2 text-sm text-foreground outline-none transition-all duration-160 focus:border-primary focus:ring-2 focus:ring-primary/10"
                  >
                    <option value="member">成员</option>
                    <option value="admin">管理员</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition-all duration-160 disabled:opacity-60"
                  >
                    {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5" />}
                    邀请
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setShowInviteForm(false);
                      setInviteEmail('');
                      setError('');
                    }}
                    className="rounded-lg border border-line px-3 py-2 text-sm text-foreground transition-all duration-160 hover:bg-gray-50"
                  >
                    取消
                  </button>
                </div>
              </form>
            )}

            {/* Members List */}
            {members.length === 0 ? (
              <p className="text-sm text-muted text-center py-8">暂无成员</p>
            ) : (
              <div className="divide-y divide-line">
                {members.map((member) => {
                  const roleCfg = ROLE_CONFIG[member.role] ?? ROLE_CONFIG.member;
                  const RoleIcon = roleCfg.icon;
                  const isSelf = currentUser?.id === member.user.id;
                  const canRemove =
                    isAdminOrOwner() &&
                    !isSelf &&
                    !(member.role === 'owner' && members.filter((m) => m.role === 'owner').length <= 1);

                  return (
                    <div
                      key={member.id}
                      className="flex items-center gap-3 py-3.5 animate-soft-pop"
                    >
                      {/* Avatar */}
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-sm font-bold">
                        {member.user.avatar ? (
                          <img
                            src={member.user.avatar}
                            alt={member.user.name}
                            className="h-9 w-9 rounded-full object-cover"
                          />
                        ) : (
                          member.user.name.charAt(0).toUpperCase()
                        )}
                      </div>

                      {/* Info */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-foreground truncate">
                            {member.user.name}
                          </span>
                          {isSelf && (
                            <span className="text-[10px] text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                              我
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-muted truncate">{member.user.email}</p>
                      </div>

                      {/* Role Badge */}
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${roleCfg.color}`}
                      >
                        <RoleIcon className="h-3 w-3" />
                        {roleCfg.label}
                      </span>

                      {/* Joined Date */}
                      <span className="hidden sm:block text-xs text-muted min-w-[80px] text-right">
                        {new Date(member.createdAt).toLocaleDateString('zh-CN')}
                      </span>

                      {/* Remove Button */}
                      {canRemove && (
                        <button
                          onClick={() => handleRemoveMember(member.user.id)}
                          title="移除成员"
                          className="ml-1 rounded-lg p-1.5 text-muted transition-all duration-160 hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
