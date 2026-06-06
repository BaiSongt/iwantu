'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  LayoutDashboard,
  ShoppingCart,
  FileText,
  FlaskConical,
  MessageSquare,
  Package,
  Search,
  Plus,
  ArrowRightLeft,
  Users,
  Shield,
  Settings,
  TrendingUp,
  BarChart3,
  ClipboardList,
  Loader2,
} from 'lucide-react';
import type { UserRole } from '@/types';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DashboardMetrics {
  activeDemands: number;
  receivedProposals: number;
  activePoc: number;
  unreadMessages: number;
  publishedProducts: number;
  newMatchedDemands: number;
  activeProposals: number;
  pendingMatching: number;
  weeklyNew: number;
  totalUsers: number;
  totalProducts: number;
  totalDemands: number;
  activePocs: number;
}

/* ------------------------------------------------------------------ */
/*  Role labels                                                        */
/* ------------------------------------------------------------------ */

const ROLE_LABELS: Record<string, string> = {
  buyer: '需求方',
  supplier: '供应商',
  opc_team: 'OPC团队',
  operator: '运营',
  admin: '管理员',
  guest: '访客',
};

/* ------------------------------------------------------------------ */
/*  Stat Card                                                          */
/* ------------------------------------------------------------------ */

function StatCard({
  value,
  label,
  icon: Icon,
  loading,
  delay = 0,
}: {
  value: number | string;
  label: string;
  icon: React.ElementType;
  loading?: boolean;
  delay?: number;
}) {
  return (
    <article
      className="bg-white border border-line rounded-2xl p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)] animate-soft-pop transition-all duration-160 ease-out hover:-translate-y-1 hover:border-[#bfdbfe] hover:shadow-[0_24px_70px_rgba(21,94,239,0.16)]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
      {loading ? (
        <Loader2 className="h-6 w-6 animate-spin text-muted" />
      ) : (
        <strong className="block text-[26px] text-foreground">{value}</strong>
      )}
      <span className="text-muted text-[13px]">{label}</span>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/*  Quick Action Button                                                */
/* ------------------------------------------------------------------ */

function QuickAction({
  label,
  href,
  icon: Icon,
}: {
  label: string;
  href: string;
  icon: React.ElementType;
}) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-2xl border border-line bg-white px-5 py-4 font-medium text-sm text-foreground shadow-[0_8px_40px_rgba(15,23,42,0.08)] transition-all duration-160 ease-out hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-[0_14px_40px_rgba(21,94,239,0.12)]"
    >
      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet text-white">
        <Icon className="h-[18px] w-[18px]" />
      </div>
      {label}
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/*  Activity Item                                                      */
/* ------------------------------------------------------------------ */

function ActivityItem({ text, time }: { text: string; time: string }) {
  return (
    <li className="flex items-start gap-3 py-3 border-b border-line/60 last:border-0">
      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{text}</p>
        <p className="text-xs text-muted mt-0.5">{time}</p>
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/*  Buyer Dashboard                                                    */
/* ------------------------------------------------------------------ */

function BuyerDashboard({ metrics, loading }: { metrics: DashboardMetrics | null; loading: boolean }) {
  const activities = [
    { text: '匹配结果已更新，新增 3 个推荐产品', time: '2 小时前' },
    { text: '供应商提交了 POC 计划', time: '5 小时前' },
    { text: '新产品加入对比列表', time: '1 天前' },
    { text: '需求完整度提升至 86%', time: '2 天前' },
  ];

  return (
    <div className="animate-fade-up">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          value={metrics?.activeDemands ?? '-'}
          label="活跃需求数"
          icon={ShoppingCart}
          loading={loading}
          delay={0}
        />
        <StatCard
          value={metrics?.receivedProposals ?? '-'}
          label="收到提案数"
          icon={FileText}
          loading={loading}
          delay={70}
        />
        <StatCard
          value={metrics?.activePoc ?? '-'}
          label="进行中POC"
          icon={FlaskConical}
          loading={loading}
          delay={140}
        />
        <StatCard
          value={metrics?.unreadMessages ?? '-'}
          label="未读消息"
          icon={MessageSquare}
          loading={loading}
          delay={210}
        />
      </div>

      {/* Quick actions */}
      <div className="mt-6">
        <h3 className="text-base font-semibold text-foreground mb-3">快捷操作</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction label="发布新需求" href="/dashboard/demands/new" icon={Plus} />
          <QuickAction label="浏览产品" href="/products" icon={Search} />
          <QuickAction label="消息中心" href="/dashboard/messages" icon={MessageSquare} />
          <QuickAction label="方案报价" href="/quote" icon={BarChart3} />
        </div>
      </div>

      {/* Recent activity */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-line rounded-2xl p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)] animate-soft-pop">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
            <ClipboardList className="h-5 w-5 text-primary" />
            待办事项
          </h3>
          <ul>
            <ActivityItem text="完善知识库需求验收指标" time="截止: 明天" />
            <ActivityItem text="确认启元AI POC样例数据" time="截止: 3天后" />
            <ActivityItem text="查看星河智能科技报价" time="截止: 本周" />
            <ActivityItem text="回复站内咨询消息" time="截止: 今天" />
          </ul>
        </div>
        <div className="bg-white border border-line rounded-2xl p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)] animate-soft-pop" style={{ animationDelay: '100ms' }}>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
            <TrendingUp className="h-5 w-5 text-green" />
            最近进展
          </h3>
          <ul>
            {activities.map((a) => (
              <ActivityItem key={a.text} text={a.text} time={a.time} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Supplier Dashboard                                                 */
/* ------------------------------------------------------------------ */

function SupplierDashboard({ metrics, loading }: { metrics: DashboardMetrics | null; loading: boolean }) {
  const leads = [
    { text: '某制造企业知识库需求', time: '30 分钟前' },
    { text: '工业视觉检测需求', time: '2 小时前' },
    { text: '科研情报Agent需求', time: '5 小时前' },
    { text: '文档审查需求', time: '1 天前' },
  ];

  return (
    <div className="animate-fade-up">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          value={metrics?.publishedProducts ?? '-'}
          label="已发布产品"
          icon={Package}
          loading={loading}
          delay={0}
        />
        <StatCard
          value={metrics?.newMatchedDemands ?? '-'}
          label="新匹配需求"
          icon={Search}
          loading={loading}
          delay={70}
        />
        <StatCard
          value={metrics?.activeProposals ?? '-'}
          label="进行中提案"
          icon={FileText}
          loading={loading}
          delay={140}
        />
        <StatCard
          value={metrics?.unreadMessages ?? '-'}
          label="未读消息"
          icon={MessageSquare}
          loading={loading}
          delay={210}
        />
      </div>

      {/* Quick actions */}
      <div className="mt-6">
        <h3 className="text-base font-semibold text-foreground mb-3">快捷操作</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction label="发布新产品" href="/products/publish" icon={Plus} />
          <QuickAction label="浏览需求" href="/demands" icon={Search} />
          <QuickAction label="消息中心" href="/dashboard/messages" icon={MessageSquare} />
          <QuickAction label="我的产品" href="/dashboard/products" icon={Package} />
        </div>
      </div>

      {/* Leads preview */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-line rounded-2xl p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)] animate-soft-pop">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
            <ClipboardList className="h-5 w-5 text-primary" />
            待办事项
          </h3>
          <ul>
            <ActivityItem text="回复知识库需求方案" time="截止: 明天" />
            <ActivityItem text="查看新需求匹配" time="截止: 今天" />
            <ActivityItem text="更新产品资料" time="截止: 本周" />
            <ActivityItem text="确认POC计划" time="截止: 3天后" />
          </ul>
        </div>
        <div className="bg-white border border-line rounded-2xl p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)] animate-soft-pop" style={{ animationDelay: '100ms' }}>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
            <TrendingUp className="h-5 w-5 text-green" />
            最近线索
          </h3>
          <ul>
            {leads.map((l) => (
              <ActivityItem key={l.text} text={l.text} time={l.time} />
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  OPC Dashboard                                                      */
/* ------------------------------------------------------------------ */

function OpcDashboard({ metrics, loading }: { metrics: DashboardMetrics | null; loading: boolean }) {
  return (
    <div className="animate-fade-up">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <StatCard
          value={metrics?.pendingMatching ?? '-'}
          label="待匹配需求"
          icon={ArrowRightLeft}
          loading={loading}
          delay={0}
        />
        <StatCard
          value={metrics?.activePoc ?? '-'}
          label="进行中POC"
          icon={FlaskConical}
          loading={loading}
          delay={70}
        />
        <StatCard
          value={metrics?.weeklyNew ?? '-'}
          label="本周新增"
          icon={TrendingUp}
          loading={loading}
          delay={140}
        />
      </div>

      {/* Quick actions */}
      <div className="mt-6">
        <h3 className="text-base font-semibold text-foreground mb-3">快捷操作</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction label="匹配管理" href="/dashboard/matching" icon={ArrowRightLeft} />
          <QuickAction label="POC 管理" href="/dashboard/poc" icon={FlaskConical} />
          <QuickAction label="消息中心" href="/dashboard/messages" icon={MessageSquare} />
          <QuickAction label="需求大厅" href="/demands" icon={Search} />
        </div>
      </div>

      {/* Placeholder activity */}
      <div className="mt-6 bg-white border border-line rounded-2xl p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)] animate-soft-pop">
        <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
          <ClipboardList className="h-5 w-5 text-primary" />
          待办事项
        </h3>
        <ul>
          <ActivityItem text="审核新需求匹配结果" time="30 分钟前" />
          <ActivityItem text="跟进制造业知识库POC进度" time="2 小时前" />
          <ActivityItem text="安排新POC启动会议" time="1 天前" />
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Admin Dashboard                                                    */
/* ------------------------------------------------------------------ */

function AdminDashboard({ metrics, loading }: { metrics: DashboardMetrics | null; loading: boolean }) {
  return (
    <div className="animate-fade-up">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard
          value={metrics?.totalUsers ?? '-'}
          label="总用户数"
          icon={Users}
          loading={loading}
          delay={0}
        />
        <StatCard
          value={metrics?.totalProducts ?? '-'}
          label="总产品数"
          icon={Package}
          loading={loading}
          delay={70}
        />
        <StatCard
          value={metrics?.totalDemands ?? '-'}
          label="总需求数"
          icon={ShoppingCart}
          loading={loading}
          delay={140}
        />
        <StatCard
          value={metrics?.activePocs ?? '-'}
          label="活跃POC数"
          icon={FlaskConical}
          loading={loading}
          delay={210}
        />
      </div>

      {/* Quick links */}
      <div className="mt-6">
        <h3 className="text-base font-semibold text-foreground mb-3">管理入口</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <QuickAction label="用户管理" href="/dashboard/admin/users" icon={Users} />
          <QuickAction label="内容审核" href="/dashboard/admin/reviews" icon={Shield} />
          <QuickAction label="系统设置" href="/dashboard/admin/settings" icon={Settings} />
          <QuickAction label="需求大厅" href="/demands" icon={Search} />
        </div>
      </div>

      {/* Placeholder platform overview */}
      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white border border-line rounded-2xl p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)] animate-soft-pop">
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
            <TrendingUp className="h-5 w-5 text-green" />
            平台概况
          </h3>
          <ul>
            <ActivityItem text="本周新注册用户 12 人" time="实时" />
            <ActivityItem text="新增需求 8 条" time="实时" />
            <ActivityItem text="新增产品 5 个" time="实时" />
            <ActivityItem text="启动POC 3 个" time="实时" />
          </ul>
        </div>
        <div className="bg-white border border-line rounded-2xl p-5 shadow-[0_8px_40px_rgba(15,23,42,0.08)] animate-soft-pop" style={{ animationDelay: '100ms' }}>
          <h3 className="flex items-center gap-2 text-base font-semibold text-foreground mb-4">
            <Shield className="h-5 w-5 text-primary" />
            待审核内容
          </h3>
          <ul>
            <ActivityItem text="2 个产品等待审核" time="1 小时前" />
            <ActivityItem text="1 条需求需要补充信息" time="3 小时前" />
            <ActivityItem text="用户举报处理" time="1 天前" />
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Default / Guest Dashboard                                         */
/* ------------------------------------------------------------------ */

function DefaultDashboard() {
  return (
    <div className="animate-fade-up">
      <div className="bg-white border border-line rounded-2xl p-8 shadow-[0_8px_40px_rgba(15,23,42,0.08)] text-center">
        <LayoutDashboard className="mx-auto h-12 w-12 text-muted/40 mb-4" />
        <h3 className="text-lg font-semibold text-foreground mb-2">
          欢迎使用 iWantU 控制台
        </h3>
        <p className="text-sm text-muted mb-6">
          请联系管理员获取相应角色权限
        </p>
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-lg bg-primary px-5 py-2.5 font-bold text-sm text-white transition-all duration-160 ease-out hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.24)]"
        >
          返回首页
        </Link>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Metrics hook                                                       */
/* ------------------------------------------------------------------ */

function useMetrics() {
  const [metrics, setMetrics] = useState<DashboardMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchMetrics() {
      try {
        const res = await fetch('/api/dashboard/metrics');
        if (res.ok) {
          const json = await res.json();
          setMetrics(json.data);
        }
      } catch {
        // API not yet available, will show placeholders
      } finally {
        setLoading(false);
      }
    }
    fetchMetrics();
  }, []);

  return { metrics, loading };
}

/* ------------------------------------------------------------------ */
/*  Main Page                                                          */
/* ------------------------------------------------------------------ */

export default function DashboardPage() {
  const { metrics, loading } = useMetrics();

  // Get user role from the API since this is a client component
  const [role, setRole] = useState<UserRole>('guest');

  useEffect(() => {
    async function fetchUser() {
      try {
        const res = await fetch('/api/auth/me');
        if (res.ok) {
          const json = await res.json();
          setRole(json.data?.role || 'guest');
        }
      } catch {
        // keep default
      }
    }
    fetchUser();
  }, []);

  const roleLabel = ROLE_LABELS[role] || '访客';

  return (
    <div>
      {/* Welcome header */}
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-foreground">
          欢迎回来
        </h2>
        <p className="mt-1 text-sm text-muted">
          {roleLabel}控制台 &mdash; 跟踪进展、管理任务、高效协作
        </p>
      </div>

      {/* Role-based content */}
      {role === 'buyer' && <BuyerDashboard metrics={metrics} loading={loading} />}
      {role === 'supplier' && <SupplierDashboard metrics={metrics} loading={loading} />}
      {role === 'opc_team' && <OpcDashboard metrics={metrics} loading={loading} />}
      {(role === 'admin' || role === 'operator') && <AdminDashboard metrics={metrics} loading={loading} />}
      {role === 'guest' && <DefaultDashboard />}
    </div>
  );
}
