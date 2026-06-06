'use client';

import { useEffect, useState, useCallback } from 'react';
import {
  User,
  Mail,
  Phone,
  Lock,
  Save,
  Building2,
  Calendar,
  CheckCircle,
  XCircle,
} from 'lucide-react';
import type { User as UserType, UserRole } from '@/types';

const ROLE_LABELS: Record<UserRole, string> = {
  guest: '访客',
  buyer: '需求方',
  supplier: '供应商',
  opc_team: 'OPC团队',
  operator: '运营',
  admin: '管理员',
};

const ROLE_COLORS: Record<UserRole, string> = {
  guest: 'bg-gray-100 text-gray-700',
  buyer: 'bg-blue-100 text-blue-700',
  supplier: 'bg-green-100 text-green-700',
  opc_team: 'bg-purple-100 text-purple-700',
  operator: 'bg-orange-100 text-orange-700',
  admin: 'bg-red-100 text-red-700',
};

export default function ProfilePage() {
  const [user, setUser] = useState<UserType | null>(null);
  const [loading, setLoading] = useState(true);

  // Profile form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [avatar, setAvatar] = useState('');

  // Password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // UI state
  const [saving, setSaving] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);
  const [toast, setToast] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  const showToast = useCallback(
    (type: 'success' | 'error', message: string) => {
      setToast({ type, message });
      setTimeout(() => setToast(null), 3000);
    },
    [],
  );

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch('/api/users/me');
        if (!res.ok) throw new Error('获取用户信息失败');
        const data = await res.json();
        const u = data as UserType;
        setUser(u);
        setName(u.name);
        setPhone(u.phone ?? '');
        setAvatar(u.avatar ?? '');
      } catch {
        showToast('error', '获取用户信息失败');
      } finally {
        setLoading(false);
      }
    }
    fetchUser();
  }, [showToast]);

  const handleSaveProfile = async () => {
    if (!name.trim()) {
      showToast('error', '姓名不能为空');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), phone: phone.trim(), avatar: avatar.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '保存失败');
      }
      const updated = (await res.json()) as UserType;
      setUser(updated);
      showToast('success', '个人资料保存成功');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword) {
      showToast('error', '请输入当前密码');
      return;
    }
    if (newPassword.length < 6) {
      showToast('error', '新密码长度不能少于6位');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('error', '两次输入的新密码不一致');
      return;
    }
    setSavingPassword(true);
    try {
      const res = await fetch('/api/users/me/password', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || '密码修改失败');
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showToast('success', '密码修改成功');
    } catch (err) {
      showToast('error', err instanceof Error ? err.message : '密码修改失败');
    } finally {
      setSavingPassword(false);
    }
  };

  const getInitials = (u: UserType) => {
    if (!u.name) return '?';
    const parts = u.name.split('');
    return parts.length >= 2 ? parts.slice(0, 2).join('') : u.name.charAt(0);
  };

  if (loading) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-8">
        <div className="animate-pulse space-y-6">
          <div className="h-8 w-48 rounded bg-line/60" />
          <div className="h-64 rounded-2xl bg-line/40" />
        </div>
      </section>
    );
  }

  if (!user) {
    return (
      <section className="mx-auto max-w-3xl px-4 py-8">
        <div className="rounded-2xl bg-white p-6 text-center text-muted shadow-[0_8px_40px_rgba(15,23,42,0.08)] border border-line/60">
          无法加载用户信息，请稍后重试。
        </div>
      </section>
    );
  }

  return (
    <section className="mx-auto max-w-3xl px-4 py-8 animate-fade-up">
      {/* Header */}
      <div className="mb-8">
        <h1 className="flex items-center gap-2 text-2xl font-bold text-foreground">
          <User className="h-6 w-6 text-primary" />
          个人资料
        </h1>
        <p className="mt-1 text-sm text-muted">
          管理你的账户信息和安全设置。
        </p>
      </div>

      {/* Toast */}
      {toast && (
        <div
          className={`mb-6 flex items-center gap-2 rounded-lg px-4 py-3 text-sm font-medium ${
            toast.type === 'success'
              ? 'bg-green/10 text-green border border-green/20'
              : 'bg-red-50 text-red-600 border border-red-200'
          }`}
        >
          {toast.type === 'success' ? (
            <CheckCircle className="h-4 w-4" />
          ) : (
            <XCircle className="h-4 w-4" />
          )}
          {toast.message}
        </div>
      )}

      {/* Profile Card */}
      <div className="rounded-2xl bg-white shadow-[0_8px_40px_rgba(15,23,42,0.08)] border border-line/60 p-6 mb-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground mb-6">
          <User className="h-5 w-5 text-primary" />
          基本信息
        </h2>

        {/* Avatar */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative group">
            {user.avatar ? (
              <img
                src={user.avatar}
                alt={user.name}
                className="h-16 w-16 rounded-full object-cover border-2 border-line"
              />
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-lg font-bold text-primary border-2 border-primary/20">
                {getInitials(user)}
              </div>
            )}
            <div className="absolute inset-0 flex items-center justify-center rounded-full bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
              <span className="text-xs text-white font-medium">更换</span>
            </div>
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">头像</p>
            <p className="text-xs text-muted">点击头像更换（功能开发中）</p>
          </div>
        </div>

        {/* Form Fields */}
        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <User className="h-4 w-4 text-muted" />
              姓名
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              placeholder="请输入姓名"
            />
          </div>

          {/* Email (read-only) */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Mail className="h-4 w-4 text-muted" />
              邮箱
            </label>
            <input
              type="email"
              value={user.email}
              readOnly
              className="w-full rounded-lg border border-line bg-gray-50 px-4 py-2.5 text-sm text-muted cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-muted">邮箱不可修改</p>
          </div>

          {/* Phone */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Phone className="h-4 w-4 text-muted" />
              手机号
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              placeholder="请输入手机号"
            />
          </div>

          {/* Role (read-only) */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <User className="h-4 w-4 text-muted" />
              角色
            </label>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
                ROLE_COLORS[user.role] ?? 'bg-gray-100 text-gray-700'
              }`}
            >
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          </div>

          {/* Organization (read-only) */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Building2 className="h-4 w-4 text-muted" />
              所属组织
            </label>
            <p className="text-sm text-foreground">
              {user.orgName ?? '未加入组织'}
            </p>
          </div>

          {/* Registration Date (read-only) */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Calendar className="h-4 w-4 text-muted" />
              注册时间
            </label>
            <p className="text-sm text-foreground">
              {new Date(user.createdAt).toLocaleString('zh-CN', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>

        {/* Save Button */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleSaveProfile}
            disabled={saving}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-bold text-sm text-white hover:-translate-y-0.5 transition-all duration-160 disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <Save className="h-4 w-4" />
            {saving ? '保存中...' : '保存修改'}
          </button>
        </div>
      </div>

      {/* Change Password Card */}
      <div className="rounded-2xl bg-white shadow-[0_8px_40px_rgba(15,23,42,0.08)] border border-line/60 p-6">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground mb-6">
          <Lock className="h-5 w-5 text-primary" />
          修改密码
        </h2>

        <div className="space-y-5">
          {/* Current Password */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Lock className="h-4 w-4 text-muted" />
              当前密码
            </label>
            <input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              placeholder="请输入当前密码"
            />
          </div>

          {/* New Password */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Lock className="h-4 w-4 text-muted" />
              新密码
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              placeholder="请输入新密码（至少6位）"
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Lock className="h-4 w-4 text-muted" />
              确认新密码
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              className="w-full rounded-lg border border-line bg-white px-4 py-2.5 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/10"
              placeholder="请再次输入新密码"
            />
            {confirmPassword && newPassword !== confirmPassword && (
              <p className="mt-1 text-xs text-red-500">两次输入的密码不一致</p>
            )}
          </div>
        </div>

        {/* Change Password Button */}
        <div className="mt-6 flex justify-end">
          <button
            onClick={handleChangePassword}
            disabled={savingPassword}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-bold text-sm text-white hover:-translate-y-0.5 transition-all duration-160 disabled:opacity-50 disabled:hover:translate-y-0"
          >
            <Lock className="h-4 w-4" />
            {savingPassword ? '修改中...' : '修改密码'}
          </button>
        </div>
      </div>
    </section>
  );
}
