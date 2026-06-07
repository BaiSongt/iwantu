'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  Shield,
  Clock,
  Calendar,
  AlertTriangle,
  Inbox,
  Loader2,
  X,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface ApiKeyItem {
  id: string;
  name: string;
  keyMasked: string;
  keySuffix: string;
  scopes: string[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

interface NewKeyResult {
  id: string;
  name: string;
  key: string;
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
}

/* ------------------------------------------------------------------ */
/*  Scope definitions                                                  */
/* ------------------------------------------------------------------ */

const SCOPE_OPTIONS = [
  { value: 'read', label: '读取 (Read)', color: 'blue' },
  { value: 'write:demand', label: '写入需求 (Write Demand)', color: 'green' },
  { value: 'write:proposal', label: '写入方案 (Write Proposal)', color: 'green' },
  { value: 'write:product', label: '写入产品 (Write Product)', color: 'green' },
] as const;

/* ------------------------------------------------------------------ */
/*  Scope Badge                                                        */
/* ------------------------------------------------------------------ */

function ScopeBadge({ scope }: { scope: string }) {
  const config = SCOPE_OPTIONS.find((o) => o.value === scope);
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700 border-blue-200',
    green: 'bg-green-50 text-green-700 border-green-200',
    red: 'bg-red-50 text-red-700 border-red-200',
  };
  const cls = colorMap[config?.color ?? 'blue'] ?? colorMap.blue;

  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${cls}`}
    >
      {scope}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Create Key Modal                                                   */
/* ------------------------------------------------------------------ */

function CreateKeyModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (result: NewKeyResult) => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['read']);
  const [expiresAt, setExpiresAt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  function toggleScope(scope: string) {
    setScopes((prev) =>
      prev.includes(scope)
        ? prev.filter((s) => s !== scope)
        : [...prev, scope],
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          scopes,
          expiresAt: expiresAt || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '创建失败');
        return;
      }

      onCreated(data);
      setName('');
      setScopes(['read']);
      setExpiresAt('');
    } catch {
      setError('网络错误，请稍后重试');
    } finally {
      setLoading(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
        <div className="mb-5 flex items-center justify-between">
          <h3 className="text-lg font-bold text-foreground">创建新密钥</h3>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-foreground hover:bg-gray-100 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              密钥名称
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如: 生产环境 Agent"
              className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-foreground placeholder:text-muted/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              required
            />
          </div>

          {/* Scopes */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              权限范围
            </label>
            <div className="flex flex-wrap gap-2">
              {SCOPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleScope(opt.value)}
                  className={`inline-flex items-center rounded-lg border px-3 py-1.5 text-xs font-semibold transition-all ${
                    scopes.includes(opt.value)
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-line text-muted hover:border-gray-300 hover:text-foreground'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            {scopes.length === 0 && (
              <p className="mt-1 text-xs text-red-500">请至少选择一个权限</p>
            )}
          </div>

          {/* Expiry */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              过期时间 <span className="text-muted font-normal">(可选)</span>
            </label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="w-full rounded-xl border border-line bg-white px-4 py-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-600">{error}</p>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-xl border border-line px-4 py-2.5 text-sm font-medium text-muted hover:text-foreground hover:bg-gray-50 transition-all"
            >
              取消
            </button>
            <button
              type="submit"
              disabled={loading || scopes.length === 0 || !name.trim()}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:hover:shadow-none"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              创建密钥
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  New Key Display Modal                                              */
/* ------------------------------------------------------------------ */

function NewKeyDisplayModal({
  result,
  onClose,
}: {
  result: NewKeyResult;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(result.key);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.18)]">
        <div className="mb-4 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-50">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-foreground">密钥已创建</h3>
            <p className="text-sm text-muted">
              请妥善保管密钥，创建后仅显示一次
            </p>
          </div>
        </div>

        {/* Key display */}
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <p className="mb-1 text-xs font-medium text-amber-800">API Key</p>
          <div className="flex items-center gap-2">
            <code className="flex-1 break-all rounded-lg bg-white px-3 py-2 font-mono text-sm text-foreground border border-amber-200">
              {result.key}
            </code>
            <button
              onClick={handleCopy}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-line bg-white text-muted hover:text-primary hover:border-primary/30 transition-all"
              title="复制"
            >
              {copied ? (
                <Check className="h-4 w-4 text-green-600" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>

        {/* Key info */}
        <div className="mb-4 flex flex-wrap gap-2">
          {result.scopes.map((s) => (
            <ScopeBadge key={s} scope={s} />
          ))}
        </div>

        <div className="flex justify-end">
          <button
            onClick={onClose}
            className="rounded-xl bg-primary px-5 py-2.5 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
          >
            我已保存密钥
          </button>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Key Row                                                            */
/* ------------------------------------------------------------------ */

function KeyRow({
  item,
  onRevoke,
}: {
  item: ApiKeyItem;
  onRevoke: (id: string) => void;
}) {
  const [revoking, setRevoking] = useState(false);

  async function handleRevoke() {
    if (!confirm(`确定要撤销密钥 "${item.name}" 吗？此操作不可恢复。`)) return;
    setRevoking(true);
    await onRevoke(item.id);
    setRevoking(false);
  }

  const isExpired = item.expiresAt && new Date(item.expiresAt) < new Date();

  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line bg-white p-4 shadow-[0_8px_40px_rgba(15,23,42,0.08)] transition-all duration-160 hover:border-[#bfdbfe] hover:shadow-[0_24px_70px_rgba(21,94,239,0.12)]">
      {/* Icon */}
      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10">
        <Key className="h-5 w-5 text-primary" />
      </div>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-semibold text-foreground">
            {item.name}
          </h3>
          {isExpired && (
            <span className="inline-flex items-center rounded-md bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-600">
              已过期
            </span>
          )}
        </div>

        {/* Masked key */}
        <p className="mt-0.5 font-mono text-xs text-muted tracking-wide">
          {item.keyMasked}
        </p>

        {/* Scopes */}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {item.scopes.map((s) => (
            <ScopeBadge key={s} scope={s} />
          ))}
        </div>

        {/* Meta row */}
        <div className="mt-2 flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1">
            <Calendar className="h-3 w-3" />
            创建于 {new Date(item.createdAt).toLocaleDateString('zh-CN')}
          </span>
          {item.expiresAt && (
            <span className={`flex items-center gap-1 ${isExpired ? 'text-red-500' : ''}`}>
              <Clock className="h-3 w-3" />
              {isExpired ? '已过期' : '过期于'} {new Date(item.expiresAt).toLocaleDateString('zh-CN')}
            </span>
          )}
          {item.lastUsedAt && (
            <span className="flex items-center gap-1">
              <Shield className="h-3 w-3" />
              最近使用 {new Date(item.lastUsedAt).toLocaleDateString('zh-CN')}
            </span>
          )}
        </div>
      </div>

      {/* Revoke button */}
      <button
        onClick={handleRevoke}
        disabled={revoking}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted hover:text-red-600 hover:border-red-200 hover:bg-red-50 transition-colors disabled:opacity-50"
      >
        {revoking ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Trash2 className="h-3.5 w-3.5" />
        )}
        撤销
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Skeleton Row                                                       */
/* ------------------------------------------------------------------ */

function SkeletonRow() {
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line bg-white p-4">
      <div className="h-11 w-11 shrink-0 rounded-xl bg-gray-100 animate-pulse" />
      <div className="flex-1">
        <div className="h-4 w-1/3 rounded bg-gray-100 animate-pulse" />
        <div className="mt-2 h-3 w-1/4 rounded bg-gray-50 animate-pulse" />
        <div className="mt-2 h-5 w-2/5 rounded bg-gray-50 animate-pulse" />
        <div className="mt-2 h-3 w-1/2 rounded bg-gray-50 animate-pulse" />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function ApiKeysPage() {
  const [keys, setKeys] = useState<ApiKeyItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newKeyResult, setNewKeyResult] = useState<NewKeyResult | null>(null);

  const fetchKeys = useCallback(async () => {
    try {
      const res = await fetch('/api/api-keys');
      if (res.ok) {
        const data = await res.json();
        setKeys(Array.isArray(data) ? data : data.data ?? []);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKeys();
  }, [fetchKeys]);

  async function handleRevoke(id: string) {
    try {
      const res = await fetch(`/api/api-keys/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setKeys((prev) => prev.filter((k) => k.id !== id));
      }
    } catch {
      // ignore
    }
  }

  function handleCreated(result: NewKeyResult) {
    setShowCreateModal(false);
    setNewKeyResult(result);
    // Refresh key list
    fetchKeys();
  }

  function handleCloseNewKeyDisplay() {
    setNewKeyResult(null);
  }

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">API 密钥管理</h2>
          <p className="mt-1 text-sm text-muted">
            管理用于 AI Agent 接入的 API 密钥
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
        >
          <Plus className="h-4 w-4" />
          创建新密钥
        </button>
      </div>

      {/* Warning banner */}
      <div className="mb-5 flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
        <p className="text-sm text-amber-800">
          请妥善保管密钥，创建后仅显示一次。撤销后密钥将立即失效。
        </p>
      </div>

      {/* Key list */}
      {loading ? (
        <div className="space-y-4">
          <SkeletonRow />
          <SkeletonRow />
          <SkeletonRow />
        </div>
      ) : keys.length === 0 ? (
        <div className="rounded-2xl bg-white border border-line shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gray-50 mb-4">
              <Inbox className="h-7 w-7 text-muted/40" />
            </div>
            <p className="text-sm font-semibold text-foreground mb-1">
              还没有创建过 API 密钥
            </p>
            <p className="text-xs text-muted mb-5">
              创建 API 密钥以允许 AI Agent 访问平台接口
            </p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-bold text-white transition-all duration-160 hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
            >
              <Plus className="h-4 w-4" />
              创建新密钥
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {keys.map((key) => (
            <KeyRow key={key.id} item={key} onRevoke={handleRevoke} />
          ))}
        </div>
      )}

      {/* Create modal */}
      <CreateKeyModal
        open={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleCreated}
      />

      {/* New key display modal */}
      {newKeyResult && (
        <NewKeyDisplayModal
          result={newKeyResult}
          onClose={handleCloseNewKeyDisplay}
        />
      )}
    </div>
  );
}
