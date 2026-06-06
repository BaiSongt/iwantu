# iWantU — AI 能力供需撮合平台

> 连接 AI 需求方与 AI 能力方，帮助企业发布需求、匹配产品、筛选公司、启动 POC 与采购沟通。

---

## 项目概述

iWantU 是面向人类用户与外部 AI Agent 的 AI 能力供需撮合、方案采购、POC 验证与交付协同平台。

平台同时支持两种模式：

- **传统人类模式**：企业/个人发布需求，AI公司、OPC团队、开发者发布产品、Agent、解决方案，双方通过平台完成联系、报价、POC与采购沟通。
- **AI自主模式**：外部 AI 以机器可读方式浏览平台内容，并在授权范围内代表用户发布需求、生成需求草稿、代表供应商接单、生成方案、参与POC沟通。

核心闭环：

```
发现AI能力 → 发布需求 → AI澄清 → 智能匹配 → 申请POC → 提交方案/报价 → 沟通确认 → 采购/交付
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端** | Next.js 16 (App Router) + React 19 + TypeScript + Tailwind CSS v4 |
| **后端** | Next.js API Routes (Route Handlers) |
| **数据库** | PostgreSQL + Prisma ORM v6 |
| **认证** | JWT (jose) + bcryptjs |
| **AI协议** | MCP Server / A2A Agent Card / JSON-LD / Markdown Mirror / llms.txt |
| **状态管理** | Zustand (已安装) |
| **图标** | Lucide React |
| **基础设施** | Docker + Nginx (规划中) |

---

## 项目结构

```
iwantu/
├── frontend/                    # 旧版 Vite + React 原型（已废弃）
├── next-app/                    # 主项目（Next.js 16）
│   ├── prisma/
│   │   ├── schema.prisma        # 数据库 Schema（21 个模型，15 个枚举）
│   │   └── seed.ts              # 种子数据
│   ├── public/
│   │   ├── llms.txt             # AI 可读入口文件
│   │   └── .well-known/
│   │       ├── mcp.json         # MCP Server Manifest
│   │       └── agent-card.json  # A2A Agent Card
│   ├── src/
│   │   ├── app/
│   │   │   ├── (main)/          # 主站页面（23 个路由）
│   │   │   │   ├── page.tsx     # 首页
│   │   │   │   ├── products/    # 产品列表/详情/发布
│   │   │   │   ├── demands/     # 需求大厅/详情/发布
│   │   │   │   ├── agents/      # Agent 列表/详情
│   │   │   │   ├── companies/   # 公司列表/主页
│   │   │   │   ├── solutions/   # 方案列表/详情
│   │   │   │   ├── dashboard/   # 供需双方控制台
│   │   │   │   ├── messages/    # 站内沟通
│   │   │   │   ├── compare/     # 产品对比
│   │   │   │   ├── poc/         # POC 流程
│   │   │   │   ├── quote/       # 方案报价
│   │   │   │   ├── featured/    # 精选推荐
│   │   │   │   └── match/       # 智能匹配
│   │   │   ├── auth/            # 登录/注册
│   │   │   └── api/             # API 路由（28 个）
│   │   │       ├── public/      # 公开 API
│   │   │       ├── demands/     # 需求 API
│   │   │       ├── supplier/    # 供应商 API
│   │   │       ├── messages/    # 消息 API
│   │   │       ├── search/      # 搜索 API
│   │   │       └── auth/        # 认证 API
│   │   ├── components/
│   │   │   ├── layout/          # Header, Footer
│   │   │   ├── ui/              # 通用 UI 组件（14 个）
│   │   │   ├── cards/           # 卡片组件（7 个）
│   │   │   ├── sections/        # 区块组件（HeroGraphic, FeaturedHero）
│   │   │   └── auth/            # 认证组件（UserMenu）
│   │   ├── lib/
│   │   │   ├── auth.ts          # JWT 签名/验证 + 密码哈希
│   │   │   ├── session.ts       # 登录/注册/登出 Server Actions
│   │   │   ├── constants.ts     # 模拟数据（产品/需求/公司/方案）
│   │   │   ├── jsonld.ts        # JSON-LD 结构化数据生成
│   │   │   └── markdown.ts      # Markdown 内容生成
│   │   ├── types/
│   │   │   └── index.ts         # 全局 TypeScript 类型定义
│   │   └── proxy.ts             # Next.js 16 Proxy（认证路由守卫）
│   ├── package.json
│   └── next.config.ts
├── 01-iWantU-产品需求文档-PRD-v1.0.md
├── 02-iWantU-技术方案与技术路线-v1.0.md
└── README.md                     # 本文件
```

---

## 快速开始

### 环境要求

- Node.js 18+
- PostgreSQL 15+（生产环境；开发时前端可独立运行）
- npm

### 安装与启动

```bash
cd next-app

# 安装依赖
npm install

# 生成 Prisma Client
npx prisma generate

# 启动开发服务器
npm run dev
```

访问 http://localhost:3000 即可浏览平台。

### 数据库设置（可选）

```bash
# 配置 .env 中的 DATABASE_URL
# DATABASE_URL="postgresql://user:password@localhost:5432/iwantu"

# 执行数据库迁移
npx prisma migrate dev --name init

# 填充种子数据
npm run db:seed
```

---

## 页面路由清单

### 前台页面（23 个）

| 路由 | 页面 | PRD 章节 |
|------|------|----------|
| `/` | 首页 | 5.1 |
| `/featured` | 精选推荐 | 5.2 |
| `/products` | AI产品列表 | 5.3 |
| `/products/[id]` | 产品详情 | 5.5 |
| `/products/publish` | 发布产品 | 5.8 |
| `/demands` | 需求大厅 | 5.4 |
| `/demands/[id]` | 需求详情 | 5.9 |
| `/demands/publish` | 发布需求 | 5.7 |
| `/match` | 智能匹配结果 | 5.6 |
| `/agents` | AI Agent 列表 | 5.13 |
| `/agents/[id]` | Agent 详情 | 5.14 |
| `/companies` | AI公司与OPC列表 | 5.15 |
| `/companies/[id]` | OPC公司主页 | 5.16 |
| `/solutions` | 解决方案列表 | 5.17 |
| `/solutions/[id]` | 方案详情 | 5.18 |
| `/compare` | 产品对比 | 5.12 |
| `/messages` | 站内沟通 | 5.21 |
| `/dashboard/buyer` | 需求方控制台 | 5.10 |
| `/dashboard/supplier` | 供应商后台 | 5.11 |
| `/poc` | POC流程 | 5.19 |
| `/quote` | 方案报价 | 5.20 |
| `/auth/login` | 登录 | — |
| `/auth/register` | 注册 | — |

### API 路由（28 个）

#### 公开 API
| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/public/products` | GET | 获取产品列表 |
| `/api/public/products/[id]` | GET | 获取产品详情 |
| `/api/public/products/[id]/markdown` | GET | 产品 Markdown 输出 |
| `/api/public/agents` | GET | 获取 Agent 列表 |
| `/api/public/agents/[id]` | GET | 获取 Agent 详情 |
| `/api/public/companies` | GET | 获取公司列表 |
| `/api/public/companies/[id]` | GET | 获取公司详情 |
| `/api/public/companies/[id]/markdown` | GET | 公司 Markdown 输出 |
| `/api/public/solutions` | GET | 获取方案列表 |
| `/api/public/solutions/[id]` | GET | 获取方案详情 |
| `/api/public/solutions/[id]/markdown` | GET | 方案 Markdown 输出 |
| `/api/public/demands` | GET | 获取公开需求列表 |

#### 搜索 API
| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/search?q=keyword` | GET | 全局搜索（产品/公司/方案） |

#### 用户 API
| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/demands` | GET/POST | 需求列表 / 创建需求草稿 |
| `/api/demands/[id]` | GET/PUT | 需求详情 / 更新需求 |
| `/api/demands/[id]/publish` | POST | 发布需求 |
| `/api/demands/[id]/match` | POST | 触发智能匹配 |
| `/api/products/[id]/contact` | POST | 联系供应商 |
| `/api/products/[id]/apply-poc` | POST | 申请 POC |

#### 供应商 API
| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/supplier/products` | GET/POST | 我的产品 / 创建产品 |
| `/api/supplier/products/[id]` | GET/PUT | 产品详情 / 更新产品 |
| `/api/supplier/leads` | GET | 需求线索 |
| `/api/supplier/proposals` | GET/POST | 方案列表 / 创建方案 |
| `/api/supplier/proposals/[id]` | GET/PUT | 方案详情 / 更新方案 |

#### 消息 API
| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/messages/threads` | GET/POST | 会话列表 / 创建会话 |
| `/api/messages/threads/[id]` | GET | 会话详情（含消息） |
| `/api/messages/threads/[id]/send` | POST | 发送消息 |

#### 认证 API
| 路由 | 方法 | 说明 |
|------|------|------|
| `/api/auth/me` | GET | 获取当前用户 |

---

## 数据库模型（Prisma）

共 **21 个模型**，**15 个枚举**：

### 核心模型

| 模型 | 说明 |
|------|------|
| `User` | 用户（含角色、组织关联） |
| `Organization` | 组织（买方/供应商/OPC团队） |
| `OrganizationMember` | 组织成员 |
| `Product` | AI 产品 |
| `AgentProduct` | AI Agent 产品 |
| `CompanyProfile` | 公司档案 |
| `Demand` | 需求 |
| `Solution` | 解决方案 |
| `PocProject` / `PocParticipant` | POC 项目与参与方 |
| `Proposal` / `Milestone` / `QuoteItem` | 方案、里程碑、报价项 |
| `MessageThread` / `Message` / `ThreadParticipant` | 消息会话 |
| `AuditLog` / `AgentAction` | 审计日志与 AI 行为记录 |
| `Attachment` / `Review` / `FeaturedItem` | 附件、评价、精选推荐 |

### 枚举

`UserRole` · `OrgType` · `DemandStatus` · `ProductStatus` · `PocStatus` · `SampleDataStatus` · `PricingModel` · `RiskLevel` · `MessageThreadType` · `ProposalStatus` · `AuditDecision` · `ApprovalStatus` · `AttachmentTargetType` · `ReviewTargetType` · `FeaturedItemType`

---

## AI 可读层

平台支持外部 AI Agent 以多种机器可读方式访问：

| 方式 | 路径 | 说明 |
|------|------|------|
| **llms.txt** | `/llms.txt` | 站点级 AI 导航文件 |
| **MCP Manifest** | `/.well-known/mcp.json` | 7 个工具 + 4 个资源 |
| **A2A Agent Card** | `/.well-known/agent-card.json` | 6 项能力 + 4 项动作 |
| **JSON-LD** | 页面内嵌 | Schema.org 结构化数据 |
| **Markdown API** | `/api/public/*/markdown` | 资源 Markdown 输出 |
| **Open API** | `/api/public/*` | RESTful JSON API |

---

## 认证与路由守卫

- JWT (HS256) 存储于 httpOnly Cookie
- 路由守卫通过 `src/proxy.ts`（Next.js 16 Proxy）实现
- **受保护路由**：`/dashboard/*`、`/demands/publish`、`/products/publish`、`/messages`、`/quote`
- **公开路由**：首页、产品、需求、公司、方案、Agent、搜索等
- 未登录访问受保护路由会重定向到 `/auth/login`

---

## 当前进度

### ✅ 已完成

- [x] **MVP 0.1 — 传统平台闭环**
  - 23 个页面路由（首页、产品、需求、Agent、公司、方案、POC、报价、对比、消息、控制台）
  - 25 个 UI 组件（布局、卡片、表单、区块）
  - JWT 认证系统（登录/注册/登出/路由守卫/用户菜单）
  - Prisma 数据库 Schema（21 模型 + 种子数据）
  - Mock 数据驱动的前端

- [x] **MVP 0.2 — AI 可读平台**
  - JSON-LD 结构化数据生成工具
  - Markdown Mirror API（产品/公司/方案）
  - llms.txt 站点导航
  - MCP Server Manifest
  - A2A Agent Card
  - 公开 REST API（28 个路由）

- [x] **API 层**
  - 公开 API、搜索 API
  - 用户需求 API、供应商 API
  - 消息 API、认证 API

### 🔲 待开发

- [ ] **MVP 0.3 — AI 代理草稿模式**
  - AI 生成需求草稿、方案草稿、报价草稿
  - 用户审批机制
  - AI 行为日志

- [ ] **MVP 0.4 — AI 半自动执行**
  - AI 自动匹配需求、推荐产品
  - 筛选线索、接单草稿
  - 权限策略中心

- [ ] **MVP 1.0 — AI 自主协作市场**
  - MCP 服务完整实现
  - A2A Agent 身份认证
  - AI 自主提需/接单
  - AI 行为审计
  - POC 自动评测

---

## 可用脚本

```bash
cd next-app

npm run dev              # 启动开发服务器 (http://localhost:3000)
npm run build            # 生产构建
npm run start            # 启动生产服务器
npm run lint             # ESLint 检查

npx prisma generate      # 生成 Prisma Client
npx prisma migrate dev   # 执行数据库迁移
npx prisma studio        # 打开数据库管理界面
npm run db:seed          # 填充种子数据
```

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [产品需求文档 PRD v1.0](./01-iWantU-产品需求文档-PRD-v1.0.md) | 产品定位、用户角色、AI自主模式、页面级PRD |
| [技术方案与技术路线 v1.0](./02-iWantU-技术方案与技术路线-v1.0.md) | 架构、技术栈、核心模块、API设计、里程碑 |
| [本文档](./README.md) | 项目概述、结构、进度、快速开始 |
