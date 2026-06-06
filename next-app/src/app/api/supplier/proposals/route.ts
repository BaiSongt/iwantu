import type { Proposal } from '@/types';

// In-memory mock proposals store
const proposals: Proposal[] = [
  {
    id: 'prop1',
    demandId: 'd1',
    supplierId: 'mock-supplier',
    title: '知识库问答系统实施提案',
    scope: '包含需求分析、系统设计、开发部署及培训',
    price: 250000,
    currency: 'CNY',
    milestones: [
      {
        name: '需求确认与方案设计',
        description: '确认详细需求，输出技术方案文档',
        duration: '2周',
        deliverables: ['需求规格说明书', '技术方案文档'],
      },
      {
        name: '系统开发与集成',
        description: '知识库搭建、问答引擎开发、系统集成',
        duration: '4周',
        deliverables: ['可运行系统', '集成测试报告'],
      },
      {
        name: '部署上线与培训',
        description: '私有云部署、用户培训及验收',
        duration: '2周',
        deliverables: ['部署文档', '培训材料', '验收报告'],
      },
    ],
    acceptanceCriteria: [
      '问答准确率 >= 90%',
      '系统响应时间 < 3秒',
      '支持至少1000个并发用户',
    ],
    deliveryPeriod: '8周',
    status: 'submitted',
    createdAt: '2025-06-05',
  },
];

export async function GET() {
  return Response.json(
    { data: proposals },
    { headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}

export async function POST(request: Request) {
  const body = await request.json();

  const newProposal: Proposal = {
    id: `prop${Date.now()}`,
    demandId: body.demandId ?? '',
    supplierId: 'mock-supplier',
    title: body.title ?? '',
    scope: body.scope ?? '',
    price: body.price ?? 0,
    currency: body.currency ?? 'CNY',
    milestones: body.milestones ?? [],
    acceptanceCriteria: body.acceptanceCriteria ?? [],
    deliveryPeriod: body.deliveryPeriod ?? '',
    status: 'draft',
    createdAt: new Date().toISOString().slice(0, 10),
  };

  return Response.json(
    { data: newProposal },
    { status: 201, headers: { 'Access-Control-Allow-Origin': '*' } },
  );
}
