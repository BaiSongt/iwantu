# iWantU — AI 能力供需撮合平台

> 连接 AI 需求方与 AI 能力方，帮助企业发布需求、匹配产品、筛选公司、启动 POC 与采购沟通。

---

## 项目简介

iWantU 是面向企业用户与外部 AI Agent 的 **B2B AI 能力供需撮合、方案采购、POC 验证与交付协同平台**。

平台支持两种模式：

- **人类模式**：企业发布 AI 需求，AI 公司 / OPC 团队发布产品与解决方案，双方通过平台完成匹配、报价、POC 与采购沟通。
- **AI 自主模式**：外部 AI Agent 通过 MCP 协议以机器可读方式浏览平台内容，在授权范围内代表用户发布需求、提交方案、参与沟通。

核心闭环：

```
发现AI能力 -> 发布需求 -> AI澄清 -> 智能匹配 -> 申请POC -> 提交方案/报价 -> 沟通确认 -> 采购/交付
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| **前端框架** | Next.js 16 (App Router) + React 19 |
| **开发语言** | TypeScript 5 |
| **样式方案** | Tailwind CSS v4 |
| **后端 API** | Next.js API Routes (Route Handlers) |
| **数据库** | PostgreSQL 15 + Prisma ORM v6 |
| **认证** | JWT (jose) + bcryptjs，Cookie-based |
| **AI 协议** | MCP Server / A2A Agent Card / JSON-LD / Markdown Mirror / llms.txt |
| **状态管理** | Zustand |
| **图标** | Lucide React |
| **容器化** | Docker + Docker Compose |

---

## 功能特性

### v0.1 — 传统平台闭环 (MVP)
- 23 个前台页面路由（首页、产品、需求、Agent、公司、方案、POC、报价、对比、消息、控制台）
- 25+ UI 组件（布局、卡片、表单、区块）
- JWT 认证系统（登录 / 注册 / 登出 / 路由守卫 / 用户菜单）
- Prisma 数据库 Schema（21 模型 + 15 枚举）
- 前端页面完整布局与交互

### v0.2 — AI 可读平台
- JSON-LD 结构化数据生成工具
- Markdown Mirror API（产品 / 公司 / 方案）
- llms.txt 站点导航文件
- MCP Server Manifest
- A2A Agent Card
- 公开 REST API

### v0.3 — 数据接入层
- Prisma Schema 完整定义（21 模型）
- Data Access Layer (DAL) 实现所有数据库操作
- 29 个 API 路由全部接入真实数据
- Docker + Docker Compose 开发 / 生产配置
- 种子数据脚本

### v0.4 — 用户系统与组织管理
- 完整注册 / 登录 / 登出流程
- Cookie-based JWT 认证
- Next.js 16 Proxy 路由守卫
- 用户角色（buyer / supplier / opc_team / admin）
- 组织管理（创建 / 成员管理）
- 控制台按角色显示不同内容

### v1.0 — AI 自主协作市场
- MCP 协议完整实现（11 个工具）
- API Key 管理（创建 / 吊销 / 权限范围）
- Agent 行为审计日志
- 消息系统（会话 / 发送 / AI 标识）
- 通知系统
- 全局搜索 API
- 文件上传
- 控制台指标面板
- 错误边界与加载骨架屏
- 完整文档（README / 部署指南 / API 文档）

---

## 快速开始

### 前置条件

- **Node.js** 18+（推荐 20 LTS）
- **Docker** & Docker Compose（用于运行 PostgreSQL）
- **npm**（随 Node.js 安装）

### 1. 克隆项目

```bash
git clone <repository-url> iwantu
cd iwantu
```

### 2. 安装依赖

```bash
cd next-app
npm install
```

### 3. 配置环境变量

```bash
cp ../.env.example ../.env
# 或直接编辑 next-app/.env
```

编辑 `next-app/.env`，确保以下配置正确：

```env
DATABASE_URL="postgresql://iwantu:iwantu123@localhost:5433/iwantu?schema=public"
JWT_SECRET="your-secret-key-here"
```

> 注意：本地开发 PostgreSQL 映射到 5433 端口（避免与本地 5432 冲突）。

### 4. 启动数据库

```bash
cd ..
docker compose up -d postgres
```

等待 PostgreSQL 健康检查通过（约 10 秒）：

```bash
docker compose ps
# 确认 iwantu-postgres 状态为 healthy
```

### 5. 执行数据库迁移

```bash
cd next-app
npx prisma migrate dev --name init
```

### 6. 填充种子数据

```bash
npm run db:seed
```

### 7. 启动开发服务器

```bash
npm run dev
```

访问 http://localhost:3000 即可浏览平台。

---

## 项目结构

```
iwantu/
├── docs/                          # 项目文档
│   ├── deployment.md              # 部署指南
│   └── api.md                     # API 文档
├── docker-compose.yml             # 生产 Docker Compose
├── docker-compose.dev.yml         # 开发 Docker Compose
├── .env.example                   # 环境变量模板
├── next-app/                      # 主项目（Next.js 16）
│   ├── prisma/
│   │   ├── schema.prisma          # 数据库 Schema（21 模型，15 枚举）
│   │   └── seed.ts                # 种子数据
│   ├── public/
│   │   ├── llms.txt               # AI 可读入口文件
│   │   └── .well-known/
│   │       ├── mcp.json           # MCP Server Manifest
│   │       └── agent-card.json    # A2A Agent Card
│   ├── src/
│   │   ├── app/
│   │   │   ├── (main)/            # 前台页面（23 个路由）
│   │   │   │   ├── page.tsx       # 首页
│   │   │   │   ├── products/      # 产品列表 / 详情 / 发布
│   │   │   │   ├── demands/       # 需求大厅 / 详情 / 发布
│   │   │   │   ├── agents/        # Agent 列表 / 详情
│   │   │   │   ├── companies/     # 公司列表 / 主页
│   │   │   │   ├── solutions/     # 方案列表 / 详情
│   │   │   │   ├── dashboard/     # 供需双方控制台
│   │   │   │   ├── messages/      # 站内沟通
│   │   │   │   ├── compare/       # 产品对比
│   │   │   │   ├── poc/           # POC 流程
│   │   │   │   ├── quote/         # 方案报价
│   │   │   │   ├── featured/      # 精选推荐
│   │   │   │   └── match/         # 智能匹配
│   │   │   ├── auth/              # 登录 / 注册
│   │   │   ├── dashboard/         # 控制台（需认证）
│   │   │   └── api/               # API 路由（50+）
│   │   │       ├── public/        # 公开 API（产品 / Agent / 公司 / 方案 / 需求）
│   │   │       ├── auth/          # 认证 API
│   │   │       ├── demands/       # 需求 CRUD
│   │   │       ├── products/      # 产品列表
│   │   │       ├── supplier/      # 供应商 API（产品 / 提案 / 线索）
│   │   │       ├── proposals/     # 提案详情
│   │   │       ├── poc/           # POC 管理
│   │   │       ├── messages/      # 消息系统
│   │   │       ├── notifications/ # 通知
│   │   │       ├── search/        # 全局搜索
│   │   │       ├── dashboard/     # 控制台指标
│   │   │       ├── upload/        # 文件上传
│   │   │       ├── api-keys/      # API Key 管理
│   │   │       ├── mcp/           # MCP 协议
│   │   │       ├── admin/         # 管理后台
│   │   │       └── users/         # 用户信息
│   │   ├── components/
│   │   │   ├── layout/            # Header, Footer, NotificationBell
│   │   │   ├── ui/                # 通用 UI 组件（EmptyState, FilterPanel, 等）
│   │   │   ├── cards/             # 卡片组件（Product, Demand, Company, Solution 等）
│   │   │   ├── sections/          # 区块组件（HeroGraphic, FeaturedHero）
│   │   │   └── auth/              # 认证组件（UserMenu）
│   │   ├── lib/
│   │   │   ├── auth.ts            # JWT 签名 / 验证 + 密码哈希
│   │   │   ├── auth-agent.ts      # Agent 认证（API Key）
│   │   │   ├── auth-helpers.ts    # API 路由认证辅助
│   │   │   ├── session.ts         # 登录 / 注册 / 登出 Server Actions
│   │   │   ├── api-utils.ts       # API 响应工具函数
│   │   │   ├── storage.ts         # 文件存储
│   │   │   ├── email.ts           # 邮件发送
│   │   │   ├── notify.ts          # 通知发送
│   │   │   ├── jsonld.ts          # JSON-LD 结构化数据
│   │   │   ├── markdown.ts        # Markdown 内容生成
│   │   │   ├── constants.ts       # 导航项等常量
│   │   │   └── db/                # Data Access Layer
│   │   │       ├── client.ts      # Prisma Client 单例
│   │   │       ├── products.ts    # 产品 DAL
│   │   │       ├── demands.ts     # 需求 DAL
│   │   │       ├── proposals.ts   # 提案 DAL
│   │   │       ├── messages.ts    # 消息 DAL
│   │   │       ├── notifications.ts # 通知 DAL
│   │   │       ├── poc.ts         # POC DAL
│   │   │       ├── search.ts      # 搜索 DAL
│   │   │       ├── agents.ts      # Agent DAL
│   │   │       ├── companies.ts   # 公司 DAL
│   │   │       ├── solutions.ts   # 方案 DAL
│   │   │       └── featured.ts    # 精选 DAL
│   │   ├── types/
│   │   │   └── index.ts           # 全局 TypeScript 类型定义
│   │   └── proxy.ts               # Next.js 16 Proxy（认证路由守卫）
│   ├── Dockerfile                 # 多阶段生产构建
│   ├── package.json
│   └── next.config.ts
└── README.md                      # 本文件
```

---

## API 概览

完整 API 文档请参阅 [docs/api.md](./docs/api.md)。

### 认证 (Authentication)
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/auth/me` | 获取当前用户信息 |

### 需求 (Demands)
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/demands` | 需求列表（支持筛选） |
| POST | `/api/demands` | 创建需求草稿 |
| GET | `/api/demands/[id]` | 需求详情 |
| PUT | `/api/demands/[id]` | 更新需求 |
| DELETE | `/api/demands/[id]` | 删除需求（仅草稿） |
| POST | `/api/demands/[id]/publish` | 发布需求 |
| POST | `/api/demands/[id]/match` | 触发智能匹配 |
| GET | `/api/demands/[id]/proposals` | 获取需求的提案列表 |

### 产品 (Products)
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/products` | 产品列表（公开） |
| GET | `/api/supplier/products` | 我的产品（供应商） |
| POST | `/api/supplier/products` | 创建产品 |
| GET | `/api/supplier/products/[id]` | 产品详情 |
| PUT | `/api/supplier/products/[id]` | 更新产品 |

### 提案 (Proposals)
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/supplier/proposals` | 我的提案（供应商） |
| POST | `/api/supplier/proposals` | 创建提案 |
| GET | `/api/proposals/[id]` | 提案详情 |
| PUT | `/api/proposals/[id]` | 更新提案 / 审核状态 |

### POC
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/poc` | POC 项目列表 |
| POST | `/api/poc` | 创建 POC 项目 |
| GET | `/api/poc/[id]` | POC 详情 |
| PUT | `/api/poc/[id]` | 更新 POC 状态 |

### 消息 (Messages)
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/messages/threads` | 会话列表 |
| POST | `/api/messages/threads` | 创建会话 |
| GET | `/api/messages/threads/[id]` | 会话详情 |
| POST | `/api/messages/threads/[id]/send` | 发送消息 |

### 通知 (Notifications)
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/notifications` | 通知列表 |
| PUT | `/api/notifications` | 标记已读 |

### 搜索 (Search)
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/search?q=keyword` | 全局搜索 |

### 控制台 (Dashboard)
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/dashboard/metrics` | 控制台指标 |

### 文件 (Upload)
| 方法 | 路由 | 说明 |
|------|------|------|
| POST | `/api/upload` | 上传文件 |
| GET | `/api/upload/[id]` | 获取附件信息 |

### API Key
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/api-keys` | 我的 API Key 列表 |
| POST | `/api/api-keys` | 创建 API Key |
| DELETE | `/api/api-keys/[id]` | 删除 API Key |

### MCP (AI Agent)
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/mcp` | 工具列表 |
| POST | `/api/mcp` | 执行工具调用 |

### 管理 (Admin)
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/admin/agent-actions` | AI 行为审计日志 |

### 用户 (Users)
| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/users/me` | 当前用户资料 |
| PUT | `/api/users/me` | 更新用户资料 |
| PUT | `/api/users/me/password` | 修改密码 |

---

## 部署指南

完整部署文档请参阅 [docs/deployment.md](./docs/deployment.md)。

### Docker Compose 一键部署

```bash
# 构建并启动
docker compose up -d --build

# 查看日志
docker compose logs -f app
```

---

## 测试账号

种子数据提供以下测试账号：

| 角色 | 邮箱 | 密码 | 说明 |
|------|------|------|------|
| 管理员 | `admin@iwantu.com` | `admin123` | 平台管理员 |
| 需求方 | `buyer@demo.com` | `demo123` | 鑫达制造集团 - 张明 |
| 供应商 | `supplier1@demo.com` | `demo123` | 智造科技 - 陈工 |
| 供应商 | `supplier2@demo.com` | `demo123` | 数智云行 - 刘总 |
| OPC 团队 | `opc@demo.com` | `demo123` | 平台运营 - 运营专员 |
| 供应商 | `researcher@demo.com` | `demo123` | 未来智造研究院 - 赵博士 |

---

## 环境变量

| 变量名 | 必填 | 默认值 | 说明 |
|--------|------|--------|------|
| `DATABASE_URL` | 是 | — | PostgreSQL 连接字符串 |
| `JWT_SECRET` | 是 | — | JWT 签名密钥，生产环境务必更换 |
| `SMTP_HOST` | 否 | — | SMTP 服务器地址 |
| `SMTP_PORT` | 否 | `587` | SMTP 端口 |
| `SMTP_USER` | 否 | — | SMTP 用户名 |
| `SMTP_PASS` | 否 | — | SMTP 密码 |
| `NODE_ENV` | 否 | `development` | 运行环境 |
| `UPLOAD_DIR` | 否 | `/data/uploads` | 上传文件存储目录 |

### 生成安全密钥

```bash
openssl rand -base64 32
```

---

## 可用脚本

```bash
cd next-app

npm run dev              # 启动开发服务器 (http://localhost:3000)
npm run build            # 生产构建
npm run start            # 启动生产服务器
npm run lint             # ESLint 检查

npx prisma generate      # 生成 Prisma Client
npx prisma migrate dev   # 执行数据库迁移（开发环境）
npx prisma migrate deploy # 执行数据库迁移（生产环境）
npx prisma studio        # 打开数据库管理界面
npm run db:seed          # 填充种子数据
```

---

## 版本历史

### v0.3 — 数据接入层
- Prisma Schema 完整定义（21 模型 + 15 枚举）
- Data Access Layer (DAL) 实现所有数据库 CRUD 操作
- 29 个 API 路由从 Mock 数据迁移到真实数据库
- Docker + Docker Compose 开发 / 生产配置
- 种子数据脚本（组织、用户、产品、需求、方案、消息等）
- 全局搜索 API
- 文件上传 API

### v0.4 — 用户系统与组织管理
- 完整注册 / 登录 / 登出 Server Actions
- Cookie-based JWT (HS256) 认证
- Next.js 16 Proxy 路由守卫（受保护路由重定向到登录）
- 用户角色（buyer / supplier / opc_team / admin / operator）
- 组织管理（创建 / 成员管理 / 角色分配）
- 控制台按角色显示不同指标与操作
- 密码修改

### v1.0 — AI 自主协作市场
- MCP 协议完整实现（11 个工具：搜索、需求、匹配、提案等）
- API Key 管理（创建 / 吊销 / 权限范围 / 脱敏显示）
- Agent 行为审计日志（记录所有 AI 操作与风险等级）
- Agent 认证与权限校验（API Key + Scope）
- 消息系统（会话管理 / 消息发送 / AI 生成标识）
- 通知系统（未读计数 / 标记已读 / 按类型筛选）
- 全局搜索（产品 / 需求 / 公司 / 方案）
- 文件上传与附件管理
- 控制台指标面板（按角色差异化）
- 错误边界组件（友好错误提示 + 重试）
- 加载骨架屏（匹配页面布局）
- 空状态组件（EmptyState）
- 完整项目文档（README / 部署指南 / API 文档）

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [部署指南](./docs/deployment.md) | VPS 部署、SSL、Nginx、备份、监控 |
| [API 文档](./docs/api.md) | 所有 API 端点的详细文档 |
| [本文档](./README.md) | 项目概述、快速开始、版本历史 |
