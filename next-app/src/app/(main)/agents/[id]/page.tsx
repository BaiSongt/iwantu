'use client';

import { use } from 'react';
import Link from 'next/link';
import { Bot, Activity, Zap, CheckCircle2, BarChart3 } from 'lucide-react';
import { PRODUCTS } from '@/lib/constants';
import DetailBlock from '@/components/ui/DetailBlock';
import TwoColumn from '@/components/ui/TwoColumn';
import Panel from '@/components/ui/Panel';
import InfoRows from '@/components/ui/InfoRows';
import TagCloud from '@/components/ui/TagCloud';

export default function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const product = PRODUCTS.find((p) => p.id === id);

  if (!product) {
    return (
      <section className="mx-auto max-w-7xl px-6 py-20 text-center animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground mb-3">
          Agent未找到
        </h1>
        <p className="text-muted mb-6">
          未找到对应的 Agent 信息，请返回 Agent 列表重新查找。
        </p>
        <Link
          href="/agents"
          className="inline-flex items-center gap-2 rounded-xl bg-violet px-6 py-3 text-sm font-semibold text-white hover:bg-violet/90 transition-colors"
        >
          返回Agent列表
        </Link>
      </section>
    );
  }

  const mainContent = (
    <div className="space-y-6">
      {/* Agent Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Bot className="h-6 w-6 text-violet" />
          <h1 className="text-2xl font-bold text-foreground">{product.name}</h1>
        </div>
        <p className="text-sm text-muted mb-3">{product.company}</p>
        <TagCloud tags={product.tags} />
      </div>

      {/* Workflow */}
      <DetailBlock title="工作流">
        <div className="mt-4 space-y-4">
          <div className="flex items-center gap-4">
            {['输入数据', '任务解析', '工具调用', '结果输出'].map(
              (step, idx) => (
                <div key={step} className="flex items-center gap-3">
                  <div className="flex flex-col items-center gap-1.5">
                    <div className="h-10 w-10 rounded-full bg-violet/10 flex items-center justify-center">
                      <span className="text-sm font-bold text-violet">
                        {idx + 1}
                      </span>
                    </div>
                    <span className="text-xs text-muted">{step}</span>
                  </div>
                  {idx < 3 && (
                    <div className="h-px w-8 bg-line flex-shrink-0" />
                  )}
                </div>
              )
            )}
          </div>
          <p className="text-sm text-muted leading-relaxed mt-4">
            {product.summary}
          </p>
        </div>
      </DetailBlock>

      {/* Integration Systems */}
      <DetailBlock title="集成系统">
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { name: 'CRM系统', desc: '客户关系管理数据对接' },
            { name: '知识库', desc: '企业内部知识检索增强' },
            { name: 'OA系统', desc: '办公流程自动化集成' },
            { name: '数据分析', desc: '业务数据实时分析' },
          ].map((sys) => (
            <div
              key={sys.name}
              className="flex items-start gap-3 rounded-xl border border-line p-4 hover:border-violet/30 transition-colors"
            >
              <CheckCircle2 className="h-5 w-5 text-green mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  {sys.name}
                </p>
                <p className="text-xs text-muted mt-0.5">{sys.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </DetailBlock>
    </div>
  );

  const sideContent = (
    <div className="space-y-5">
      {/* Metrics Panel */}
      <Panel title="运行指标" icon={<BarChart3 className="h-5 w-5 text-violet" />}>
        <InfoRows
          rows={[
            ['评分', product.score],
            ['案例数量', `${product.caseCount} 个`],
            ['POC次数', `${product.pocCount} 次`],
            ['部署方式', product.deploy],
            ['价格', product.price],
          ]}
        />
      </Panel>

      {/* Performance Panel */}
      <Panel title="性能指标" icon={<Activity className="h-5 w-5 text-green" />}>
        <div className="space-y-4">
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-muted">任务成功率</span>
              <span className="font-medium text-green">92%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full w-[92%] rounded-full bg-green animate-progress" />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-muted">响应速度</span>
              <span className="font-medium text-primary">85%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full w-[85%] rounded-full bg-primary animate-progress" />
            </div>
          </div>
          <div>
            <div className="flex justify-between text-xs mb-1.5">
              <span className="text-muted">用户满意度</span>
              <span className="font-medium text-violet">88%</span>
            </div>
            <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
              <div className="h-full w-[88%] rounded-full bg-violet animate-progress" />
            </div>
          </div>
        </div>
      </Panel>

      {/* Quick Actions */}
      <Panel title="快速操作" icon={<Zap className="h-5 w-5 text-orange" />}>
        <div className="space-y-3">
          <Link
            href="/poc"
            className="flex items-center justify-center gap-2 w-full rounded-xl bg-violet px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet/90 transition-colors"
          >
            申请POC
          </Link>
          <Link
            href="/messages"
            className="flex items-center justify-center gap-2 w-full rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-foreground hover:border-violet/30 hover:text-violet transition-colors"
          >
            联系供应商
          </Link>
        </div>
      </Panel>
    </div>
  );

  return (
    <section className="mx-auto max-w-7xl px-6 py-10 animate-fade-up">
      <TwoColumn main={mainContent} side={sideContent} />
    </section>
  );
}
