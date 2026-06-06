import { PrismaClient } from '@prisma/client';
import { hashSync } from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding database...');

  // ============================================
  // 0. Truncate all tables (dependency order)
  // ============================================
  await prisma.$executeRawUnsafe('TRUNCATE TABLE featured_items CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE reviews CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE attachments CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE agent_actions CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE audit_logs CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE thread_participants CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE messages CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE message_threads CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE quote_items CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE milestones CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE proposals CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE poc_participants CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE poc_projects CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE solutions CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE demands CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE company_profiles CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE agent_products CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE products CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE organization_members CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE users CASCADE');
  await prisma.$executeRawUnsafe('TRUNCATE TABLE organizations CASCADE');

  // ============================================
  // 1. Create Organizations (4+)
  // ============================================
  const orgZhizao = await prisma.organization.create({
    data: {
      id: 'org_zhizao',
      name: '智造科技',
      type: 'supplier',
      industry: 'manufacturing',
      description: '拥有知识库产品和制造业案例，支持 POC 与私有化交付。',
      certified: true,
      memberCount: 35,
    },
  });

  const orgShuzhi = await prisma.organization.create({
    data: {
      id: 'org_shuzhi',
      name: '数智云行',
      type: 'supplier',
      industry: 'finance',
      description: '文档审查与合规AI解决方案，面向金融与政企客户。',
      certified: true,
      memberCount: 40,
    },
  });

  const orgWeilai = await prisma.organization.create({
    data: {
      id: 'org_weilai',
      name: '未来智造研究院',
      type: 'supplier',
      industry: 'research',
      description: '科研情报追踪与趋势分析，面向科研与教育行业。',
      certified: false,
      memberCount: 20,
    },
  });

  const orgXinda = await prisma.organization.create({
    data: {
      id: 'org_xinda',
      name: '鑫达制造集团',
      type: 'buyer',
      industry: 'manufacturing',
      description: '大型制造企业，需要数字化转型。',
      certified: false,
      memberCount: 500,
    },
  });

  // Additional supplier organizations (from constants.ts)
  const orgYunmai = await prisma.organization.create({
    data: {
      id: 'org_yunmai',
      name: '云脉AI',
      type: 'supplier',
      industry: 'retail',
      description: '智能销售线索和CRM自动化服务商。',
      certified: false,
      memberCount: 20,
    },
  });

  const orgLanjing = await prisma.organization.create({
    data: {
      id: 'org_lanjing',
      name: '蓝鲸智能',
      type: 'supplier',
      industry: 'finance',
      description: '文档审查与合规AI解决方案。',
      certified: false,
      memberCount: 25,
    },
  });

  const orgYanxi = await prisma.organization.create({
    data: {
      id: 'org_yanxi',
      name: '言犀科技',
      type: 'supplier',
      industry: 'retail',
      description: '多渠道智能客服与工单系统。',
      certified: false,
      memberCount: 40,
    },
  });

  const orgShulan = await prisma.organization.create({
    data: {
      id: 'org_shulan',
      name: '数澜AI',
      type: 'supplier',
      industry: 'finance',
      description: '自然语言数据分析与报表生成。',
      certified: false,
      memberCount: 22,
    },
  });

  const orgMaguan = await prisma.organization.create({
    data: {
      id: 'org_maguan',
      name: '码观智能',
      type: 'supplier',
      industry: 'industrial_software',
      description: '代码审查与研发流程AI。',
      certified: false,
      memberCount: 30,
    },
  });

  // OPC team
  const orgOpc = await prisma.organization.create({
    data: {
      id: 'org_opc',
      name: 'iWantU平台运营',
      type: 'opc_team',
      description: '平台运营团队。',
      certified: true,
      memberCount: 10,
    },
  });

  console.log('Created organizations');

  // ============================================
  // 2. Create Users (6+)
  // ============================================
  const adminPw = hashSync('admin123', 10);
  const demoPw = hashSync('demo123', 10);

  const userAdmin = await prisma.user.create({
    data: {
      id: 'user_admin',
      name: '平台管理员',
      email: 'admin@iwantu.com',
      passwordHash: adminPw,
      role: 'admin',
      orgId: 'org_opc',
    },
  });

  const userBuyer = await prisma.user.create({
    data: {
      id: 'user_buyer',
      name: '张明',
      email: 'buyer@demo.com',
      passwordHash: demoPw,
      role: 'buyer',
      orgId: 'org_xinda',
      phone: '13800000001',
    },
  });

  const userSupplier1 = await prisma.user.create({
    data: {
      id: 'user_supplier1',
      name: '陈工',
      email: 'supplier1@demo.com',
      passwordHash: demoPw,
      role: 'supplier',
      orgId: 'org_zhizao',
      phone: '13900000001',
    },
  });

  const userSupplier2 = await prisma.user.create({
    data: {
      id: 'user_supplier2',
      name: '刘总',
      email: 'supplier2@demo.com',
      passwordHash: demoPw,
      role: 'supplier',
      orgId: 'org_shuzhi',
      phone: '13900000002',
    },
  });

  const userOpc = await prisma.user.create({
    data: {
      id: 'user_opc',
      name: '运营专员',
      email: 'opc@demo.com',
      passwordHash: demoPw,
      role: 'opc_team',
      orgId: 'org_opc',
      phone: '13700000001',
    },
  });

  const userResearcher = await prisma.user.create({
    data: {
      id: 'user_researcher',
      name: '赵博士',
      email: 'researcher@demo.com',
      passwordHash: demoPw,
      role: 'supplier',
      orgId: 'org_weilai',
      phone: '13900000003',
    },
  });

  console.log('Created users');

  // ============================================
  // 3. Create Organization Members
  // ============================================
  const allUsers = [userAdmin, userBuyer, userSupplier1, userSupplier2, userOpc, userResearcher];
  const memberRoleMap: Record<string, string> = {
    admin: 'admin',
    operator: 'operator',
    opc_team: 'operator',
  };
  for (const u of allUsers) {
    if (u.orgId) {
      await prisma.organizationMember.create({
        data: {
          userId: u.id,
          orgId: u.orgId,
          role: memberRoleMap[u.role] || 'member',
        },
      });
    }
  }
  console.log('Created organization members');

  // ============================================
  // 4. Create Products (4+)
  // ============================================
  // Product data aligned with constants.ts PRODUCTS
  await prisma.product.create({
    data: {
      id: 'p1',
      orgId: 'org_zhizao',
      name: '智问企业知识库',
      summary: '面向企业内部文档的私有化知识库问答系统，支持权限控制与答案溯源。',
      description: '',
      category: 'AI Knowledge Base',
      industryTags: ['manufacturing', 'government', 'research', 'education'],
      capabilityTags: ['RAG', '私有化', '溯源'],
      deploymentModes: ['saas', 'private_cloud', 'on_premise'],
      pricingModel: 'per_project',
      price: '按项目报价',
      supportPoc: true,
      supportPrivateDeployment: true,
      score: '4.8分',
      rating: 4.8,
      caseCount: 36,
      pocCount: 12,
      status: 'published',
      accent: 'blue',
      shot: 'knowledge',
      tags: ['RAG', '私有化', '溯源'],
      createdAt: new Date('2025-01-15'),
    },
  });

  await prisma.product.create({
    data: {
      id: 'p2',
      orgId: 'org_yunmai',
      name: '销售线索Agent',
      summary: '自动搜索市场线索、生成客户画像、跟进建议和邮件草稿。',
      description: '',
      category: 'AI Agent',
      industryTags: ['retail', 'finance'],
      capabilityTags: ['Agent', 'CRM', '自动化'],
      deploymentModes: ['saas'],
      pricingModel: 'subscription',
      price: '订阅+服务',
      supportPoc: false,
      supportPrivateDeployment: false,
      score: '4.7分',
      rating: 4.7,
      caseCount: 24,
      pocCount: 6,
      status: 'published',
      accent: 'violet',
      shot: 'sales',
      tags: ['Agent', 'CRM', '自动化'],
      createdAt: new Date('2025-02-01'),
    },
  });

  await prisma.product.create({
    data: {
      id: 'p3',
      orgId: 'org_lanjing',
      name: '文档审查助手',
      summary: '支持合同、制度、投标文件的风险识别、条款提取和修订建议。',
      description: '',
      category: 'Document AI',
      industryTags: ['government', 'finance', 'manufacturing'],
      capabilityTags: ['文档AI', '合规', '审查'],
      deploymentModes: ['private_cloud'],
      pricingModel: 'subscription',
      price: '年费制',
      supportPoc: true,
      supportPrivateDeployment: true,
      score: '4.6分',
      rating: 4.6,
      caseCount: 18,
      pocCount: 8,
      status: 'published',
      accent: 'cyan',
      shot: 'review',
      tags: ['文档AI', '合规', '审查'],
      createdAt: new Date('2025-02-10'),
    },
  });

  await prisma.product.create({
    data: {
      id: 'p4',
      orgId: 'org_yanxi',
      name: '客服智能体',
      summary: '面向售前售后场景的多渠道智能客服，支持知识库和工单联动。',
      description: '',
      category: 'Customer Service',
      industryTags: ['retail', 'education'],
      capabilityTags: ['客服', '多渠道', '工单'],
      deploymentModes: ['saas'],
      pricingModel: 'per_seat',
      price: '按席位',
      supportPoc: true,
      supportPrivateDeployment: false,
      score: '4.7分',
      rating: 4.7,
      caseCount: 42,
      pocCount: 15,
      status: 'published',
      accent: 'green',
      shot: 'support',
      tags: ['客服', '多渠道', '工单'],
      createdAt: new Date('2025-03-01'),
    },
  });

  await prisma.product.create({
    data: {
      id: 'p5',
      orgId: 'org_zhizao',
      name: '工业视觉检测AI',
      summary: '缺陷检测、产线质检与异常告警，支持边缘部署和模型迭代。',
      description: '',
      category: 'Industrial AI',
      industryTags: ['manufacturing'],
      capabilityTags: ['工业AI', '视觉', '边缘'],
      deploymentModes: ['on_premise'],
      pricingModel: 'per_project',
      price: '项目制',
      supportPoc: true,
      supportPrivateDeployment: true,
      score: '4.5分',
      rating: 4.5,
      caseCount: 14,
      pocCount: 9,
      status: 'published',
      accent: 'orange',
      shot: 'vision',
      tags: ['工业AI', '视觉', '边缘'],
      createdAt: new Date('2025-03-15'),
    },
  });

  await prisma.product.create({
    data: {
      id: 'p6',
      orgId: 'org_weilai',
      name: '科研情报Agent',
      summary: '自动追踪论文、专利、政策和产业动态，生成趋势分析报告。',
      description: '',
      category: 'Research AI',
      industryTags: ['research'],
      capabilityTags: ['科研', '情报', '报告'],
      deploymentModes: ['saas'],
      pricingModel: 'subscription',
      price: '订阅制',
      supportPoc: false,
      supportPrivateDeployment: false,
      score: '4.6分',
      rating: 4.6,
      caseCount: 20,
      pocCount: 4,
      status: 'published',
      accent: 'slate',
      shot: 'research',
      tags: ['科研', '情报', '报告'],
      createdAt: new Date('2025-04-01'),
    },
  });

  await prisma.product.create({
    data: {
      id: 'p7',
      orgId: 'org_shulan',
      name: '数据分析Copilot',
      summary: '用自然语言分析业务数据，自动生成图表、洞察和管理报告。',
      description: '',
      category: 'BI AI',
      industryTags: ['finance', 'retail'],
      capabilityTags: ['BI', 'Copilot', '报表'],
      deploymentModes: ['private_cloud'],
      pricingModel: 'per_project',
      price: '按项目',
      supportPoc: true,
      supportPrivateDeployment: true,
      score: '4.5分',
      rating: 4.5,
      caseCount: 16,
      pocCount: 7,
      status: 'published',
      accent: 'blue',
      shot: 'data',
      tags: ['BI', 'Copilot', '报表'],
      createdAt: new Date('2025-04-10'),
    },
  });

  await prisma.product.create({
    data: {
      id: 'p9',
      orgId: 'org_maguan',
      name: '代码审查Agent',
      summary: '结合仓库规范和研发流程，自动审查代码、需求文档和测试用例。',
      description: '',
      category: 'Dev AI',
      industryTags: ['industrial_software'],
      capabilityTags: ['研发', 'Agent', '审查'],
      deploymentModes: ['on_premise'],
      pricingModel: 'subscription',
      price: '年费制',
      supportPoc: true,
      supportPrivateDeployment: true,
      score: '4.6分',
      rating: 4.6,
      caseCount: 22,
      pocCount: 10,
      status: 'published',
      accent: 'green',
      shot: 'code',
      tags: ['研发', 'Agent', '审查'],
      createdAt: new Date('2025-05-15'),
    },
  });

  console.log('Created products');

  // ============================================
  // 5. Create AgentProducts (2+)
  // ============================================
  await prisma.agentProduct.create({
    data: {
      id: 'ap1',
      orgId: 'org_zhizao',
      name: '销售线索Agent',
      summary: '自动搜索市场线索、生成客户画像、跟进建议和邮件草稿。',
      description: '基于大模型的智能销售助手，自动爬取公开商业信息，生成潜在客户画像与跟进策略。',
      taskGoal: '自动发现潜在客户并生成跟进建议',
      inputSpec: ['公司名称', '行业', '地区'],
      outputSpec: ['客户画像报告', '跟进建议', '邮件草稿'],
      toolCalls: ['web_search', 'crm_read', 'crm_write', 'email_send'],
      successRate: 0.87,
      deploymentModes: ['saas'],
      pricingModel: 'subscription',
      price: '订阅制',
      supportPoc: false,
      riskLevel: 'medium',
      status: 'published',
      tags: ['Agent', 'CRM', '自动化'],
      deploy: 'SaaS/API',
      accent: 'violet',
      shot: 'sales',
    },
  });

  await prisma.agentProduct.create({
    data: {
      id: 'ap2',
      orgId: 'org_shuzhi',
      name: '文档审查Agent',
      summary: '支持合同、制度、投标文件的风险识别、条款提取和修订建议。',
      description: '基于NLP和知识图谱的智能文档审查Agent，自动识别合同风险条款并给出修订建议。',
      taskGoal: '识别文档风险条款并给出修订建议',
      inputSpec: ['文档文件（Word/PDF）'],
      outputSpec: ['风险标注', '条款摘要', '修订建议'],
      toolCalls: ['file_parse', 'nlp_analyze', 'knowledge_graph_query'],
      successRate: 0.92,
      deploymentModes: ['private_cloud'],
      pricingModel: 'per_project',
      price: '按项目',
      supportPoc: true,
      riskLevel: 'low',
      status: 'published',
      tags: ['文档AI', '合规', '审查'],
      deploy: '私有云',
      accent: 'cyan',
      shot: 'review',
    },
  });

  console.log('Created agent products');

  // ============================================
  // 6. Create Demands (3+, different statuses)
  // ============================================
  await prisma.demand.create({
    data: {
      id: 'd1',
      ownerUserId: 'user_buyer',
      ownerOrgId: 'org_xinda',
      title: '某制造企业需要建设内部制度知识库问答系统',
      industry: '制造业',
      budgetMin: 100000,
      budgetMax: 300000,
      budgetRange: '10-30万',
      deliveryPeriod: '1个月内',
      dataTypes: ['Word', 'PDF', 'Excel'],
      deploymentRequirement: '私有云',
      description: '需要建设企业内部制度知识库问答系统，覆盖生产、安全、质量管理制度，支持员工自然语言查询，答案可溯源。',
      painPoints: '制度文档分散，查找效率低，员工频繁询问制度细节。',
      existingSystems: 'OA系统、文件服务器',
      supportPoc: true,
      allowAiSupplier: true,
      allowAiAutoBid: false,
      status: 'awaiting_quote',
      matchScore: '92%',
      matchScoreNum: 0.92,
      createdAt: new Date('2025-06-01'),
    },
  });

  await prisma.demand.create({
    data: {
      id: 'd2',
      ownerUserId: 'user_researcher',
      ownerOrgId: 'org_weilai',
      title: '科研院所需要自动生成航空技术趋势分析报告',
      industry: '科研机构',
      budgetMin: 300000,
      budgetMax: 800000,
      budgetRange: '30-80万',
      deliveryPeriod: '1个月内',
      dataTypes: ['PDF', '网页', '数据库'],
      deploymentRequirement: 'SaaS',
      description: '需要自动追踪航空领域论文、专利和技术动态，定期生成趋势分析报告。',
      painPoints: '文献追踪人工成本高，报告编写耗时。',
      existingSystems: '文献数据库',
      supportPoc: true,
      allowAiSupplier: true,
      allowAiAutoBid: true,
      status: 'collecting_proposals',
      matchScore: '88%',
      matchScoreNum: 0.88,
      createdAt: new Date('2025-06-02'),
    },
  });

  await prisma.demand.create({
    data: {
      id: 'd3',
      ownerUserId: 'user_buyer',
      ownerOrgId: 'org_xinda',
      title: '制造企业需要工业视觉质检AI解决方案',
      industry: '制造业',
      budgetMin: 200000,
      budgetMax: 500000,
      budgetRange: '20-50万',
      deliveryPeriod: '3个月内',
      dataTypes: ['图片', '视频流'],
      deploymentRequirement: '本地化',
      description: '需要基于AI视觉的产线质检方案，覆盖缺陷检测、异常告警，支持边缘部署。',
      painPoints: '人工质检效率低，漏检率高。',
      existingSystems: '传统机器视觉系统',
      supportPoc: true,
      allowAiSupplier: true,
      allowAiAutoBid: false,
      status: 'clarifying',
      matchScore: '95%',
      matchScoreNum: 0.95,
      createdAt: new Date('2025-06-04'),
    },
  });

  await prisma.demand.create({
    data: {
      id: 'd4',
      ownerUserId: 'user_buyer',
      ownerOrgId: 'org_xinda',
      title: '制造企业需要代码审查与需求文档生成Agent',
      industry: '工业软件',
      budgetMin: 200000,
      budgetMax: 500000,
      budgetRange: '20-50万',
      deliveryPeriod: '3个月内',
      dataTypes: ['代码仓库', '文档'],
      deploymentRequirement: '私有化',
      description: '工业软件研发团队需要代码审查和需求文档生成Agent，覆盖需求澄清、代码审查、测试生成。',
      painPoints: '研发效率低，代码质量参差不齐。',
      existingSystems: 'Git仓库、Jira',
      supportPoc: true,
      allowAiSupplier: true,
      allowAiAutoBid: true,
      status: 'closed_deal',
      matchScore: '95%',
      matchScoreNum: 0.95,
      createdAt: new Date('2025-06-05'),
    },
  });

  console.log('Created demands');

  // ============================================
  // 7. Create Solutions (2+)
  // ============================================
  await prisma.solution.create({
    data: {
      id: 's1',
      orgId: 'org_zhizao',
      title: '制造业知识库与工艺问答方案',
      summary: '把制度、工艺、维修手册转为可信问答与溯源系统。',
      description: '面向制造业企业的知识库与工艺问答解决方案，将制度文件、工艺规程、维修手册等转化为可查询、可溯源的智能问答系统。',
      industry: ['manufacturing'],
      scenario: '制造业知识管理',
      budgetRange: '10-50万',
      deploymentModes: ['private_cloud', 'on_premise'],
      deliveryPeriod: '4-8周',
      supportPoc: true,
      components: ['知识库引擎', '文档解析', '问答界面', '权限管理'],
      recommendedProductIds: ['p1'],
      recommendedCompanyIds: ['org_zhizao'],
    },
  });

  await prisma.solution.create({
    data: {
      id: 's2',
      orgId: 'org_shuzhi',
      title: '金融投研情报自动化方案',
      summary: '汇聚研报、公告和新闻，生成可追踪的投资研究摘要。',
      description: '面向金融行业的投研情报自动化方案，汇聚研报、公告和新闻，自动生成投资研究摘要与趋势分析。',
      industry: ['finance'],
      scenario: '金融投研',
      budgetRange: '30-100万',
      deploymentModes: ['private_cloud'],
      deliveryPeriod: '6-12周',
      supportPoc: true,
      components: ['情报采集', 'NLP分析', '报告生成', '知识图谱'],
      recommendedProductIds: ['p3', 'p6'],
      recommendedCompanyIds: ['org_shuzhi'],
    },
  });

  await prisma.solution.create({
    data: {
      id: 's3',
      orgId: 'org_yanxi',
      title: '政企热线智能客服方案',
      summary: '建设多渠道客服知识库、工单联动和质检分析闭环。',
      description: '',
      industry: ['government'],
      scenario: '政企客服',
      budgetRange: '20-60万',
      deploymentModes: ['saas', 'private_cloud'],
      deliveryPeriod: '4-8周',
      supportPoc: true,
      components: ['客服机器人', '工单系统', '质检分析', '知识库'],
      recommendedProductIds: ['p4'],
      recommendedCompanyIds: ['org_yanxi'],
    },
  });

  await prisma.solution.create({
    data: {
      id: 's4',
      orgId: 'org_maguan',
      title: '软件研发 Agent 协作方案',
      summary: '覆盖需求澄清、代码审查、测试生成和交付文档。',
      description: '',
      industry: ['industrial_software'],
      scenario: '研发效率',
      budgetRange: '20-50万',
      deploymentModes: ['on_premise'],
      deliveryPeriod: '6-10周',
      supportPoc: true,
      components: ['代码审查Agent', '需求分析Agent', '测试生成', '文档助手'],
      recommendedProductIds: ['p9'],
      recommendedCompanyIds: ['org_maguan'],
    },
  });

  console.log('Created solutions');

  // ============================================
  // 8. Create CompanyProfiles (for supplier orgs)
  // ============================================
  await prisma.companyProfile.create({
    data: {
      id: 'cp1',
      orgId: 'org_zhizao',
      slogan: '拥有知识库产品和制造业案例，支持 POC 与私有化交付。',
      description: '星河智能科技旗下的智造科技品牌，拥有知识库产品和制造业案例，支持 POC 与私有化交付。',
      certifications: ['平台认证'],
      capabilities: ['RAG', '制造业', '私有云', '工业AI'],
      industryExperience: ['manufacturing', 'research'],
      deliveryScope: ['私有化RAG问答', '权限控制', '答案溯源', 'OA集成', '缺陷检测'],
      caseStudies: ['某制造业制度问答系统', '某科研机构知识库', '某汽车产线视觉检测'],
      rating: 4.8,
      responseRate: 95,
      certified: true,
      tags: ['RAG', '制造业', '私有云'],
    },
  });

  await prisma.companyProfile.create({
    data: {
      id: 'cp2',
      orgId: 'org_shuzhi',
      slogan: '文档审查与合规AI解决方案，面向金融与政企客户。',
      description: '数智云行专注于文档审查与合规AI解决方案，服务金融、政务等行业客户。',
      certifications: ['平台认证', 'ISO27001'],
      capabilities: ['文档AI', '合规', '审查', '知识图谱'],
      industryExperience: ['finance', 'government'],
      deliveryScope: ['合同审查', '制度合规检查', '投标文件分析', '风险识别'],
      caseStudies: ['某银行合同审查系统', '某政府机关制度合规检查'],
      rating: 4.7,
      responseRate: 92,
      certified: true,
      tags: ['文档AI', '合规', '审查'],
    },
  });

  await prisma.companyProfile.create({
    data: {
      id: 'cp3',
      orgId: 'org_weilai',
      slogan: '科研情报追踪与趋势分析。',
      description: '未来智造研究院专注于科研情报追踪与趋势分析，服务科研与教育行业。',
      certifications: ['平台认证'],
      capabilities: ['科研', '情报', '报告', 'NLP分析'],
      industryExperience: ['research', 'education'],
      deliveryScope: ['论文追踪', '专利分析', '趋势报告', '竞品情报'],
      caseStudies: ['某航空研究所情报系统', '某高校科研管理助手'],
      rating: 4.6,
      responseRate: 88,
      certified: false,
      tags: ['科研', '情报', '报告'],
    },
  });

  console.log('Created company profiles');

  // ============================================
  // 9. Create FeaturedItems
  // ============================================
  await prisma.featuredItem.create({
    data: {
      id: 'feat1',
      itemType: 'product',
      itemId: 'p1',
      title: '智问企业知识库',
      description: '面向企业内部文档的私有化知识库问答系统',
      position: 1,
      active: true,
    },
  });

  await prisma.featuredItem.create({
    data: {
      id: 'feat2',
      itemType: 'product',
      itemId: 'p4',
      title: '客服智能体',
      description: '多渠道智能客服，支持知识库和工单联动',
      position: 2,
      active: true,
    },
  });

  await prisma.featuredItem.create({
    data: {
      id: 'feat3',
      itemType: 'company',
      itemId: 'cp1',
      title: '智造科技',
      description: '拥有知识库产品和制造业案例，支持 POC 与私有化交付',
      position: 3,
      active: true,
    },
  });

  await prisma.featuredItem.create({
    data: {
      id: 'feat4',
      itemType: 'solution',
      itemId: 's1',
      title: '制造业知识库与工艺问答方案',
      description: '把制度、工艺、维修手册转为可信问答与溯源系统',
      position: 4,
      active: true,
    },
  });

  await prisma.featuredItem.create({
    data: {
      id: 'feat5',
      itemType: 'agent',
      itemId: 'ap1',
      title: '销售线索Agent',
      description: '自动搜索市场线索、生成客户画像、跟进建议和邮件草稿',
      position: 5,
      active: true,
    },
  });

  console.log('Created featured items');

  // ============================================
  // 10. Create MessageThread + Messages
  // ============================================
  await prisma.messageThread.create({
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
            senderId: 'user_buyer',
            senderName: '张明',
            content: '你好，我们对知识库问答系统很感兴趣，想了解更多细节。',
            timestamp: new Date('2025-06-01T09:00:00Z'),
          },
          {
            id: 'msg2',
            senderId: 'user_supplier1',
            senderName: '陈工',
            content: '您好！我们的系统支持私有化部署，可以满足制造业的知识管理需求。',
            timestamp: new Date('2025-06-01T10:15:00Z'),
          },
          {
            id: 'msg3',
            senderId: 'user_buyer',
            senderName: '张明',
            content: '我们希望支持Word、PDF、Excel等多种文档格式。',
            timestamp: new Date('2025-06-05T10:30:00Z'),
          },
        ],
      },
      participants: {
        create: [
          { id: 'tp1', userId: 'user_buyer' },
          { id: 'tp2', userId: 'user_supplier1' },
        ],
      },
    },
  });

  console.log('Created message thread');

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
