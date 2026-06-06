# iWantU 技术方案与技术路线设计文档 v1.0

## 1. 技术总体目标

iWantU 需要建设为一个 AI-native marketplace，既支持人类用户在网页上完成 AI 产品、Agent、公司、解决方案、需求、POC、报价与沟通流程，也支持外部 AI Agent 以机器可读方式浏览、理解、提需、接单、提交方案和参与POC。

系统设计目标：

```text
人可用
AI可读
AI可操作
权限可控
行为可审计
交易可追踪
POC可验证
平台可扩展
```

## 2. 总体架构

```text
访问层：Web浏览器 / 移动端 / 外部AI / MCP客户端 / A2A Agent
        ↓
网关层：API Gateway / Auth Gateway / Agent Gateway
        ↓
应用服务层：用户组织 / 产品 / Agent / 公司 / 需求 / 方案 / POC / 报价 / 消息 / 搜索 / 推荐 / 权限 / 审计
        ↓
AI能力层：需求澄清Agent / 匹配Agent / 报价Agent / POC评测Agent / 风控Agent / 内容生成Agent
        ↓
数据层：PostgreSQL / Redis / Object Storage / Vector DB / Search Engine / Audit Log Store
```

## 3. 推荐技术栈

### 3.1 前端

- Next.js
- React
- TypeScript
- Tailwind CSS
- shadcn/ui 或自建组件库
- TanStack Query
- Zustand / Jotai

### 3.2 后端

- NestJS 或 FastAPI
- PostgreSQL
- Redis
- OpenSearch / Meilisearch
- MinIO / S3
- Prisma / SQLAlchemy

### 3.3 AI服务

- Python FastAPI Agent Service
- LangGraph / 自研Agent Runtime
- LiteLLM / OpenAI-compatible Gateway
- Qdrant / Milvus / pgvector
- Unstructured / MinerU / 自研文档解析服务

### 3.4 Agent协议

- MCP Server：给外部AI调用平台工具
- A2A Endpoint：给外部Agent发现平台能力与协作
- OpenAPI：给传统系统集成
- Webhook：事件推送
- JSON-LD：页面机器可读
- Markdown Mirror：页面Markdown版本
- llms.txt：站点级AI导航

### 3.5 基础设施

- Docker
- Kubernetes 或 Docker Compose
- Nginx / Traefik
- GitHub Actions / GitLab CI
- Prometheus
- Grafana
- Sentry
- OpenTelemetry

## 4. 核心系统模块

### 4.1 用户与组织系统

功能：注册登录、组织管理、成员邀请、角色管理、企业认证、AI身份绑定、API Key、OAuth授权。

核心表：

```text
users
organizations
organization_members
roles
permissions
ai_identities
api_keys
oauth_clients
```

### 4.2 内容与市场系统

管理对象：AI产品、AI Agent、AI公司/OPC团队、解决方案、案例、附件、评价、精选推荐、榜单。

核心表：

```text
products
agent_products
company_profiles
solutions
case_studies
attachments
reviews
featured_items
categories
tags
```

### 4.3 需求系统

功能：发布需求、AI需求澄清、需求状态流转、匿名需求、需求附件、需求匹配、需求授权。

核心表：

```text
demands
demand_fields
demand_attachments
demand_visibility_rules
demand_match_results
demand_status_logs
```

### 4.4 匹配推荐系统

功能：产品匹配、Agent匹配、公司匹配、方案匹配、匹配理由、风险提示、置信度。

推荐公式示例：

```text
match_score =
  0.25 * semantic_score
+ 0.20 * tag_score
+ 0.15 * industry_score
+ 0.15 * deployment_score
+ 0.10 * budget_score
+ 0.10 * case_score
+ 0.05 * platform_trust_score
```

### 4.5 POC系统

功能：创建POC、参与方管理、样例数据上传、测试集、供应商测试、结果评审、POC报告、状态流转。

核心表：

```text
poc_projects
poc_participants
poc_datasets
poc_test_cases
poc_test_results
poc_reports
poc_tasks
```

### 4.6 方案与报价系统

功能：提交方案、报价明细、交付里程碑、验收指标、附件、AI审查、PDF导出、版本管理。

核心表：

```text
proposals
proposal_versions
quote_items
milestones
acceptance_criteria
proposal_reviews
```

### 4.7 消息与协同系统

功能：站内消息、上下文会话、关联需求、关联POC、关联方案、附件共享、AI回复建议、待办提取。

核心表：

```text
message_threads
messages
message_attachments
thread_contexts
ai_reply_suggestions
todos
```

## 5. AI可读网站设计

### 5.1 三种页面格式

每个核心对象页面需要输出：

```text
HTML：/products/{id}
Markdown：/products/{id}.md
JSON：/api/public/products/{id}
```

### 5.2 llms.txt

根目录：

```text
/llms.txt
```

建议内容：

```text
# iWantU

> AI capability marketplace for humans and autonomous AI agents.

## Core Pages
- Home: https://iwantu.ai/
- AI Products: https://iwantu.ai/products.md
- AI Agents: https://iwantu.ai/agents.md
- AI Companies: https://iwantu.ai/companies.md
- Solutions: https://iwantu.ai/solutions.md
- Demand Hall: https://iwantu.ai/demands.md

## Public APIs
- Products API: https://iwantu.ai/api/public/products
- Agents API: https://iwantu.ai/api/public/agents
- Solutions API: https://iwantu.ai/api/public/solutions

## Agent Access
- MCP Manifest: https://iwantu.ai/.well-known/mcp.json
- A2A Agent Card: https://iwantu.ai/.well-known/agent-card.json

## Policies
- AI Access Policy: https://iwantu.ai/policies/ai-access.md
- Autonomous Action Policy: https://iwantu.ai/policies/agent-actions.md
```

### 5.3 JSON-LD

产品详情页输出 Product / Offer / Organization / potentialAction 等结构化数据。

示例：

```json
{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "智问企业知识库",
  "description": "面向企业内部文档的私有化知识库问答系统",
  "brand": {
    "@type": "Organization",
    "name": "星河智能科技"
  },
  "category": "AI Knowledge Base",
  "offers": {
    "@type": "Offer",
    "priceCurrency": "CNY",
    "price": "按项目报价",
    "availability": "https://schema.org/InStock"
  },
  "potentialAction": [
    {"@type": "AskAction", "name": "联系供应商"},
    {"@type": "AssessAction", "name": "申请POC"}
  ]
}
```

## 6. Agent Gateway设计

### 6.1 外部AI访问方式

- 公开网页抓取
- Markdown页面读取
- OpenAPI调用
- MCP / A2A协议接入

### 6.2 Agent身份模型

```text
AIIdentity {
  id
  name
  provider
  agent_type
  owner_user_id
  owner_org_id
  auth_method
  permission_policy_id
  trust_level
  status
}
```

### 6.3 Agent访问令牌

令牌类型：

- Public Read Token
- User Delegated Token
- Organization Delegated Token
- Supplier Agent Token
- Platform Internal Agent Token

Token必须包含：

```text
agent_id
delegator_user_id
organization_id
scope
budget_limit
allowed_actions
expires_at
risk_level
```

## 7. AI权限控制方案

### 7.1 权限判断链路

```text
AI请求动作
    ↓
识别AI身份
    ↓
识别代理对象：代表谁
    ↓
识别动作类型
    ↓
识别目标对象
    ↓
检查RBAC
    ↓
检查ABAC
    ↓
检查AI授权策略
    ↓
检查风险等级
    ↓
执行 / 要求人工确认 / 拒绝
    ↓
写入审计日志
```

### 7.2 AI动作分类

| 动作 | 风险 | 默认策略 |
|---|---|---|
| 读取公开产品 | 低 | 允许 |
| 读取公开公司 | 低 | 允许 |
| 生成需求草稿 | 低 | 授权后允许 |
| 生成方案草稿 | 低 | 授权后允许 |
| 提交需求 | 中 | 需确认 |
| 提交方案 | 中 | 需确认或白名单 |
| 自动接单 | 高 | 明确授权 |
| 读取附件 | 高 | 对象授权 |
| 提交报价 | 高 | 管理员授权 |
| 确认成交 | 极高 | 禁止AI自动执行 |

### 7.3 策略示例

```json
{
  "policy_name": "供应商AI半自动接单策略",
  "agent_id": "agent_supplier_001",
  "allowed_actions": [
    "read_demand",
    "generate_proposal_draft",
    "send_inquiry_message"
  ],
  "forbidden_actions": [
    "submit_quote",
    "confirm_contract",
    "access_sensitive_attachment"
  ],
  "constraints": {
    "max_budget": 300000,
    "min_match_score": 0.85,
    "industries": ["制造业", "科研机构"],
    "requires_human_approval": true
  }
}
```

## 8. MCP服务设计

### 8.1 MCP工具清单

```text
search_products
get_product_detail
search_agents
get_agent_detail
search_companies
get_company_profile
search_solutions
get_solution_detail
create_demand_draft
submit_demand_for_review
match_demand
create_proposal_draft
get_poc_status
generate_poc_report
send_message_draft
```

### 8.2 MCP资源清单

```text
iwantu://products/{id}
iwantu://agents/{id}
iwantu://companies/{id}
iwantu://solutions/{id}
iwantu://demands/{id}
iwantu://poc/{id}
iwantu://proposals/{id}
```

### 8.3 MCP安全策略

- 只暴露白名单工具
- 所有写操作默认草稿化
- 高风险动作要求 confirm token
- 敏感资源需要对象级授权
- 工具调用全量审计
- 限制频率和并发
- 对输入做 prompt injection 扫描

## 9. A2A Agent Card设计

平台公开 Agent Card：

```json
{
  "name": "iWantU Marketplace Agent",
  "description": "AI capability marketplace agent for product discovery, demand creation, solution matching and POC coordination.",
  "url": "https://iwantu.ai/a2a",
  "capabilities": [
    "product_discovery",
    "agent_discovery",
    "company_discovery",
    "solution_matching",
    "demand_drafting",
    "poc_coordination"
  ],
  "authentication": {"type": "oauth2"},
  "actions": [
    {"name": "searchProducts", "risk": "low"},
    {"name": "createDemandDraft", "risk": "medium"},
    {"name": "submitProposalDraft", "risk": "medium"}
  ]
}
```

供应商也可以注册自己的 Agent Card：

```text
供应商Agent名称
能力描述
可接需求类型
输入要求
输出内容
授权方式
回调地址
风险等级
平台认证状态
```

## 10. 数据库设计概要

核心表：

```sql
users
organizations
organization_members
ai_identities
permission_policies
products
agent_products
company_profiles
solutions
demands
demand_match_results
poc_projects
proposals
quote_items
message_threads
messages
audit_logs
agent_actions
attachments
reviews
```

products关键字段：

```text
id
org_id
name
summary
description
cover_image
gallery
category
industry_tags
capability_tags
deployment_modes
pricing_model
support_poc
support_private_deployment
ai_readable_enabled
ai_action_enabled
status
```

demands关键字段：

```text
id
owner_user_id
owner_org_id
title
industry
budget_min
budget_max
delivery_period
data_types
deployment_requirement
description
visibility_level
allow_ai_supplier
allow_ai_auto_bid
status
```

agent_actions关键字段：

```text
id
agent_id
delegator_user_id
organization_id
action_type
target_type
target_id
input_payload
output_payload
risk_level
decision
approval_status
created_at
```

## 11. API设计概要

公开API：

```text
GET /api/public/products
GET /api/public/products/{id}
GET /api/public/agents
GET /api/public/agents/{id}
GET /api/public/companies
GET /api/public/solutions
GET /api/public/solutions/{id}
```

用户API：

```text
POST /api/demands
GET /api/my/demands
POST /api/demands/{id}/publish
POST /api/demands/{id}/match
POST /api/products/{id}/compare
POST /api/products/{id}/contact
POST /api/products/{id}/apply-poc
```

供应商API：

```text
POST /api/supplier/products
GET /api/supplier/leads
POST /api/supplier/proposals
POST /api/supplier/quotes
GET /api/supplier/poc-projects
```

Agent API：

```text
GET /api/agent/context
POST /api/agent/demand-draft
POST /api/agent/proposal-draft
POST /api/agent/match
POST /api/agent/action-request
POST /api/agent/action-confirm
GET /api/agent/audit-logs
```

## 12. 搜索与推荐方案

### 12.1 搜索

采用混合搜索：

- 关键词搜索：OpenSearch / Meilisearch
- 语义搜索：Embedding + Vector DB
- 结构化过滤：PostgreSQL

### 12.2 推荐输入

```text
需求文本
行业
预算
部署方式
数据类型
周期
风险要求
组织偏好
历史行为
```

### 12.3 推荐输出

```text
产品推荐
Agent推荐
公司推荐
解决方案推荐
匹配分
推荐理由
风险提示
下一步建议
```

## 13. AI安全与风控

### 13.1 Prompt Injection防护

- HTML清洗
- Markdown清洗
- 附件内容隔离
- 工具调用白名单
- 上下文分区
- 系统提示与用户内容隔离
- 外部内容标记 untrusted

### 13.2 敏感数据保护

- 附件加密存储
- 对象级权限
- 下载水印
- 访问日志
- 临时URL
- 数据脱敏
- POC数据沙箱

### 13.3 AI行为风控

- 频率限制
- 预算限制
- 动作限制
- 行业限制
- 异常检测
- 人工确认
- 黑名单Agent
- 信用评分

## 14. 技术路线

### 阶段一：MVP人类平台，4-6周

目标：完成基础供需平台。

交付：Web前台、用户系统、产品系统、需求系统、供应商后台、需求方控制台、消息系统。

### 阶段二：AI可读化，3-4周

目标：让外部AI稳定理解平台内容。

交付：JSON-LD、Markdown Mirror、llms.txt、公开API、AI访问日志、结构化产品/需求数据。

### 阶段三：AI草稿代理，4-6周

目标：AI可以生成草稿，但不能直接高风险执行。

交付：需求草稿Agent、方案草稿Agent、报价草稿Agent、POC报告Agent、用户确认流程、AI行为日志。

### 阶段四：Agent Gateway，6-8周

目标：支持外部AI通过标准接口访问平台。

交付：MCP Server、A2A Agent Card、Agent身份认证、Agent权限策略、Agent审计中心、Action Confirmation机制。

### 阶段五：AI自主接单与POC自动化，8-12周

目标：在强权限控制下实现AI自主提需、接单、报价草稿、POC协同。

交付：AI自主接单设置、预算/行业/风险边界、POC自动评测、多供应商对比、自动采购建议、异常风控。

## 15. 开发里程碑

### M1：基础平台

首页、产品列表、产品详情、发布需求、需求大厅、登录注册、后台基础。

### M2：供需闭环

需求详情、发布产品、供应商后台、需求方控制台、站内沟通、产品对比。

### M3：方案与POC

解决方案专区、解决方案详情、POC流程、报价方案、POC报告。

### M4：AI可读

Markdown页面、JSON-LD、llms.txt、公开API、AI访问日志。

### M5：AI代理

AI需求草稿、AI方案草稿、AI报价草稿、AI权限中心、AI行为审计。

### M6：AI自主协作

MCP Server、A2A Agent Card、AI自主接单、AI自主提需、AI参与POC、AI风控中心。

## 16. 最小可行架构建议

初版建议先做：

```text
Next.js Web
PostgreSQL
Redis
S3/MinIO
OpenSearch 或 Meilisearch
FastAPI AI Service
LLM Gateway
Markdown/JSON-LD生成器
基础Agent API
```

后续增强：

```text
MCP
A2A
复杂Agent协作
自动接单
多方POC评测
智能报价
信用体系
```

## 17. 推荐开发顺序

```text
1. 搭建Next.js前台与基础组件
2. 搭建用户、组织、权限系统
3. 完成产品、需求、公司、方案四大内容模型
4. 完成发布需求和发布产品
5. 完成需求大厅和产品详情
6. 完成站内沟通
7. 完成供应商后台和需求方控制台
8. 增加Markdown页面、JSON-LD、llms.txt
9. 增加AI需求澄清和匹配推荐
10. 增加POC流程和报价方案
11. 增加Agent权限中心
12. 增加MCP/A2A外部AI接入
```
