'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { User, Mail, Lock, UserPlus, Loader2, Building2, ShoppingCart } from 'lucide-react';
import { registerAction } from '@/lib/session';

const ROLES = [
  {
    value: 'buyer',
    label: '需求方',
    description: '发布AI需求，寻找合适的产品和供应商',
    icon: ShoppingCart,
  },
  {
    value: 'supplier',
    label: '供应商',
    description: '发布AI产品，响应需求并提供解决方案',
    icon: Building2,
  },
] as const;

export default function RegisterPage() {
  const router = useRouter();

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('buyer');
  const [orgName, setOrgName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const result = await registerAction(name, email, password, role, orgName || undefined);
      if (result.success) {
        router.push('/');
        router.refresh();
      } else {
        setError(result.error || '注册失败');
      }
    } catch {
      setError('注册失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="animate-[fade-up_0.4s_ease-out]">
      {/* Logo */}
      <div className="text-center mb-8">
        <Link href="/" className="inline-flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-gradient-to-br from-primary to-violet text-white font-extrabold text-lg animate-[pulse-glow_3s_ease-in-out_infinite]">
            U
          </span>
          <span className="text-2xl font-bold tracking-tight text-foreground">iWantU</span>
        </Link>
        <p className="mt-3 text-muted text-sm">AI能力供需平台</p>
      </div>

      {/* Card */}
      <div className="bg-white rounded-2xl shadow-[0_8px_40px_rgba(15,23,42,0.08)] border border-line/60 p-8">
        <h1 className="text-xl font-bold text-foreground mb-1">注册</h1>
        <p className="text-sm text-muted mb-6">创建您的账号以开始使用</p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-600">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="name" className="block text-sm font-medium text-foreground mb-1.5">
              姓名
            </label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
              <input
                id="name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="您的姓名"
                required
                className="w-full rounded-lg border border-line bg-white pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none transition-all duration-160 focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>
          </div>

          {/* Email */}
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground mb-1.5">
              邮箱
            </label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="your@email.com"
                required
                className="w-full rounded-lg border border-line bg-white pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none transition-all duration-160 focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>
          </div>

          {/* Password */}
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-foreground mb-1.5">
              密码
            </label>
            <div className="relative">
              <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="至少6个字符"
                required
                minLength={6}
                className="w-full rounded-lg border border-line bg-white pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none transition-all duration-160 focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>
          </div>

          {/* Role Selector */}
          <div>
            <label className="block text-sm font-medium text-foreground mb-2">角色</label>
            <div className="grid gap-2">
              {ROLES.map((r) => {
                const Icon = r.icon;
                const selected = role === r.value;
                return (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setRole(r.value)}
                    className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-all duration-160 ${
                      selected
                        ? 'border-primary bg-[#eff6ff] ring-2 ring-primary/10'
                        : 'border-line bg-white hover:border-[#bfdbfe] hover:bg-[#f8fafc]'
                    }`}
                  >
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                        selected
                          ? 'bg-primary/10 text-primary'
                          : 'bg-gray-100 text-muted'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className={`text-sm font-semibold ${selected ? 'text-primary' : 'text-foreground'}`}>
                        {r.label}
                      </div>
                      <div className="text-xs text-muted leading-relaxed">{r.description}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Organization Name - Optional, hidden for opc_team */}
          {role !== 'opc_team' && (
            <div className="animate-[fade-up_0.25s_ease-out]">
              <label htmlFor="orgName" className="block text-sm font-medium text-foreground mb-1.5">
                组织名称（选填）
              </label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                <input
                  id="orgName"
                  type="text"
                  value={orgName}
                  onChange={(e) => setOrgName(e.target.value)}
                  placeholder="输入组织或公司名称"
                  className="w-full rounded-lg border border-line bg-white pl-10 pr-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 outline-none transition-all duration-160 focus:border-primary focus:ring-2 focus:ring-primary/10"
                />
              </div>
              <p className="mt-1 text-xs text-muted">注册后将自动创建并加入该组织</p>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)] disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:shadow-none"
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            注册
          </button>
        </form>

        {/* Login link */}
        <p className="mt-6 text-center text-sm text-muted">
          已有账号？{' '}
          <Link
            href="/auth/login"
            className="font-semibold text-primary hover:text-violet transition-colors duration-160"
          >
            立即登录
          </Link>
        </p>
      </div>
    </div>
  );
}
