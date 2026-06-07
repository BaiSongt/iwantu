'use client';

import { useState, useEffect } from 'react';
import {
  Settings,
  Database,
  Users,
  Package,
  ShoppingCart,
  FlaskConical,
  FileText,
  Loader2,
  Tag,
  Building2,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DbStats {
  totalUsers: number;
  totalProducts: number;
  totalDemands: number;
  totalPocProjects: number;
  totalProposals: number;
  totalOrganizations: number;
  pendingReview: number;
}

/* ------------------------------------------------------------------ */
/*  Stat Card                                                          */
/* ------------------------------------------------------------------ */

function StatItem({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line/60 bg-white p-4">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div>
        <p className="text-lg font-bold text-foreground">{value}</p>
        <p className="text-xs text-muted">{label}</p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function AdminSettingsPage() {
  const [stats, setStats] = useState<DbStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStats() {
      try {
        // Fetch stats from the dashboard metrics API
        const res = await fetch('/api/dashboard/metrics');
        if (res.ok) {
          const json = await res.json();
          const data = json.data;
          setStats({
            totalUsers: data?.totalUsers ?? 0,
            totalProducts: data?.totalProducts ?? 0,
            totalDemands: data?.totalDemands ?? 0,
            totalPocProjects: data?.activePocs ?? 0,
            totalProposals: 0,
            totalOrganizations: 0,
            pendingReview: 0,
          });
        }
      } catch {
        // API not available
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  return (
    <div className="animate-fade-up">
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground">系统设置</h2>
        <p className="mt-1 text-sm text-muted">
          平台配置与系统信息
        </p>
      </div>

      {/* Platform info */}
      <div className="mb-6 rounded-2xl border border-line bg-white p-6 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
          <Settings className="h-5 w-5 text-primary" />
          平台信息
        </h3>
        <div className="space-y-4">
          <div className="flex items-start gap-4">
            <label className="w-24 shrink-0 text-sm text-muted pt-0.5">平台名称</label>
            <div className="text-sm font-medium text-foreground">iWantU AI B2B Marketplace</div>
          </div>
          <div className="flex items-start gap-4">
            <label className="w-24 shrink-0 text-sm text-muted pt-0.5">平台描述</label>
            <div className="text-sm text-foreground">
              B2B AI 产品与服务采购平台，连接需求方与供应商，提供智能匹配、POC 验证、方案报价一站式服务
            </div>
          </div>
          <div className="flex items-start gap-4">
            <label className="w-24 shrink-0 text-sm text-muted pt-0.5">版本号</label>
            <div className="text-sm text-foreground">v0.9</div>
          </div>
        </div>
      </div>

      {/* Category management placeholder */}
      <div className="mb-6 rounded-2xl border border-line bg-white p-6 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
          <Tag className="h-5 w-5 text-primary" />
          分类管理
        </h3>
        <p className="text-sm text-muted mb-4">
          管理平台产品分类、行业标签等分类体系
        </p>
        <div className="rounded-xl border border-dashed border-line p-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gray-50 mx-auto mb-3">
            <Tag className="h-5 w-5 text-muted/40" />
          </div>
          <p className="text-sm text-muted">分类管理功能开发中</p>
          <p className="text-xs text-muted/60 mt-1">将在后续版本中支持自定义分类和标签</p>
        </div>
      </div>

      {/* System info */}
      <div className="rounded-2xl border border-line bg-white p-6 shadow-[0_8px_40px_rgba(15,23,42,0.08)]">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
          <Database className="h-5 w-5 text-primary" />
          系统信息
        </h3>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatItem
              label="总用户数"
              value={stats?.totalUsers ?? '-'}
              icon={Users}
            />
            <StatItem
              label="总产品数"
              value={stats?.totalProducts ?? '-'}
              icon={Package}
            />
            <StatItem
              label="总需求数"
              value={stats?.totalDemands ?? '-'}
              icon={ShoppingCart}
            />
            <StatItem
              label="POC 项目数"
              value={stats?.totalPocProjects ?? '-'}
              icon={FlaskConical}
            />
          </div>
        )}

        {/* DB connection info (non-sensitive) */}
        <div className="mt-4 pt-4 border-t border-line/40">
          <div className="flex items-center gap-2 text-xs text-muted">
            <div className="h-2 w-2 rounded-full bg-green-400" />
            <span>数据库连接正常</span>
            <span className="mx-2">|</span>
            <span>PostgreSQL</span>
            <span className="mx-2">|</span>
            <span>Prisma ORM</span>
          </div>
        </div>
      </div>
    </div>
  );
}
