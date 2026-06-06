'use client';

import { use } from 'react';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { DEMANDS } from '@/lib/constants';
import TwoColumn from '@/components/ui/TwoColumn';
import DetailBlock from '@/components/ui/DetailBlock';
import Panel from '@/components/ui/Panel';
import InfoRows from '@/components/ui/InfoRows';
import TagCloud from '@/components/ui/TagCloud';

export default function DemandDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const demand = DEMANDS.find((d) => d.id === id);

  if (!demand) {
    return (
      <div className="mx-auto max-w-7xl px-6 py-20 text-center animate-fade-up">
        <h1 className="text-2xl font-bold text-foreground mb-2">需求未找到</h1>
        <p className="text-sm text-muted mb-6">该需求不存在或已被删除。</p>
        <Link
          href="/demands"
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white hover:bg-primary/90 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          返回需求大厅
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-6 py-10 animate-fade-up">
      {/* Back Nav */}
      <Link
        href="/demands"
        className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-primary transition-colors mb-6"
      >
        <ArrowLeft className="h-4 w-4" />
        返回需求大厅
      </Link>

      {/* Title */}
      <h1 className="text-2xl font-bold text-foreground mb-8">{demand.title}</h1>

      {/* Two Column Layout */}
      <TwoColumn
        main={
          <>
            <DetailBlock title="业务背景">
              <p className="text-sm text-muted leading-relaxed">
                企业内部积累了大量制度文档（包括行政规章、操作规范、安全标准等），员工在日常工作中查找所需制度信息耗时费力，急需一套基于AI的智能问答系统，提升制度查询效率与准确率。
              </p>
            </DetailBlock>

            <DetailBlock title="数据与系统现状">
              <InfoRows
                rows={[
                  ['数据类型', demand.dataTypes.join('、')],
                  ['数据规模', '约 5000 份文档，总计 8GB'],
                  ['现有系统', 'OA 系统（泛微）、文件共享服务器'],
                  ['部署要求', demand.deploymentRequirement],
                ]}
              />
            </DetailBlock>

            <DetailBlock title="验收指标">
              <InfoRows
                rows={[
                  ['问答准确率', '≥ 90%'],
                  ['答案溯源', '每条回答可溯源至原文'],
                  ['权限控制', '支持按部门/角色访问控制'],
                  ['响应时间', '单次问答 ≤ 3 秒'],
                  ['POC 验证', demand.supportPoc ? '需要 POC 验证' : '不需要'],
                ]}
              />
            </DetailBlock>
          </>
        }
        side={
          <>
            <Panel
              title="需求摘要"
              items={[
                `行业：${demand.industry}`,
                `预算：${demand.budgetRange}`,
                `周期：${demand.deliveryPeriod}`,
                `POC：${demand.supportPoc ? '需要' : '不需要'}`,
                `匹配度：${demand.matchScore}`,
                `状态：${demand.status === 'awaiting_quote' ? '待报价' : '征集方案'}`,
                `发布日期：${demand.createdAt}`,
              ]}
            />

            <div className="bg-panel border border-line rounded-xl p-6 mt-5 shadow-[0_10px_26px_rgba(15,23,42,0.04)]">
              <h3 className="text-base font-bold mb-3">数据类型</h3>
              <TagCloud tags={demand.dataTypes} />
              <div className="mt-4 flex gap-2">
                <Link
                  href="/match"
                  className="flex-1 inline-flex items-center justify-center rounded-xl bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 transition-colors"
                >
                  查看匹配结果
                </Link>
                <button
                  type="button"
                  className="flex-1 inline-flex items-center justify-center rounded-xl border border-line px-4 py-2 text-sm font-medium text-muted hover:border-primary/30 hover:text-primary transition-colors"
                >
                  我要报价
                </button>
              </div>
            </div>
          </>
        }
      />
    </div>
  );
}
