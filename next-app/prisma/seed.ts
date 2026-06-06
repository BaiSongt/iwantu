import { PrismaClient } from '@prisma/client';
import { PRODUCTS, DEMANDS, COMPANIES, SOLUTIONS } from '../src/lib/constants';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // Clean up existing data (order matters due to foreign keys)
  await prisma.featuredItem.deleteMany();
  await prisma.review.deleteMany();
  await prisma.attachment.deleteMany();
  await prisma.agentAction.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.threadParticipant.deleteMany();
  await prisma.message.deleteMany();
  await prisma.messageThread.deleteMany();
  await prisma.quoteItem.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.proposal.deleteMany();
  await prisma.pocParticipant.deleteMany();
  await prisma.pocProject.deleteMany();
  await prisma.solution.deleteMany();
  await prisma.demand.deleteMany();
  await prisma.companyProfile.deleteMany();
  await prisma.agentProduct.deleteMany();
  await prisma.product.deleteMany();
  await prisma.organizationMember.deleteMany();
  await prisma.companyProfile.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organization.deleteMany();

  // ============================================
  // 1. Create Organizations
  // ============================================
  const orgData = [
    {
      id: 'org_qiyuan',
      name: '启元AI',
      logo: undefined,
      type: 'supplier' as const,
      industry: 'industrial_software',
      description: '企业知识库、Agent开发与本地化部署服务商。',
      certified: true,
      memberCount: 50,
    },
    {
      id: 'org_xinghe',
      name: '星河智能科技',
      type: 'supplier' as const,
      industry: 'manufacturing',
      description: '拥有知识库产品和制造业案例，支持 POC 与私有化交付。',
      certified: true,
      memberCount: 35,
    },
    {
      id: 'org_gongshi',
      name: '工识智能',
      type: 'supplier' as const,
      industry: 'manufacturing',
      description: '围绕制造质检、工艺审查、工业软件 AI 助手提供端到端方案。',
      certified: true,
      memberCount: 28,
    },
    {
      id: 'org_yunmai',
      name: '云脉AI',
      type: 'supplier' as const,
      industry: 'retail',
      description: '智能销售线索和CRM自动化服务商。',
      certified: false,
      memberCount: 20,
    },
    {
      id: 'org_lanjing',
      name: '蓝鲸智能',
      type: 'supplier' as const,
      industry: 'finance',
      description: '文档审查与合规AI解决方案。',
      certified: false,
      memberCount: 25,
    },
    {
      id: 'org_yanxi',
      name: '言犀科技',
      type: 'supplier' as const,
      industry: 'retail',
      description: '多渠道智能客服与工单系统。',
      certified: false,
      memberCount: 40,
    },
    {
      id: 'org_ruiyan',
      name: '睿研智能',
      type: 'supplier' as const,
      industry: 'research',
      description: '科研情报追踪与趋势分析。',
      certified: false,
      memberCount: 15,
    },
    {
      id: 'org_shulan',
      name: '数澜AI',
      type: 'supplier' as const,
      industry: 'finance',
      description: '自然语言数据分析与报表生成。',
      certified: false,
      memberCount: 22,
    },
    {
      id: 'org_weiyao',
      name: '微曜科技',
      type: 'supplier' as const,
      industry: 'education',
      description: '办公流程自动化与会议助手。',
      certified: false,
      memberCount: 18,
    },
    {
      id: 'org_maguan',
      name: '码观智能',
      type: 'supplier' as const,
      industry: 'industrial_software',
      description: '代码审查与研发流程AI。',
      certified: false,
      memberCount: 30,
    },
    // Buyer organizations
    {
      id: 'org_buyer1',
      name: '某制造企业',
      type: 'buyer' as const,
      industry: 'manufacturing',
      description: '大型制造企业，需要数字化转型。',
      certified: false,
      memberCount: 500,
    },
    {
      id: 'org_buyer2',
      name: '某科研院所',
      type: 'buyer' as const,
      industry: 'research',
      description: '航空技术科研机构。',
      certified: false,
      memberCount: 200,
    },
    {
      id: 'org_buyer3',
      name: '某教育集团',
      type: 'buyer' as const,
      industry: 'education',
      description: '教育培训集团。',
      certified: false,
      memberCount: 300,
    },
    {
      id: 'org_buyer4',
      name: '某工业软件公司',
      type: 'buyer' as const,
      industry: 'industrial_software',
      description: '工业软件研发团队。',
      certified: false,
      memberCount: 80,
    },
    // OPC team
    {
      id: 'org_opc',
      name: 'iWantU平台运营',
      type: 'opc_team' as const,
      description: '平台运营团队。',
      certified: true,
      memberCount: 10,
    },
  ];

  const organizations = await Promise.all(
    orgData.map((org) => prisma.organization.create({ data: org }))
  );
  console.log(`Created ${organizations.length} organizations`);

  // ============================================
  // 2. Create Users
  // ============================================
  const userData = [
    {
      id: 'user_admin',
      name: '平台管理员',
      email: 'admin@iwantu.com',
      role: 'admin' as const,
      orgId: 'org_opc',
    },
    {
      id: 'user_operator',
      name: '运营专员',
      email: 'operator@iwantu.com',
      role: 'operator' as const,
      orgId: 'org_opc',
    },
    {
      id: 'user_buyer1',
      name: '张明',
      email: 'zhangming@manufacturer.com',
      role: 'buyer' as const,
      orgId: 'org_buyer1',
      phone: '13800000001',
    },
    {
      id: 'user_buyer2',
      name: '李芳',
      email: 'lifang@research.org',
      role: 'buyer' as const,
      orgId: 'org_buyer2',
      phone: '13800000002',
    },
    {
      id: 'user_buyer3',
      name: '王磊',
      email: 'wanglei@education.com',
      role: 'buyer' as const,
      orgId: 'org_buyer3',
      phone: '13800000003',
    },
    {
      id: 'user_buyer4',
      name: '赵强',
      email: 'zhaoqiang@indsw.com',
      role: 'buyer' as const,
      orgId: 'org_buyer4',
      phone: '13800000004',
    },
    {
      id: 'user_supplier1',
      name: '陈工',
      email: 'chengong@qiyuan.ai',
      role: 'supplier' as const,
      orgId: 'org_qiyuan',
      phone: '13900000001',
    },
    {
      id: 'user_supplier2',
      name: '刘总',
      email: 'liuzong@xinghe.ai',
      role: 'supplier' as const,
      orgId: 'org_xinghe',
      phone: '13900000002',
    },
    {
      id: 'user_supplier3',
      name: '黄工',
      email: 'huanggong@gongshi.ai',
      role: 'supplier' as const,
      orgId: 'org_gongshi',
      phone: '13900000003',
    },
  ];

  const users = await Promise.all(
    userData.map((user) => prisma.user.create({ data: user }))
  );
  console.log(`Created ${users.length} users`);

  // ============================================
  // 3. Create Organization Members
  // ============================================
  const memberData = users
    .filter((u) => u.orgId)
    .map((u) => ({
      userId: u.id,
      orgId: u.orgId!,
      role: u.role === 'admin' ? 'admin' : u.role === 'operator' ? 'operator' : 'member',
    }));

  await Promise.all(
    memberData.map((m) => prisma.organizationMember.create({ data: m }))
  );
  console.log(`Created ${memberData.length} organization members`);

  // ============================================
  // 4. Create Products (from PRODUCTS constant)
  // ============================================
  // Map product companies to org IDs
  const companyToOrgId: Record<string, string> = {
    '星河智能科技': 'org_xinghe',
    '云脉AI': 'org_yunmai',
    '蓝鲸智能': 'org_lanjing',
    '言犀科技': 'org_yanxi',
    '工识智能': 'org_gongshi',
    '睿研智能': 'org_ruiyan',
    '数澜AI': 'org_shulan',
    '微曜科技': 'org_weiyao',
    '码观智能': 'org_maguan',
  };

  const productRecords = await Promise.all(
    PRODUCTS.map((p) =>
      prisma.product.create({
        data: {
          id: p.id,
          orgId: companyToOrgId[p.company] || 'org_qiyuan',
          name: p.name,
          summary: p.summary,
          description: p.description || '',
          coverImage: p.coverImage,
          category: p.category,
          industryTags: p.industryTags,
          capabilityTags: p.capabilityTags,
          deploymentModes: p.deploymentModes,
          pricingModel: p.pricingModel,
          price: p.price,
          supportPoc: p.supportPoc,
          supportPrivateDeployment: p.supportPrivateDeployment,
          score: p.score,
          rating: p.rating,
          caseCount: p.caseCount,
          pocCount: p.pocCount,
          status: p.status,
          accent: p.accent,
          shot: p.shot,
          tags: p.tags,
          createdAt: new Date(p.createdAt),
        },
      })
    )
  );
  console.log(`Created ${productRecords.length} products`);

  // ============================================
  // 5. Create Company Profiles (from COMPANIES constant)
  // ============================================
  const companyToOrgProfileId: Record<string, string> = {
    '启元AI': 'org_qiyuan',
    '星河智能科技': 'org_xinghe',
    '工识智能': 'org_gongshi',
  };

  const companyProfiles = await Promise.all(
    COMPANIES.map((c) =>
      prisma.companyProfile.create({
        data: {
          id: c.id,
          orgId: companyToOrgProfileId[c.name] || 'org_qiyuan',
          slogan: c.slogan,
          description: c.description,
          certifications: c.certifications,
          capabilities: c.capabilities,
          industryExperience: c.industryExperience,
          deliveryScope: c.deliveryScope,
          caseStudies: c.caseStudies,
          rating: c.rating,
          responseRate: c.responseRate,
          certified: c.certified,
          tags: c.tags,
        },
      })
    )
  );
  console.log(`Created ${companyProfiles.length} company profiles`);

  // ============================================
  // 6. Create Demands (from DEMANDS constant)
  // ============================================
  const demandOwnerMap: Record<string, { userId: string; orgId: string }> = {
    d1: { userId: 'user_buyer1', orgId: 'org_buyer1' },
    d2: { userId: 'user_buyer2', orgId: 'org_buyer2' },
    d3: { userId: 'user_buyer3', orgId: 'org_buyer3' },
    d4: { userId: 'user_buyer4', orgId: 'org_buyer4' },
  };

  const demandRecords = await Promise.all(
    DEMANDS.map((d) => {
      const owner = demandOwnerMap[d.id] || { userId: 'user_buyer1', orgId: 'org_buyer1' };
      return prisma.demand.create({
        data: {
          id: d.id,
          ownerUserId: owner.userId,
          ownerOrgId: owner.orgId,
          title: d.title,
          industry: d.industry,
          budgetMin: d.budgetMin,
          budgetMax: d.budgetMax,
          budgetRange: d.budgetRange,
          deliveryPeriod: d.deliveryPeriod,
          dataTypes: d.dataTypes,
          deploymentRequirement: d.deploymentRequirement,
          description: d.description || '',
          painPoints: d.painPoints || '',
          existingSystems: d.existingSystems || '',
          supportPoc: d.supportPoc,
          allowAiSupplier: d.allowAiSupplier,
          status: d.status,
          createdAt: new Date(d.createdAt),
        },
      });
    })
  );
  console.log(`Created ${demandRecords.length} demands`);

  // ============================================
  // 7. Create Solutions (from SOLUTIONS constant)
  // ============================================
  const solutionOrgMap: Record<string, string> = {
    s1: 'org_qiyuan',
    s2: 'org_ruiyan',
    s3: 'org_yanxi',
    s4: 'org_maguan',
  };

  const solutionRecords = await Promise.all(
    SOLUTIONS.map((s) =>
      prisma.solution.create({
        data: {
          id: s.id,
          orgId: solutionOrgMap[s.id] || 'org_qiyuan',
          title: s.title,
          summary: s.summary,
          description: s.description || '',
          industry: s.industry,
          scenario: s.scenario,
          budgetRange: s.budgetRange,
          deploymentModes: s.deploymentModes,
          deliveryPeriod: s.deliveryPeriod,
          supportPoc: s.supportPoc,
          components: s.components,
          recommendedProductIds: s.recommendedProducts,
          recommendedCompanyIds: s.recommendedCompanies,
        },
      })
    )
  );
  console.log(`Created ${solutionRecords.length} solutions`);

  // ============================================
  // 8. Create Sample POC Project
  // ============================================
  const pocProject = await prisma.pocProject.create({
    data: {
      id: 'poc1',
      demandId: 'd1',
      productId: 'p1',
      supplierOrgId: 'org_xinghe',
      status: 'confirming_requirements',
      testMetrics: ['准确率', '响应时间', '覆盖率'],
      acceptanceCriteria: ['准确率 > 90%', '响应时间 < 3s', '覆盖率 > 80%'],
      sampleDataStatus: 'pending',
      startDate: new Date('2025-06-15'),
      participants: {
        create: [
          { id: 'poc_p1', userId: 'user_buyer1', role: 'buyer', orgId: 'org_buyer1' },
          { id: 'poc_p2', userId: 'user_supplier2', role: 'supplier', orgId: 'org_xinghe' },
        ],
      },
    },
  });
  console.log('Created sample POC project');

  // ============================================
  // 9. Create Sample Proposal
  // ============================================
  const proposal = await prisma.proposal.create({
    data: {
      id: 'prop1',
      demandId: 'd1',
      supplierOrgId: 'user_supplier2',
      title: '知识库问答系统实施方案',
      scope: '私有化部署知识库问答系统，包含文档解析、权限管理、答案溯源等模块。',
      price: 250000,
      currency: 'CNY',
      deliveryPeriod: '4周',
      status: 'submitted',
      milestones: {
        create: [
          {
            id: 'ms1',
            name: '需求确认与环境准备',
            description: '确认需求细节，搭建私有化部署环境。',
            duration: '1周',
            deliverables: ['需求文档', '环境配置报告'],
          },
          {
            id: 'ms2',
            name: '系统开发与集成',
            description: '完成文档解析、问答引擎、权限管理等核心模块开发。',
            duration: '2周',
            deliverables: ['系统原型', '接口文档', '测试用例'],
          },
          {
            id: 'ms3',
            name: '测试验收与交付',
            description: '进行系统测试、用户验收培训及正式上线。',
            duration: '1周',
            deliverables: ['测试报告', '用户手册', '运维文档'],
          },
        ],
      },
      quoteItems: {
        create: [
          {
            id: 'qi1',
            name: '知识库引擎许可',
            description: '私有化部署的知识库引擎软件许可。',
            quantity: 1,
            unit: '套',
            unitPrice: 120000,
            totalPrice: 120000,
          },
          {
            id: 'qi2',
            name: '定制开发服务',
            description: '权限管理、答案溯源等定制开发。',
            quantity: 1,
            unit: '项',
            unitPrice: 80000,
            totalPrice: 80000,
          },
          {
            id: 'qi3',
            name: '部署与培训',
            description: '私有化部署实施及用户培训。',
            quantity: 1,
            unit: '项',
            unitPrice: 50000,
            totalPrice: 50000,
          },
        ],
      },
    },
  });
  console.log('Created sample proposal');

  // ============================================
  // 10. Create Sample Message Thread
  // ============================================
  const thread = await prisma.messageThread.create({
    data: {
      id: 'thread1',
      title: '关于知识库问答系统的需求沟通',
      type: 'demand',
      relatedId: 'd1',
      lastMessage: '我们希望支持Word、PDF、Excel等多种文档格式。',
      lastMessageAt: new Date('2025-06-05T10:30:00Z'),
      messages: {
        create: [
          {
            id: 'msg1',
            senderId: 'user_buyer1',
            senderName: '张明',
            content: '你好，我们对知识库问答系统很感兴趣，想了解更多细节。',
            timestamp: new Date('2025-06-01T09:00:00Z'),
          },
          {
            id: 'msg2',
            senderId: 'user_supplier2',
            senderName: '刘总',
            content: '您好！我们的系统支持私有化部署，可以满足制造业的知识管理需求。',
            timestamp: new Date('2025-06-01T10:15:00Z'),
          },
          {
            id: 'msg3',
            senderId: 'user_buyer1',
            senderName: '张明',
            content: '我们希望支持Word、PDF、Excel等多种文档格式。',
            timestamp: new Date('2025-06-05T10:30:00Z'),
          },
        ],
      },
      participants: {
        create: [
          { id: 'tp1', userId: 'user_buyer1' },
          { id: 'tp2', userId: 'user_supplier2' },
        ],
      },
    },
  });
  console.log('Created sample message thread');

  // ============================================
  // 11. Create Featured Items
  // ============================================
  const featuredItems = await Promise.all([
    prisma.featuredItem.create({
      data: {
        id: 'feat1',
        itemType: 'product',
        itemId: 'p1',
        title: '智问企业知识库',
        description: '面向企业内部文档的私有化知识库问答系统',
        position: 1,
        active: true,
      },
    }),
    prisma.featuredItem.create({
      data: {
        id: 'feat2',
        itemType: 'product',
        itemId: 'p4',
        title: '客服智能体',
        description: '多渠道智能客服，支持知识库和工单联动',
        position: 2,
        active: true,
      },
    }),
    prisma.featuredItem.create({
      data: {
        id: 'feat3',
        itemType: 'company',
        itemId: 'c1',
        title: '启元AI',
        description: '企业知识库、Agent开发与本地化部署服务商',
        position: 3,
        active: true,
      },
    }),
    prisma.featuredItem.create({
      data: {
        id: 'feat4',
        itemType: 'solution',
        itemId: 's1',
        title: '制造业知识库与工艺问答方案',
        description: '把制度、工艺、维修手册转为可信问答与溯源系统',
        position: 4,
        active: true,
      },
    }),
    prisma.featuredItem.create({
      data: {
        id: 'feat5',
        itemType: 'team',
        itemId: 'd1',
        title: '某制造企业需要建设内部制度知识库问答系统',
        description: '预算10-30万，支持POC验证',
        position: 5,
        active: true,
      },
    }),
  ]);
  console.log(`Created ${featuredItems.length} featured items`);

  // ============================================
  // 12. Create Sample Reviews
  // ============================================
  const reviews = await Promise.all([
    prisma.review.create({
      data: {
        id: 'rev1',
        targetType: 'product',
        targetId: 'p1',
        userId: 'user_buyer1',
        rating: 4.8,
        content: '知识库问答准确率很高，支持溯源功能非常实用。私有化部署方案也很完善。',
      },
    }),
    prisma.review.create({
      data: {
        id: 'rev2',
        targetType: 'product',
        targetId: 'p4',
        userId: 'user_buyer3',
        rating: 4.6,
        content: '客服智能体多渠道支持很好，工单联动功能提升了客服效率。',
      },
    }),
    prisma.review.create({
      data: {
        id: 'rev3',
        targetType: 'company',
        targetId: 'c1',
        userId: 'user_buyer1',
        rating: 4.9,
        content: '启元AI的服务非常专业，从需求分析到部署上线全程跟进，响应速度快。',
      },
    }),
  ]);
  console.log(`Created ${reviews.length} reviews`);

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
