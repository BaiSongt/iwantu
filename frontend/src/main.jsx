import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowRight,
  BarChart3,
  Bell,
  Bot,
  BriefcaseBusiness,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleDollarSign,
  Clock3,
  FileCheck2,
  Filter,
  LayoutDashboard,
  MessageSquareText,
  PackagePlus,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Store,
  Upload,
  WandSparkles,
  Workflow
} from 'lucide-react';
import './styles.css';

const NAV = [
  ['home', '首页'],
  ['featured', '精选'],
  ['products', 'AI产品'],
  ['agents', 'AI Agent'],
  ['companies', 'AI公司'],
  ['demands', '需求大厅'],
  ['solutions', '解决方案']
];

const products = [
  {
    name: '智问企业知识库',
    company: '星河智能科技',
    desc: '面向企业内部文档的私有化知识库问答系统，支持权限控制与答案溯源。',
    tags: ['RAG', '私有化', '溯源'],
    score: '4.8分',
    deploy: 'SaaS/本地',
    price: '按项目报价',
    accent: 'blue',
    shot: 'knowledge'
  },
  {
    name: '销售线索Agent',
    company: '云脉AI',
    desc: '自动搜索市场线索、生成客户画像、跟进建议和邮件草稿。',
    tags: ['Agent', 'CRM', '自动化'],
    score: '4.7分',
    deploy: 'SaaS/API',
    price: '订阅+服务',
    accent: 'violet',
    shot: 'sales'
  },
  {
    name: '文档审查助手',
    company: '蓝鲸智能',
    desc: '支持合同、制度、投标文件的风险识别、条款提取和修订建议。',
    tags: ['文档AI', '合规', '审查'],
    score: '4.6分',
    deploy: '私有云',
    price: '年费制',
    accent: 'cyan',
    shot: 'review'
  },
  {
    name: '客服智能体',
    company: '言犀科技',
    desc: '面向售前售后场景的多渠道智能客服，支持知识库和工单联动。',
    tags: ['客服', '多渠道', '工单'],
    score: '4.7分',
    deploy: 'SaaS',
    price: '按席位',
    accent: 'green',
    shot: 'support'
  },
  {
    name: '工业视觉检测AI',
    company: '工识智能',
    desc: '缺陷检测、产线质检与异常告警，支持边缘部署和模型迭代。',
    tags: ['工业AI', '视觉', '边缘'],
    score: '4.5分',
    deploy: '本地化',
    price: '项目制',
    accent: 'orange',
    shot: 'vision'
  },
  {
    name: '科研情报Agent',
    company: '睿研智能',
    desc: '自动追踪论文、专利、政策和产业动态，生成趋势分析报告。',
    tags: ['科研', '情报', '报告'],
    score: '4.6分',
    deploy: 'SaaS/API',
    price: '订阅制',
    accent: 'slate',
    shot: 'research'
  },
  {
    name: '数据分析Copilot',
    company: '数澜AI',
    desc: '用自然语言分析业务数据，自动生成图表、洞察和管理报告。',
    tags: ['BI', 'Copilot', '报表'],
    score: '4.5分',
    deploy: '私有云',
    price: '按项目',
    accent: 'blue',
    shot: 'data'
  },
  {
    name: 'AI办公助手',
    company: '微曜科技',
    desc: '会议纪要、周报生成、制度问答和办公流程自动化助手。',
    tags: ['办公', '流程', '总结'],
    score: '4.4分',
    deploy: 'SaaS',
    price: '按用户',
    accent: 'violet',
    shot: 'office'
  },
  {
    name: '代码审查Agent',
    company: '码观智能',
    desc: '结合仓库规范和研发流程，自动审查代码、需求文档和测试用例。',
    tags: ['研发', 'Agent', '审查'],
    score: '4.6分',
    deploy: '私有化',
    price: '年费制',
    accent: 'green',
    shot: 'code'
  }
];

const demands = [
  ['某制造企业需要建设内部制度知识库问答系统', '制造业', '10-30万', '1个月内', '92%'],
  ['科研院所需要自动生成航空技术趋势分析报告', '科研机构', '30-80万', '1个月内', '88%'],
  ['教育集团希望搭建招生客服与内容生成AI助手', '教育', '5-20万', '1个月内', '76%'],
  ['工业软件团队需要代码审查与需求文档生成Agent', '工业软件', '20-50万', '3个月内', '95%']
];

const companies = [
  ['启元AI', '企业知识库、Agent开发与本地化部署服务商。', ['Agent开发', '知识库', '本地部署']],
  ['星河智能科技', '拥有知识库产品和制造业案例，支持 POC 与私有化交付。', ['RAG', '制造业', '私有云']],
  ['工识智能', '围绕制造质检、工艺审查、工业软件 AI 助手提供端到端方案。', ['工业AI', '视觉检测', '边缘部署']]
];

const solutions = [
  ['制造业知识库与工艺问答方案', '把制度、工艺、维修手册转为可信问答与溯源系统。'],
  ['金融投研情报自动化方案', '汇聚研报、公告和新闻，生成可追踪的投资研究摘要。'],
  ['政企热线智能客服方案', '建设多渠道客服知识库、工单联动和质检分析闭环。'],
  ['软件研发 Agent 协作方案', '覆盖需求澄清、代码审查、测试生成和交付文档。']
];

function App() {
  const [page, setPage] = useState('home');
  const activeLabel = useMemo(() => NAV.find(([id]) => id === page)?.[1] || '首页', [page]);
  const currentPage = (
    <>
      {page === 'home' && <Home setPage={setPage} />}
      {page === 'featured' && <Featured setPage={setPage} />}
      {page === 'products' && <Products setPage={setPage} />}
      {page === 'demands' && <DemandHall setPage={setPage} />}
      {page === 'publishDemand' && <PublishDemand setPage={setPage} />}
      {page === 'match' && <MatchResult setPage={setPage} />}
      {page === 'detail' && <ProductDetail setPage={setPage} />}
      {page === 'publishProduct' && <PublishProduct />}
      {page === 'demandDetail' && <DemandDetail />}
      {page === 'buyer' && <Dashboard type="buyer" />}
      {page === 'supplier' && <Dashboard type="supplier" />}
      {page === 'compare' && <Compare />}
      {page === 'agents' && <Agents setPage={setPage} />}
      {page === 'agentDetail' && <AgentDetail />}
      {page === 'companies' && <Companies setPage={setPage} />}
      {page === 'companyProfile' && <CompanyProfile />}
      {page === 'solutions' && <Solutions setPage={setPage} />}
      {page === 'solutionDetail' && <SolutionDetail />}
      {page === 'poc' && <PocWorkflow />}
      {page === 'quote' && <QuoteProposal />}
      {page === 'messages' && <Messages />}
    </>
  );

  useEffect(() => {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  }, [page]);

  return (
    <div className="app">
      <TopNav page={page} setPage={setPage} />
      <main>
        <div className="page-transition" key={page}>
          {currentPage}
        </div>
      </main>
      <footer>
        <Logo />
        <span>当前视图：{activeLabel}</span>
        <button onClick={() => setPage('buyer')}>需求方控制台</button>
        <button onClick={() => setPage('supplier')}>供应商后台</button>
        <button onClick={() => setPage('messages')}>站内沟通</button>
      </footer>
    </div>
  );
}

function TopNav({ page, setPage }) {
  return (
    <header className="topnav">
      <Logo />
      <nav>
        {NAV.map(([id, label]) => (
          <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}>
            {label}
          </button>
        ))}
      </nav>
      <div className="nav-actions">
        <button className="ghost" onClick={() => setPage('publishProduct')}>
          发布产品
        </button>
        <button className="primary" onClick={() => setPage('publishDemand')}>
          发布需求
        </button>
      </div>
    </header>
  );
}

function Logo() {
  return (
    <div className="logo">
      <span>U</span>
      <strong>iWantU</strong>
    </div>
  );
}

function HeroGraphic() {
  return (
    <div className="hero-graphic" aria-hidden="true">
      <div className="graph-center">U</div>
      {['产品', '需求', 'Agent', '公司', 'POC'].map((item, index) => (
        <div className={`graph-node node-${index}`} key={item}>
          {item}
        </div>
      ))}
      <div className="graph-caption">AI能力匹配图谱</div>
    </div>
  );
}

function Home({ setPage }) {
  return (
    <Page>
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">AI能力供需撮合平台</p>
          <h1>找到你真正需要的 AI 能力</h1>
          <p>
            iWantU 连接 AI 需求方与 AI 能力方，帮助企业发布需求、匹配产品、筛选公司、启动
            POC 与采购沟通。
          </p>
          <div className="searchbar">
            <Search size={20} />
            <span>描述你的AI需求，例如：我想做一个企业知识库问答系统</span>
            <button onClick={() => setPage('match')}>智能匹配</button>
          </div>
          <div className="hero-actions">
            <button className="primary big" onClick={() => setPage('publishDemand')}>
              发布AI需求
            </button>
            <button className="secondary big" onClick={() => setPage('products')}>
              寻找AI产品
            </button>
          </div>
        </div>
        <HeroGraphic />
      </section>

      <MetricGrid
        items={[
          ['3,000+', 'AI产品与Agent'],
          ['600+', '企业需求线索'],
          ['120+', '平台认证公司'],
          ['48h', '平均匹配响应']
        ]}
      />

      <SectionTitle title="选择你的入口" desc="从需求、产品、公司、POC 四条路径进入平台。" />
      <div className="entry-grid">
        {[
          ['01', '我要找AI', '发布业务需求，平台为你匹配AI产品、Agent和服务商', 'publishDemand'],
          ['02', '我要卖AI', '发布AI产品、Agent、解决方案，获取企业需求线索', 'publishProduct'],
          ['03', '我是AI公司', '建立公司主页，展示案例、能力、团队和交付经验', 'companyProfile'],
          ['04', '我要做POC', '上传样例数据，快速验证AI产品是否适合你的场景', 'poc']
        ].map(([num, title, desc, target], index) => (
          <button className="entry-card" key={title} style={{ '--i': index }} onClick={() => setPage(target)}>
            <span>{num}</span>
            <strong>{title}</strong>
            <p>{desc}</p>
            <ArrowRight size={18} />
          </button>
        ))}
      </div>

      <SectionTitle title="热门AI能力分类" desc="覆盖企业高频采购和行业 Agent 应用。" />
      <TagCloud tags={['知识库问答', 'AI客服', 'AI办公', '数据分析', 'OCR', 'Agent平台', '工业AI', '科研情报']} />

      <SectionTitle title="推荐AI产品" />
      <div className="product-grid three">
        {products.slice(0, 3).map((product, index) => (
          <ProductCard key={product.name} product={product} setPage={setPage} index={index} />
        ))}
      </div>
    </Page>
  );
}

function Featured({ setPage }) {
  return (
    <Page>
      <section className="featured-hero">
        <div>
          <p className="eyebrow">精选</p>
          <h1>让企业把 AI 需求讲清楚，找到真正能交付的能力方</h1>
          <p>精选推荐可 POC、可私有化、具备案例的 AI 产品、OPC 公司与专业团队。</p>
          <button className="primary" onClick={() => setPage('publishDemand')}>发布需求</button>
          <button className="secondary" onClick={() => setPage('products')}>浏览推荐</button>
        </div>
        <div className="topic-stack">
          {['工业视觉AI', '科研情报Agent', 'OPC交付团队', '知识库问答'].map((item) => (
            <span key={item}>{item}</span>
          ))}
        </div>
      </section>
      <SectionTitle title="优秀产品与团队" desc="图片优先展示，适合做平台专题、榜单和运营推荐。" />
      <div className="feature-cards">
        {[
          ['智问企业知识库', '私有化 RAG 问答、权限控制、答案溯源，适合政企和制造企业。'],
          ['启元AI交付团队', '专注企业知识库、Agent编排与本地化部署，适合中大型企业 POC。'],
          ['工业AI实施小组', '围绕制造质检、工艺审查、工业软件AI助手提供方案。']
        ].map(([title, desc], i) => (
          <article className="feature-card" key={title} style={{ '--i': i }}>
            <VisualShot variant={products[i].shot} accent={products[i].accent} />
            <h3>{title}</h3>
            <p>{desc}</p>
            <button onClick={() => setPage('detail')}>查看详情</button>
            <button className="primary" onClick={() => setPage('messages')}>联系咨询</button>
          </article>
        ))}
      </div>
      <SectionTitle title="今日推荐" desc="横幅级展示，适合平台运营位：主推产品、主推OPC公司、主推团队。" />
      <div className="image-first-grid">
        {products.slice(5, 9).map((product, index) => (
          <button className="image-first" key={product.name} style={{ '--i': index }} onClick={() => setPage('detail')}>
            <VisualShot variant={product.shot} accent={product.accent} />
            <strong>{product.name}</strong>
            <span>查看并联系</span>
          </button>
        ))}
      </div>
    </Page>
  );
}

function Products({ setPage }) {
  return (
    <Page title="AI产品市场" desc="筛选可试用、可私有化、可POC的企业级 AI 产品。">
      <div className="with-sidebar">
        <FilterPanel title="筛选条件" groups={['能力分类', '部署方式', '价格模式', '行业场景', '认证状态']} />
        <section className="content-list">
          <Toolbar count="共找到 286 个 AI 产品" action="发布产品" onAction={() => setPage('publishProduct')} />
          <div className="product-grid">
            {products.map((product, index) => (
              <ProductCard key={product.name} product={product} compact setPage={setPage} index={index} />
            ))}
          </div>
        </section>
      </div>
    </Page>
  );
}

function DemandHall({ setPage }) {
  return (
    <Page title="AI需求大厅" desc="企业真实 AI 需求线索，AI公司和服务商可提交方案、报价或申请 POC。">
      <MetricGrid items={[['128', '待报价需求'], ['47', 'POC进行中'], ['86%', '平均匹配度'], ['24h', '平均响应']]} />
      <div className="with-sidebar">
        <FilterPanel title="需求筛选" groups={['行业', '预算', '周期', '是否POC', '数据类型']} />
        <section className="content-list">
          <Toolbar count="最新需求" action="发布需求" onAction={() => setPage('publishDemand')} />
          <div className="demand-list">
            {demands.map((demand, index) => (
              <DemandCard key={demand[0]} demand={demand} setPage={setPage} index={index} />
            ))}
          </div>
        </section>
      </div>
    </Page>
  );
}

function PublishDemand({ setPage }) {
  const fields = [
    ['联系人', '请输入姓名'],
    ['联系方式', '手机 / 邮箱 / 企业微信'],
    ['部署要求', 'SaaS / 私有云 / 本地化'],
    ['是否需要POC', '是 / 否'],
    ['数据类型', 'Word / PDF / Excel / 图片 / 数据库'],
    ['数据规模', '约5000份文档 / 100GB数据'],
    ['系统集成', 'OA / ERP / CRM / PLM / 数据库'],
    ['期望周期', '1个月内 / 3个月内'],
    ['能力类型', '知识库问答 / AI客服 / Agent'],
    ['预算范围', '10-30万'],
    ['需求标题', '例如：建设企业知识库问答系统'],
    ['行业场景', '制造业 / 政务 / 金融']
  ];
  return (
    <Page title="发布AI需求" desc="用结构化表单和 AI 需求助手，把一句模糊想法转成可报价、可匹配、可POC的标准需求。">
      <div className="form-layout">
        <section className="form-card">
          <div className="form-actions">
            <button><WandSparkles size={16} />AI帮我完善需求</button>
            <button>生成标准需求书</button>
            <button className="primary" onClick={() => setPage('match')}>发布需求</button>
          </div>
          <h2>需求基本信息</h2>
          <div className="field-grid">
            {fields.map(([label, placeholder]) => (
              <label key={label}>
                <span>{label}</span>
                <input placeholder={placeholder} />
              </label>
            ))}
          </div>
          <label className="wide-field">
            <span>业务问题描述</span>
            <textarea placeholder="描述现在业务中最耗时、最容易出错或最需要自动化的环节" />
          </label>
        </section>
        <aside className="assistant-card">
          <Sparkles size={24} />
          <h2>AI需求澄清助手</h2>
          <div className="progress"><span style={{ width: '72%' }} /></div>
          <strong>需求完整度 72%</strong>
          <h3>建议补充</h3>
          {[
            '请说明你的数据类型，例如 Word、PDF、Excel、数据库',
            '请说明是否需要私有化部署及数据安全要求',
            '请说明是否需要与现有 OA、ERP、CRM 集成',
            '建议补充验收指标，例如准确率、响应时间、溯源率'
          ].map((item) => <p key={item}>{item}</p>)}
          <button>一键优化</button>
          <button className="secondary">查看匹配规则</button>
        </aside>
      </div>
    </Page>
  );
}

function MatchResult({ setPage }) {
  return (
    <Page title="智能匹配结果" desc="平台已将你的自然语言需求解析为结构化标签，并推荐产品、公司和 Agent。">
      <section className="summary-card">
        <h2>需求摘要</h2>
        <p>某制造企业希望基于内部制度、流程文件和知识文档建设一个企业知识库问答系统，要求支持私有化部署、权限控制、答案溯源和 POC 验证。</p>
        <TagCloud tags={['制造业', 'RAG', '私有化', '权限控制', '答案溯源', '需要POC']} />
      </section>
      <SectionTitle title="推荐产品" />
      <div className="product-grid three">
        {products.slice(0, 3).map((product, index) => <ProductCard key={product.name} product={product} setPage={setPage} index={index} />)}
      </div>
      <SectionTitle title="推荐公司与下一步建议" />
      <div className="company-grid">
        {companies.slice(0, 2).map((company, index) => <CompanyCard key={company[0]} company={company} setPage={setPage} index={index} />)}
        <article className="risk-card" style={{ '--i': 2 }}>
          <ShieldCheck size={24} />
          <h3>风险提示</h3>
          <p>不建议直接采购通用聊天机器人。你的核心问题不是对话，而是内部知识可信问答、权限隔离、证据溯源和数据安全。</p>
          <button className="primary" onClick={() => setPage('poc')}>生成POC方案</button>
        </article>
      </div>
    </Page>
  );
}

function ProductDetail({ setPage }) {
  return (
    <Page title="智问企业知识库" desc="Amazon式产品详情：上方完成采购判断，下方承载企业上传的完整产品介绍、截图、案例和资料。">
      <section className="detail-top">
        <div className="gallery"><VisualShot variant="knowledge" accent="blue" /></div>
        <div className="decision">
          <p className="crumb">AI产品 / 智问企业知识库</p>
          <h1>面向企业内部文档的私有化知识库问答系统</h1>
          <p>星河智能科技 · 平台认证服务商</p>
          <p>4.8 分 · 36 个案例 · 12 次平台 POC</p>
          <TagCloud tags={['RAG', '权限控制', '答案溯源', 'SaaS / 私有云 / 本地化']} />
          <InfoRows rows={[['适用行业', '制造业 / 政务 / 科研 / 教育'], ['数据类型', 'Word / PDF / Excel / 网页 / 数据库'], ['POC周期', '2-6 周 POC，按项目实施']]} />
        </div>
        <aside className="consult">
          <h2>按项目报价</h2>
          <p>采购与咨询</p>
          <button className="primary" onClick={() => setPage('poc')}>申请POC</button>
          <button onClick={() => setPage('messages')}>联系供应商</button>
          <button onClick={() => setPage('compare')}>加入对比</button>
          <p className="safe">平台保障：认证公司、资料留痕、POC流程托管</p>
        </aside>
      </section>
      <Tabs tabs={['产品介绍', '功能详情', '案例展示', '部署与安全', '资料附件', '企业评价']} />
      <DetailBlock title="产品介绍内容占位" />
      <DetailBlock title="功能详情与模块介绍" visuals />
      <DetailBlock title="客户案例与交付成果" />
      <DetailBlock title="资料附件与需求对接" actions />
    </Page>
  );
}

function Agents({ setPage }) {
  return (
    <Page title="AI Agent专区" desc="面向具体工作流的智能体能力，支持试用、集成和定制。">
      <div className="product-grid three">
        {products.filter(p => p.name.includes('Agent') || p.tags.includes('Agent')).map((product, index) => (
          <ProductCard key={product.name} product={product} setPage={() => setPage('agentDetail')} index={index} />
        ))}
      </div>
    </Page>
  );
}

function AgentDetail() {
  return (
    <Page title="销售线索Agent" desc="从市场信号到客户画像，再到跟进建议和邮件草稿的自动化智能体。">
      <TwoColumn
        main={<><DetailBlock title="Agent工作流" visuals /><DetailBlock title="可集成系统" /></>}
        side={<Panel title="运行指标" items={['线索识别准确率 91%', '周均节省 18 小时', '支持 CRM / 邮件 / 企业微信', '可按行业定制提示词']} />}
      />
    </Page>
  );
}

function Companies({ setPage }) {
  return (
    <Page title="AI公司与OPC" desc="查看平台认证公司、交付团队、擅长能力与项目案例。">
      <div className="company-grid">
        {companies.map((company, index) => <CompanyCard key={company[0]} company={company} setPage={setPage} index={index} />)}
      </div>
    </Page>
  );
}

function CompanyProfile() {
  return (
    <Page title="启元AI OPC主页" desc="认证服务商主页，展示能力、团队、案例、交付流程与客户评价。">
      <section className="profile-hero">
        <div className="avatar">启元</div>
        <div>
          <h1>启元AI</h1>
          <p>专注企业知识库、Agent开发与私有化部署服务。</p>
          <TagCloud tags={['已认证', 'Agent开发', '知识库', '本地部署']} />
        </div>
      </section>
      <div className="dashboard-grid">
        <Panel title="核心能力" items={['企业知识库搭建', 'Agent 编排与集成', '私有化部署', 'POC 快速验证']} />
        <Panel title="交付案例" items={['制造业制度问答', '政务知识库助手', '研发文档审查', '客服知识库升级']} />
        <Panel title="服务承诺" items={['48小时响应', '标准验收指标', '交付资料归档', '平台沟通留痕']} />
      </div>
    </Page>
  );
}

function Solutions({ setPage }) {
  return (
    <Page title="解决方案专区" desc="按行业和业务场景聚合产品、Agent、公司与 POC 模板。">
      <div className="solution-grid">
        {solutions.map(([title, desc], index) => (
          <button className="solution-card" key={title} style={{ '--i': index }} onClick={() => setPage('solutionDetail')}>
            <Workflow size={24} />
            <h3>{title}</h3>
            <p>{desc}</p>
            <span>查看方案 <ArrowRight size={16} /></span>
          </button>
        ))}
      </div>
    </Page>
  );
}

function SolutionDetail() {
  return (
    <Page title="制造业知识库与工艺问答方案" desc="从业务目标、数据准备、产品选型到 POC 验收的完整解决方案。">
      <TwoColumn
        main={<><DetailBlock title="方案架构" visuals /><DetailBlock title="推荐产品与公司" /><DetailBlock title="实施路径" /></>}
        side={<Panel title="适用企业" items={['文档分散', '制度查询频繁', '工艺知识依赖专家', '需要私有化部署']} />}
      />
    </Page>
  );
}

function PocWorkflow() {
  return (
    <Page title="POC流程页" desc="上传样例数据、定义验收指标、邀请供应商提交验证结果。">
      <StepFlow steps={['提交需求', '上传样例数据', '供应商确认', 'POC验证', '验收评分', '进入报价']} />
    </Page>
  );
}

function QuoteProposal() {
  return (
    <Page title="方案报价页" desc="供应商基于需求与 POC 结果提交范围、周期、价格和交付物。">
      <section className="form-card">
        <h2>报价方案</h2>
        <InfoRows rows={[['项目范围', '知识库问答系统、权限控制、答案溯源、OA集成'], ['实施周期', '6 周'], ['报价金额', '28 万'], ['交付物', '部署包、接口文档、验收报告、运维手册']]} />
      </section>
    </Page>
  );
}

function DemandDetail() {
  return (
    <Page title="需求详情" desc="需求方的结构化业务背景、数据情况、预算周期和方案沟通记录。">
      <TwoColumn
        main={<><DetailBlock title="业务背景" /><DetailBlock title="数据与系统现状" /><DetailBlock title="验收指标" /></>}
        side={<Panel title="需求摘要" items={['制造业', '预算 10-30万', '1个月内', '需要 POC', '匹配度 92%']} />}
      />
    </Page>
  );
}

function PublishProduct() {
  return (
    <Page title="发布产品" desc="供应商上传产品封面、能力标签、部署方式、报价方式、案例和资料附件。">
      <section className="form-card">
        <div className="upload-box"><Upload size={26} />上传产品封面、界面截图或演示视频封面</div>
        <div className="field-grid">
          {['产品名称', '公司名称', '能力标签', '部署方式', '价格模式', '适用行业'].map((label) => (
            <label key={label}><span>{label}</span><input placeholder={`请输入${label}`} /></label>
          ))}
        </div>
        <label className="wide-field"><span>产品摘要</span><textarea placeholder="说明产品定位、核心价值和服务边界" /></label>
      </section>
    </Page>
  );
}

function Dashboard({ type }) {
  const isBuyer = type === 'buyer';
  return (
    <Page title={isBuyer ? '需求方控制台' : '供应商后台'} desc={isBuyer ? '跟踪需求、匹配结果、POC进展和沟通记录。' : '管理产品、需求线索、报价方案和公司主页。'}>
      <MetricGrid items={isBuyer ? [['4', '已发布需求'], ['12', '推荐产品'], ['3', 'POC进行中'], ['8', '未读消息']] : [['9', '上架产品'], ['24', '需求线索'], ['6', '待报价'], ['2', 'POC进行中']]} />
      <div className="dashboard-grid">
        <Panel title="待办事项" items={['完善知识库需求验收指标', '确认启元AI POC样例数据', '查看星河智能科技报价', '回复站内咨询消息']} />
        <Panel title="最近进展" items={['匹配结果已更新', '供应商提交了 POC 计划', '新产品加入对比', '需求完整度提升至 86%']} />
        <Panel title="快捷入口" items={['发布需求', '产品对比', '消息中心', '方案报价']} />
      </div>
    </Page>
  );
}

function Compare() {
  return (
    <Page title="产品对比" desc="按能力、部署、安全、价格、案例和 POC 条件进行横向比较。">
      <div className="compare-table">
        <div />
        {products.slice(0, 3).map((p) => <strong key={p.name}>{p.name}</strong>)}
        {['公司', '评分', '部署', '价格', '核心能力', '适用场景'].map((row) => (
          <React.Fragment key={row}>
            <span>{row}</span>
            {products.slice(0, 3).map((p) => <p key={p.name + row}>{row === '公司' ? p.company : row === '评分' ? p.score : row === '部署' ? p.deploy : row === '价格' ? p.price : p.tags.join(' / ')}</p>)}
          </React.Fragment>
        ))}
      </div>
    </Page>
  );
}

function Messages() {
  return (
    <Page title="站内沟通页" desc="围绕需求、产品、POC 和报价的留痕式沟通中心。">
      <section className="messages">
        <aside>
          {['启元AI', '星河智能科技', '云脉AI销售团队'].map((name) => (
            <button key={name}><MessageSquareText size={18} />{name}<span>2</span></button>
          ))}
        </aside>
        <div className="chat">
          <h2>启元AI · 知识库 POC 沟通</h2>
          {['我们已查看你的需求，建议先用 200 份制度文档做 POC。', '可以，请确认需要哪些验收指标？', '建议包含准确率、溯源率、响应时间和权限隔离测试。'].map((msg, i) => (
            <p className={i === 1 ? 'mine' : ''} key={msg}>{msg}</p>
          ))}
          <div className="composer"><input placeholder="输入消息或上传需求附件" /><button><Send size={18} /></button></div>
        </div>
      </section>
    </Page>
  );
}

function Page({ title, desc, children }) {
  return (
    <div className="page-shell">
      {title && (
        <section className="page-title">
          <h1>{title}</h1>
          {desc && <p>{desc}</p>}
        </section>
      )}
      {children}
    </div>
  );
}

function SectionTitle({ title, desc }) {
  return (
    <div className="section-title">
      <h2>{title}</h2>
      {desc && <p>{desc}</p>}
    </div>
  );
}

function MetricGrid({ items }) {
  return <div className="metrics">{items.map(([num, label], index) => <article key={label} style={{ '--i': index }}><strong>{num}</strong><span>{label}</span></article>)}</div>;
}

function TagCloud({ tags }) {
  return <div className="tags">{tags.map((tag, index) => <span className={index % 2 ? 'violet' : ''} key={tag} style={{ '--i': index }}>{tag}</span>)}</div>;
}

function ProductCard({ product, compact, setPage, index = 0 }) {
  return (
    <article className={`product-card ${compact ? 'compact' : ''}`} style={{ '--i': index }}>
      <VisualShot variant={product.shot} accent={product.accent} label={product.name} />
      <div className="status-row"><span className="poc">可POC</span></div>
      <h3>{product.name}</h3>
      <p className="company">{product.company}</p>
      <p>{product.desc}</p>
      <TagCloud tags={product.tags} />
      <div className="card-meta">
        <span><Star size={14} />{product.score}</span>
        <span>{product.deploy}</span>
        <strong>{product.price}</strong>
      </div>
      <button onClick={() => setPage('detail')}>查看并联系</button>
    </article>
  );
}

function VisualShot({ variant, accent = 'blue', label }) {
  return (
    <div className={`visual-shot ${accent} ${variant}`}>
      <div className="shot-window">
        <span />
        <span />
        <span />
      </div>
      <div className="shot-lines">
        <i />
        <i />
        <i />
      </div>
      <div className="shot-chart">
        <b />
        <b />
        <b />
      </div>
      <em>{label || '产品图占位'}</em>
    </div>
  );
}

function FilterPanel({ title, groups }) {
  return (
    <aside className="filter-panel">
      <h2><Filter size={18} />{title}</h2>
      {groups.map((group) => (
        <div className="filter-group" key={group}>
          <button>{group}<ChevronDown size={16} /></button>
          <label><input type="checkbox" /> 不限</label>
          <label><input type="checkbox" /> 热门选项</label>
        </div>
      ))}
    </aside>
  );
}

function Toolbar({ count, action, onAction }) {
  return (
    <div className="toolbar">
      <strong>{count}</strong>
      <div>
        <button>综合排序</button>
        <button className="primary" onClick={onAction}>{action}</button>
      </div>
    </div>
  );
}

function DemandCard({ demand, setPage, index = 0 }) {
  return (
    <article className="demand-card" style={{ '--i': index }}>
      <div>
        <TagCloud tags={[demand[1], '待报价']} />
        <h3>{demand[0]}</h3>
        <p>预算：{demand[2]}   周期：{demand[3]}   需要POC：是</p>
      </div>
      <div className="match-score">
        <span>匹配度</span>
        <strong>{demand[4]}</strong>
        <button onClick={() => setPage('demandDetail')}>查看</button>
      </div>
    </article>
  );
}

function CompanyCard({ company, setPage, index = 0 }) {
  return (
    <article className="company-card" style={{ '--i': index }}>
      <div className="avatar">{company[0].slice(0, 2)}</div>
      <h3>{company[0]}</h3>
      <span className="cert"><CheckCircle2 size={14} />已认证</span>
      <p>{company[1]}</p>
      <TagCloud tags={company[2]} />
      <button onClick={() => setPage('companyProfile')}>查看主页</button>
      <button className="primary" onClick={() => setPage('messages')}>联系公司</button>
    </article>
  );
}

function InfoRows({ rows }) {
  return <div className="info-rows">{rows.map(([k, v]) => <p key={k}><span>{k}</span><strong>{v}</strong></p>)}</div>;
}

function Tabs({ tabs }) {
  return <div className="tabs">{tabs.map((tab, i) => <button className={i === 0 ? 'active' : ''} key={tab}>{tab}</button>)}</div>;
}

function DetailBlock({ title, visuals, actions }) {
  return (
    <section className="detail-block">
      <h2>{title}</h2>
      <p>企业可在这里上传完整内容：产品定位、适用客户、核心价值、使用流程、典型场景、服务边界、截图、视频、表格和案例链接。</p>
      {visuals && <div className="mini-visuals">{['文档解析流程图', '答案溯源截图', '权限管理界面'].map((item) => <div key={item}>{item}</div>)}</div>}
      {actions && <div className="inline-actions"><button><Upload size={16} />上传产品资料</button><button className="primary"><Send size={16} />发起需求对接</button></div>}
    </section>
  );
}

function Panel({ title, items }) {
  return <section className="panel"><h2>{title}</h2>{items.map((item) => <p key={item}>{item}</p>)}</section>;
}

function TwoColumn({ main, side }) {
  return <div className="two-column"><div>{main}</div><aside>{side}</aside></div>;
}

function StepFlow({ steps }) {
  return <div className="step-flow">{steps.map((step, i) => <article key={step} style={{ '--i': i }}><span>{String(i + 1).padStart(2, '0')}</span><h3>{step}</h3><p>平台记录节点状态、资料与沟通内容。</p></article>)}</div>;
}

createRoot(document.getElementById('root')).render(<App />);
