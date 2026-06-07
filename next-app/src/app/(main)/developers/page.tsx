'use client';

import { useState } from 'react';
import {
  Key,
  BookOpen,
  Zap,
  Shield,
  Code2,
  ArrowRight,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Search,
  Package,
  FileText,
  Users,
  Building2,
  ShoppingCart,
  Target,
  Send,
  Globe,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Code block with copy button
// ---------------------------------------------------------------------------

function CodeBlock({ code, language = 'bash', title }: { code: string; language?: string; title?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-line overflow-hidden bg-[#0d1117] my-4">
      {title && (
        <div className="flex items-center justify-between px-4 py-2 bg-[#161b22] border-b border-[#30363d]">
          <span className="text-xs text-gray-400 font-medium">{title}</span>
          <button
            onClick={handleCopy}
            className="flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? '已复制' : '复制'}
          </button>
        </div>
      )}
      <pre className="p-4 overflow-x-auto text-sm leading-relaxed">
        <code className={`language-${language} text-[#e6edf3]`}>{code}</code>
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Collapsible section
// ---------------------------------------------------------------------------

function Section({ id, title, icon: Icon, children, defaultOpen = false }: {
  id: string; title: string; icon: React.ElementType; children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div id={id} className="border border-line rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-6 py-4 hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <h3 className="text-base font-semibold text-foreground">{title}</h3>
        </div>
        {open ? <ChevronDown className="h-5 w-5 text-muted" /> : <ChevronRight className="h-5 w-5 text-muted" />}
      </button>
      {open && <div className="px-6 pb-6 pt-2 border-t border-line/60">{children}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tool reference card
// ---------------------------------------------------------------------------

const MCP_TOOLS = [
  {
    name: 'search',
    icon: Search,
    scope: 'read',
    risk: 'low',
    desc: '统一搜索产品、公司和解决方案',
    params: `{ "q": "知识库" }`,
    response: `{
  "products": [{ "id": "p1", "name": "...", "score": 10 }],
  "companies": [{ "id": "c1", "name": "...", "score": 8 }],
  "solutions": [{ "id": "s1", "title": "...", "score": 6 }]
}`,
  },
  {
    name: 'search_products',
    icon: Package,
    scope: 'read',
    risk: 'low',
    desc: '按关键词、行业或能力搜索 AI 产品',
    params: `{ "query": "RAG", "industry": "manufacturing", "limit": 10 }`,
    response: `{
  "results": [
    { "id": "p1", "name": "智问企业知识库", "company": "星河智能", ... }
  ]
}`,
  },
  {
    name: 'get_product_detail',
    icon: FileText,
    scope: 'read',
    risk: 'low',
    desc: '获取产品详细信息',
    params: `{ "productId": "p1" }`,
    response: `{
  "id": "p1", "name": "智问企业知识库",
  "description": "...", "pricingModel": "subscription",
  "deploymentModes": ["saas", "private_cloud"]
}`,
  },
  {
    name: 'search_agents',
    icon: Zap,
    scope: 'read',
    risk: 'low',
    desc: '按能力搜索 AI Agent',
    params: `{ "capability": "代码审查" }`,
    response: `{
  "results": [{ "id": "a1", "name": "代码审查Agent", ... }]
}`,
  },
  {
    name: 'search_companies',
    icon: Building2,
    scope: 'read',
    risk: 'low',
    desc: '搜索 AI 公司和 OPC 团队',
    params: `{ "keyword": "制造" }`,
    response: `{
  "results": [{ "id": "c1", "name": "星河智能科技", ... }]
}`,
  },
  {
    name: 'search_solutions',
    icon: Globe,
    scope: 'read',
    risk: 'low',
    desc: '按行业或场景搜索解决方案',
    params: `{ "industry": "manufacturing" }`,
    response: `{
  "results": [{ "id": "s1", "title": "制造业智能质检方案", ... }]
}`,
  },
  {
    name: 'list_demands',
    icon: ShoppingCart,
    scope: 'read',
    risk: 'low',
    desc: '列出需求（支持筛选）',
    params: `{ "status": "collecting_proposals", "industry": "manufacturing" }`,
    response: `{
  "results": [{ "id": "d1", "title": "...", "budgetRange": "10-30万" }]
}`,
  },
  {
    name: 'get_demand_detail',
    icon: FileText,
    scope: 'read',
    risk: 'low',
    desc: '获取需求详情',
    params: `{ "demandId": "d1" }`,
    response: `{ "id": "d1", "title": "...", "description": "...", "status": "..." }`,
  },
  {
    name: 'create_demand_draft',
    icon: ShoppingCart,
    scope: 'write:demand',
    risk: 'medium',
    desc: '创建需求草稿（需要 write:demand 权限）',
    params: `{
  "title": "需要知识库问答系统",
  "industry": "制造业",
  "budgetRange": "10-30万",
  "description": "面向企业内部文档..."
}`,
    response: `{ "id": "d_new", "title": "...", "status": "draft" }`,
  },
  {
    name: 'match_demand',
    icon: Target,
    scope: 'read',
    risk: 'low',
    desc: '为需求匹配产品、Agent 和公司',
    params: `{ "demandId": "d1" }`,
    response: `{
  "products": [{ "product": {...}, "score": 85, "reason": "行业+能力匹配" }],
  "agents": [...],
  "riskWarnings": ["建议先进行POC验证"]
}`,
  },
  {
    name: 'submit_proposal',
    icon: Send,
    scope: 'write:proposal',
    risk: 'medium',
    desc: '向需求提交提案（需要 write:proposal 权限）',
    params: `{
  "demandId": "d1",
  "title": "知识库解决方案",
  "scope": "基于RAG架构...",
  "price": 150000,
  "deliveryPeriod": "4周"
}`,
    response: `{ "id": "prop_1", "status": "submitted" }`,
  },
];

function ToolCard({ tool }: { tool: typeof MCP_TOOLS[0] }) {
  const Icon = tool.icon;
  const riskColors: Record<string, string> = {
    low: 'bg-green-100 text-green-700',
    medium: 'bg-yellow-100 text-yellow-700',
    high: 'bg-red-100 text-red-700',
  };
  const scopeColors: Record<string, string> = {
    read: 'bg-blue-100 text-blue-700',
    'write:demand': 'bg-purple-100 text-purple-700',
    'write:proposal': 'bg-orange-100 text-orange-700',
  };

  return (
    <div className="rounded-xl border border-line p-5 hover:shadow-[0_8px_30px_rgba(15,23,42,0.08)] transition-all duration-200">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-foreground font-mono">{tool.name}</h4>
            <p className="text-xs text-muted mt-0.5">{tool.desc}</p>
          </div>
        </div>
      </div>
      <div className="flex gap-2 mb-4">
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${riskColors[tool.risk]}`}>
          风险: {tool.risk === 'low' ? '低' : tool.risk === 'medium' ? '中' : '高'}
        </span>
        <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-semibold ${scopeColors[tool.scope] || 'bg-gray-100 text-gray-700'}`}>
          {tool.scope}
        </span>
      </div>
      <div className="space-y-2">
        <div>
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">请求参数</p>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-x-auto text-foreground/80 leading-relaxed">{tool.params}</pre>
        </div>
        <div>
          <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-1">响应示例</p>
          <pre className="text-xs bg-gray-50 rounded-lg p-3 overflow-x-auto text-foreground/80 leading-relaxed max-h-40">{tool.response}</pre>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar nav
// ---------------------------------------------------------------------------

const NAV = [
  { id: 'quickstart', label: '快速开始', icon: Zap },
  { id: 'auth', label: '认证方式', icon: Key },
  { id: 'mcp', label: 'MCP 工具', icon: Code2 },
  { id: 'a2a', label: 'A2A 协议', icon: Users },
  { id: 'errors', label: '错误码', icon: Shield },
  { id: 'limits', label: '速率限制', icon: BookOpen },
];

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function DevelopersPage() {
  return (
    <div className="min-h-screen bg-background">
      {/* Hero */}
      <div className="relative overflow-hidden bg-gradient-to-br from-[#0f172a] via-[#1e293b] to-[#0f172a] text-white">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmYiIGZpbGwtb3BhY2l0eT0iMC4wMyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-50" />
        <div className="relative mx-auto max-w-6xl px-6 py-16 md:py-24">
          <div className="flex items-center gap-2 text-sm text-blue-300 mb-4">
            <Code2 className="h-4 w-4" />
            <span>Developer API</span>
          </div>
          <h1 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-4">
            iWantU 开发者文档
          </h1>
          <p className="text-lg md:text-xl text-gray-300 max-w-2xl leading-relaxed">
            通过 MCP 协议和 A2A 标准接入 iWantU AI 能力市场。搜索产品、创建需求、匹配方案、提交提案。
          </p>
          <div className="flex flex-wrap gap-3 mt-8">
            <a
              href="#quickstart"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 font-bold text-sm text-white hover:-translate-y-0.5 hover:shadow-[0_14px_32px_rgba(21,94,239,0.3)] transition-all duration-200"
            >
              快速开始
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href="#mcp"
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-6 py-3 font-bold text-sm text-white hover:bg-white/10 transition-all duration-200"
            >
              API 参考
            </a>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-12">
            {[
              { label: 'MCP 工具', value: '11' },
              { label: 'A2A 动作', value: '4' },
              { label: '搜索领域', value: '5+' },
              { label: '接入协议', value: '2' },
            ].map((s) => (
              <div key={s.label} className="rounded-xl bg-white/5 border border-white/10 p-4 text-center">
                <div className="text-2xl font-extrabold">{s.value}</div>
                <div className="text-xs text-gray-400 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar */}
          <nav className="hidden lg:block lg:col-span-1">
            <div className="sticky top-24 space-y-1">
              <p className="text-xs font-bold text-muted uppercase tracking-wider mb-3">目录</p>
              {NAV.map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.id}
                    href={`#${item.id}`}
                    className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-muted hover:text-primary hover:bg-primary/5 transition-colors"
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </a>
                );
              })}
            </div>
          </nav>

          {/* Main content */}
          <div className="lg:col-span-3 space-y-6">
            {/* Quick Start */}
            <Section id="quickstart" title="快速开始" icon={Zap} defaultOpen>
              <p className="text-sm text-muted leading-relaxed mb-4">
                3 步接入 iWantU AI 能力市场：
              </p>
              <div className="space-y-4">
                <div className="flex items-start gap-4 rounded-xl bg-blue-50/50 border border-blue-100 p-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white text-sm font-bold">1</div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">获取 API Key</p>
                    <p className="text-xs text-muted mt-1">登录 iWantU 平台，进入「API 密钥」页面创建密钥</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 rounded-xl bg-blue-50/50 border border-blue-100 p-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white text-sm font-bold">2</div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">调用 MCP 端点</p>
                    <p className="text-xs text-muted mt-1">向 <code className="text-primary bg-primary/5 px-1.5 py-0.5 rounded text-xs">POST /api/mcp</code> 发送工具调用请求</p>
                  </div>
                </div>
                <div className="flex items-start gap-4 rounded-xl bg-blue-50/50 border border-blue-100 p-4">
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-white text-sm font-bold">3</div>
                  <div>
                    <p className="text-sm font-semibold text-foreground">处理返回结果</p>
                    <p className="text-xs text-muted mt-1">JSON 格式响应，包含工具执行结果</p>
                  </div>
                </div>
              </div>

              <p className="text-sm font-semibold text-foreground mt-6 mb-2">示例：搜索 AI 产品</p>
              <CodeBlock
                title="cURL"
                code={`curl -X POST https://iwantu.ai/api/mcp \\
  -H "Authorization: Bearer iwantu_your_api_key" \\
  -H "Content-Type: application/json" \\
  -d '{
    "tool": "search_products",
    "params": { "query": "知识库", "limit": 5 }
  }'`}
              />
              <CodeBlock
                title="Python"
                language="python"
                code={`import requests

resp = requests.post("https://iwantu.ai/api/mcp",
    headers={
        "Authorization": "Bearer iwantu_your_api_key",
        "Content-Type": "application/json"
    },
    json={
        "tool": "search_products",
        "params": {"query": "知识库", "limit": 5}
    }
)
print(resp.json())`}
              />
              <CodeBlock
                title="Node.js"
                language="javascript"
                code={`const resp = await fetch('https://iwantu.ai/api/mcp', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer iwantu_your_api_key',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    tool: 'search_products',
    params: { query: '知识库', limit: 5 }
  })
});
const data = await resp.json();
console.log(data);`}
              />
            </Section>

            {/* Authentication */}
            <Section id="auth" title="认证方式" icon={Key}>
              <p className="text-sm text-muted leading-relaxed mb-4">
                iWantU API 使用 <strong className="text-foreground">Bearer Token</strong> 认证。在请求头中携带 API Key：
              </p>
              <CodeBlock
                title="请求头"
                code={`Authorization: Bearer iwantu_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`}
              />

              <div className="mt-6 space-y-4">
                <h4 className="text-sm font-bold text-foreground">API Key 格式</h4>
                <div className="rounded-lg bg-gray-50 p-4 text-sm">
                  <code className="text-primary">iwantu_</code>
                  <span className="text-muted"> + 64 位十六进制字符串</span>
                </div>

                <h4 className="text-sm font-bold text-foreground mt-4">权限范围（Scopes）</h4>
                <div className="overflow-hidden rounded-lg border border-line">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50">
                        <th className="px-4 py-2 text-left font-semibold text-foreground">Scope</th>
                        <th className="px-4 py-2 text-left font-semibold text-foreground">说明</th>
                        <th className="px-4 py-2 text-left font-semibold text-foreground">可访问工具</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      <tr>
                        <td className="px-4 py-2.5"><code className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">read</code></td>
                        <td className="px-4 py-2.5 text-muted">只读权限</td>
                        <td className="px-4 py-2.5 text-muted">所有搜索和查询工具</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5"><code className="text-xs bg-purple-50 text-purple-700 px-1.5 py-0.5 rounded">write:demand</code></td>
                        <td className="px-4 py-2.5 text-muted">创建需求</td>
                        <td className="px-4 py-2.5 text-muted">create_demand_draft</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5"><code className="text-xs bg-orange-50 text-orange-700 px-1.5 py-0.5 rounded">write:proposal</code></td>
                        <td className="px-4 py-2.5 text-muted">提交提案</td>
                        <td className="px-4 py-2.5 text-muted">submit_proposal</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5"><code className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded">write:*</code></td>
                        <td className="px-4 py-2.5 text-muted">所有写入权限</td>
                        <td className="px-4 py-2.5 text-muted">全部写操作工具</td>
                      </tr>
                      <tr>
                        <td className="px-4 py-2.5"><code className="text-xs bg-red-50 text-red-700 px-1.5 py-0.5 rounded">admin</code></td>
                        <td className="px-4 py-2.5 text-muted">管理员权限</td>
                        <td className="px-4 py-2.5 text-muted">所有工具</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </Section>

            {/* MCP Tools */}
            <Section id="mcp" title="MCP 工具参考" icon={Code2}>
              <p className="text-sm text-muted leading-relaxed mb-2">
                iWantU 实现 <strong className="text-foreground">MCP (Model Context Protocol)</strong> 协议，提供 11 个工具供 AI Agent 调用。
                通过 <code className="text-primary bg-primary/5 px-1.5 py-0.5 rounded text-xs">POST /api/mcp</code> 端点访问。
              </p>

              <div className="mt-2 mb-4">
                <h4 className="text-sm font-bold text-foreground mb-2">请求格式</h4>
                <CodeBlock
                  title="POST /api/mcp"
                  code={`{
  "tool": "tool_name",
  "params": { ... }
}`}
                />
              </div>

              <div className="mb-4">
                <h4 className="text-sm font-bold text-foreground mb-2">工具发现</h4>
                <CodeBlock
                  title="GET /api/mcp — 获取可用工具列表"
                  code={`curl https://iwantu.ai/api/mcp \\
  -H "Authorization: Bearer iwantu_your_key"`}
                />
              </div>

              <h4 className="text-sm font-bold text-foreground mb-4">全部工具</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {MCP_TOOLS.map((tool) => (
                  <ToolCard key={tool.name} tool={tool} />
                ))}
              </div>
            </Section>

            {/* A2A */}
            <Section id="a2a" title="A2A 协议" icon={Users}>
              <p className="text-sm text-muted leading-relaxed mb-4">
                iWantU 支持 <strong className="text-foreground">Agent-to-Agent (A2A)</strong> 协议，允许 AI Agent 之间进行互操作。
                Agent Card 描述了平台能力和操作风险等级。
              </p>

              <h4 className="text-sm font-bold text-foreground mb-2">Agent Card</h4>
              <CodeBlock
                title="GET /.well-known/agent-card.json"
                code={`{
  "name": "iWantU Marketplace Agent",
  "description": "AI能力撮合平台 Agent",
  "url": "https://iwantu.ai/a2a",
  "capabilities": [
    "product_discovery", "agent_discovery",
    "company_discovery", "solution_matching",
    "demand_drafting", "poc_coordination"
  ],
  "actions": [
    { "name": "searchProducts", "risk": "low" },
    { "name": "createDemandDraft", "risk": "medium" },
    { "name": "submitProposalDraft", "risk": "medium" },
    { "name": "confirmContract", "risk": "high" }
  ]
}`}
              />

              <h4 className="text-sm font-bold text-foreground mt-4 mb-2">MCP 工具清单</h4>
              <CodeBlock
                title="GET /.well-known/mcp.json"
                code={`{
  "name": "iWantU Marketplace MCP",
  "version": "0.1.0",
  "tools": [
    "search_products", "get_product_detail",
    "search_agents", "search_companies",
    "search_solutions", "create_demand_draft",
    "match_demand"
  ],
  "resources": [
    "iwantu://products", "iwantu://agents",
    "iwantu://companies", "iwantu://solutions"
  ]
}`}
              />
            </Section>

            {/* Errors */}
            <Section id="errors" title="错误码" icon={Shield}>
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2.5 text-left font-semibold text-foreground">HTTP 状态码</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-foreground">错误码</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-foreground">说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {[
                      [200, '—', '成功'],
                      [201, '—', '创建成功'],
                      [400, 'validation_error', '请求参数验证失败'],
                      [401, 'unauthorized', '未提供有效的 API Key'],
                      [403, 'forbidden', '权限不足，缺少所需 scope'],
                      [404, 'not_found', '请求的资源不存在'],
                      [409, 'conflict', '资源冲突（如重复创建）'],
                      [429, 'rate_limited', '请求频率超限'],
                      [500, 'internal_error', '服务器内部错误'],
                    ].map(([status, code, desc]) => (
                      <tr key={status} className="hover:bg-gray-50/50">
                        <td className="px-4 py-2.5"><code className="text-xs font-mono">{status}</code></td>
                        <td className="px-4 py-2.5"><code className="text-xs text-primary">{code}</code></td>
                        <td className="px-4 py-2.5 text-muted">{desc}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <h4 className="text-sm font-bold text-foreground mt-4 mb-2">错误响应格式</h4>
              <CodeBlock
                title="Error Response"
                code={`{
  "error": "权限不足",
  "details": { "requiredScope": "write:demand", "grantedScopes": ["read"] }
}`}
              />
            </Section>

            {/* Rate Limits */}
            <Section id="limits" title="速率限制" icon={BookOpen}>
              <p className="text-sm text-muted leading-relaxed mb-4">
                为保障平台稳定性，API 请求有以下频率限制：
              </p>
              <div className="overflow-hidden rounded-lg border border-line">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2.5 text-left font-semibold text-foreground">端点类型</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-foreground">限制</th>
                      <th className="px-4 py-2.5 text-left font-semibold text-foreground">说明</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    <tr>
                      <td className="px-4 py-2.5 font-medium">通用 API</td>
                      <td className="px-4 py-2.5"><code className="text-xs">100 次/分钟</code></td>
                      <td className="px-4 py-2.5 text-muted">需求、产品、组织等</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium">MCP 工具</td>
                      <td className="px-4 py-2.5"><code className="text-xs">60 次/分钟</code></td>
                      <td className="px-4 py-2.5 text-muted">AI Agent 工具调用</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium">认证端点</td>
                      <td className="px-4 py-2.5"><code className="text-xs">10 次/分钟</code></td>
                      <td className="px-4 py-2.5 text-muted">登录、注册</td>
                    </tr>
                    <tr>
                      <td className="px-4 py-2.5 font-medium">文件上传</td>
                      <td className="px-4 py-2.5"><code className="text-xs">20 次/分钟</code></td>
                      <td className="px-4 py-2.5 text-muted">单文件 ≤ 50MB</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <p className="text-sm text-muted mt-4">
                超限时返回 <code className="text-xs bg-red-50 text-red-600 px-1.5 py-0.5 rounded">429</code> 状态码，
                响应头包含 <code className="text-xs bg-gray-50 px-1.5 py-0.5 rounded">Retry-After</code> 字段告知重试时间。
              </p>
            </Section>
          </div>
        </div>
      </div>
    </div>
  );
}
