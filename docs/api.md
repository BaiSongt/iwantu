# iWantU API 文档

> iWantU 平台 RESTful API 完整文档。所有 API 基于 Next.js API Routes 实现。

---

## 通用信息

### Base URL

```
生产环境: https://yourdomain.com/api
开发环境: http://localhost:3000/api
```

### 认证方式

平台使用 **Cookie-based JWT** 认证。登录成功后，服务器会设置 `iwantu_session` Cookie（httpOnly），后续请求浏览器自动携带。

对于 MCP / AI Agent 调用，使用 **API Key** 认证，通过 `Authorization` 请求头传递：

```
Authorization: Bearer iwantu_xxxxxxxx
```

### 请求头

| 头部 | 说明 |
|------|------|
| `Content-Type` | `application/json`（JSON 请求体） |
| `Cookie` | `iwantu_session=<token>`（浏览器自动携带） |
| `Authorization` | `Bearer <api-key>`（AI Agent 调用时使用） |

### 响应格式

成功响应：

```json
{
  "id": "...",
  "name": "...",
  ...
}
```

错误响应：

```json
{
  "error": "错误描述信息"
}
```

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 204 | 无内容（CORS 预检） |
| 400 | 请求参数错误 |
| 401 | 未登录 |
| 403 | 无权限 |
| 404 | 资源不存在 |
| 409 | 数据冲突（唯一约束） |
| 500 | 服务器内部错误 |

### CORS

所有 API 支持跨域请求，响应头包含：

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: Content-Type, Authorization
```

---

## 认证 (Auth)

### GET /api/auth/me

获取当前登录用户信息。

**认证**：不需要（未登录返回 `null`）

**响应示例**：

```json
{
  "user": {
    "id": "user_buyer",
    "name": "张明",
    "email": "buyer@demo.com",
    "role": "buyer",
    "orgId": "org_xinda",
    "phone": "13800000001",
    "createdAt": "2025-01-01T00:00:00.000Z"
  }
}
```

未登录时：

```json
{
  "user": null
}
```

---

## 需求 (Demands)

### GET /api/demands

获取需求列表，支持多种筛选条件。

**认证**：不需要（公开）

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `industry` | string | 行业筛选 |
| `status` | string | 状态筛选（draft / clarifying / collecting_proposals / in_poc / closed_deal / closed） |
| `search` | string | 文本搜索 |
| `userId` | string | 按需求所有者筛选 |
| `supportPoc` | string | 是否支持 POC（"true" / "false"） |
| `budgetMin` | number | 最低预算（万元） |
| `budgetMax` | number | 最高预算（万元） |

**请求示例**：

```bash
curl "http://localhost:3000/api/demands?status=collecting_proposals&industry=manufacturing"
```

**响应示例**：

```json
[
  {
    "id": "d1",
    "title": "某制造企业需要建设内部制度知识库问答系统",
    "industry": "制造业",
    "budgetRange": "10-30万",
    "deliveryPeriod": "1个月内",
    "status": "awaiting_quote",
    "matchScore": "92%",
    "createdAt": "2025-06-01T00:00:00.000Z"
  }
]
```

### POST /api/demands

创建需求草稿。

**认证**：需要（任意角色）

**请求体**：

```json
{
  "title": "企业需要智能客服系统",
  "industry": "零售",
  "budgetRange": "20-50万",
  "budgetMin": 200000,
  "budgetMax": 500000,
  "deliveryPeriod": "2个月内",
  "dataTypes": ["文本", "日志"],
  "deploymentRequirement": "SaaS",
  "description": "需要一套多渠道智能客服系统...",
  "painPoints": "人工客服成本高，响应慢",
  "existingSystems": "呼叫中心",
  "supportPoc": true,
  "allowAiSupplier": true
}
```

**响应**：201 Created，返回创建的需求对象。

### GET /api/demands/[id]

获取需求详情。

**认证**：不需要（公开）

**响应**：返回需求的完整信息。

### PUT /api/demands/[id]

更新需求。支持状态流转。

**认证**：需要（需求所有者或管理员）

**状态流转规则**：

```
draft -> clarifying / collecting_proposals / closed
clarifying -> collecting_proposals / draft / closed
awaiting_quote -> collecting_proposals / closed
collecting_proposals -> in_poc / closed
in_poc -> closed_deal / closed
closed_deal -> closed
```

**请求体**：

```json
{
  "title": "更新后的标题",
  "status": "collecting_proposals"
}
```

### DELETE /api/demands/[id]

删除需求。仅草稿状态可删除（管理员除外）。

**认证**：需要（需求所有者或管理员）

**响应**：

```json
{
  "deleted": true
}
```

### POST /api/demands/[id]/publish

发布需求（将状态从 draft 变更为 collecting_proposals）。

**认证**：需要（需求所有者）

### POST /api/demands/[id]/match

触发智能匹配，返回匹配的产品、Agent、公司和方案。

**认证**：需要

### GET /api/demands/[id]/proposals

获取该需求下的所有提案。

**认证**：需要（需求所有者、供应商或管理员）

---

## 产品 (Products)

### GET /api/products

获取产品列表（公开）。

**认证**：不需要

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `category` | string | 能力分类 |
| `search` | string | 文本搜索 |
| `industry` | string | 行业标签 |
| `status` | string | 状态（默认 published） |
| `deploymentMode` | string | 部署方式 |
| `pricingModel` | string | 价格模式 |

**请求示例**：

```bash
curl "http://localhost:3000/api/products?search=知识库&deploymentMode=private_cloud"
```

**响应示例**：

```json
[
  {
    "id": "p1",
    "name": "智问企业知识库",
    "summary": "面向企业内部文档的私有化知识库问答系统",
    "category": "AI Knowledge Base",
    "rating": 4.8,
    "caseCount": 36,
    "pricingModel": "per_project",
    "price": "按项目报价",
    "deploymentModes": ["saas", "private_cloud", "on_premise"],
    "supportPoc": true,
    "tags": ["RAG", "私有化", "溯源"]
  }
]
```

### GET /api/supplier/products

获取当前供应商组织的产品列表。

**认证**：需要（supplier 角色）

### POST /api/supplier/products

创建新产品。

**认证**：需要（supplier 角色，必须属于某个组织）

**请求体**：

```json
{
  "name": "新产品名称",
  "summary": "产品简介",
  "description": "详细描述",
  "category": "AI Agent",
  "industryTags": ["manufacturing"],
  "capabilityTags": ["Agent", "自动化"],
  "deploymentModes": ["saas"],
  "pricingModel": "subscription",
  "price": "订阅制",
  "supportPoc": true,
  "supportPrivateDeployment": false,
  "tags": ["Agent", "自动化"]
}
```

**响应**：201 Created

### PUT /api/supplier/products/[id]

更新产品信息。

**认证**：需要（supplier 角色，产品所属组织）

### POST /api/products/[id]/contact

联系产品供应商。

**认证**：需要

### POST /api/products/[id]/apply-poc

申请 POC。

**认证**：需要

---

## 提案 (Proposals)

### GET /api/supplier/proposals

获取当前供应商组织的提案列表。

**认证**：需要（supplier 角色）

### POST /api/supplier/proposals

创建提案。

**认证**：需要（supplier 角色，必须属于某个组织）

**请求体**：

```json
{
  "demandId": "d1",
  "title": "知识库问答系统方案",
  "scope": "覆盖生产、安全、质量管理制度的知识库问答系统",
  "price": 250000,
  "currency": "CNY",
  "deliveryPeriod": "6周",
  "milestones": [
    {
      "name": "需求确认与方案设计",
      "description": "与客户确认详细需求并完成方案设计文档",
      "duration": "1周",
      "deliverables": ["需求确认书", "方案设计文档"]
    },
    {
      "name": "系统开发与测试",
      "description": "完成系统开发与内部测试",
      "duration": "3周",
      "deliverables": ["系统原型", "测试报告"]
    }
  ],
  "quoteItems": [
    {
      "name": "知识库引擎",
      "description": "RAG 引擎与文档解析",
      "quantity": 1,
      "unit": "套",
      "unitPrice": 150000,
      "totalPrice": 150000
    },
    {
      "name": "定制开发",
      "description": "按需求定制开发",
      "quantity": 1,
      "unit": "项",
      "unitPrice": 100000,
      "totalPrice": 100000
    }
  ]
}
```

**响应**：201 Created

### GET /api/proposals/[id]

获取提案详情，含里程碑、报价项和供应商信息。

**认证**：需要（需求方、提案供应商或管理员）

**响应示例**：

```json
{
  "id": "prop1",
  "demandId": "d1",
  "supplierId": "org_zhizao",
  "supplierOrgName": "智造科技",
  "title": "知识库问答系统方案",
  "scope": "覆盖生产、安全、质量管理制度的知识库问答系统",
  "price": 250000,
  "currency": "CNY",
  "status": "submitted",
  "milestones": [...],
  "quoteItems": [...],
  "createdAt": "2025-06-02T00:00:00.000Z"
}
```

### PUT /api/proposals/[id]

更新提案。两种用途：

1. **供应商**：保存报价项、里程碑
2. **需求方 / 管理员**：审核提案（accepted / rejected）

**认证**：需要

**状态流转**：

```
draft -> submitted -> reviewed -> accepted / rejected
```

**供应商保存报价**：

```json
{
  "quoteItems": [...],
  "milestones": [...],
  "price": 250000,
  "status": "submitted"
}
```

**需求方审核**：

```json
{
  "status": "accepted"
}
```

> 当提案被接受（accepted）时，对应需求会自动进入 `in_poc` 状态。

---

## POC

### GET /api/poc

获取 POC 项目列表。

**认证**：需要

- 普通用户：返回自己参与的 POC
- 管理员 / OPC：可查看所有 POC，支持筛选

**查询参数（管理员）**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `status` | string | POC 状态 |
| `demandId` | string | 按需求筛选 |
| `supplierOrgId` | string | 按供应商组织筛选 |

### POST /api/poc

创建 POC 项目。

**认证**：需要（需求所有者或管理员）

**请求体**：

```json
{
  "demandId": "d1",
  "productId": "p1",
  "supplierOrgId": "org_zhizao",
  "acceptanceCriteria": ["准确率 > 90%", "响应时间 < 3s"]
}
```

**响应**：201 Created

### GET /api/poc/[id]

获取 POC 项目详情。

**认证**：需要

### PUT /api/poc/[id]

更新 POC 状态。

**认证**：需要（参与者或管理员）

**POC 状态流转**：

```
not_started -> confirming_requirements -> uploading_sample_data
-> supplier_testing -> result_review -> procurement_discussion -> completed
```

也可以从任何状态变更为 `terminated`。

---

## 消息 (Messages)

### GET /api/messages/threads

获取当前用户的会话列表。

**认证**：需要

**响应示例**：

```json
[
  {
    "id": "thread1",
    "title": "关于知识库问答系统的需求沟通",
    "type": "demand",
    "relatedId": "d1",
    "lastMessage": "我们希望支持Word、PDF、Excel等多种文档格式。",
    "lastMessageAt": "2025-06-05T10:30:00.000Z",
    "unreadCount": 2
  }
]
```

### POST /api/messages/threads

创建新会话。

**认证**：需要

**请求体**：

```json
{
  "title": "需求沟通",
  "type": "demand",
  "relatedId": "d1",
  "participantIds": ["user_buyer", "user_supplier1"]
}
```

**响应**：201 Created

### GET /api/messages/threads/[id]

获取会话详情，包含所有消息。

**认证**：需要（参与者）

### POST /api/messages/threads/[id]/send

发送消息。

**认证**：需要（参与者）

**请求体**：

```json
{
  "content": "你好，我们对这个产品很感兴趣。",
  "isAiGenerated": false
}
```

**响应**：201 Created

---

## 通知 (Notifications)

### GET /api/notifications

获取当前用户的通知列表。

**认证**：需要

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `read` | string | 已读状态筛选（"true" / "false"） |
| `type` | string | 通知类型 |
| `page` | number | 页码（默认 1） |
| `limit` | number | 每页条数（默认 20） |

**响应示例**：

```json
{
  "items": [
    {
      "id": "notif1",
      "type": "proposal_received",
      "title": "收到新提案",
      "content": "智造科技对您的需求提交了方案",
      "read": false,
      "link": "/dashboard/demands",
      "createdAt": "2025-06-05T10:00:00.000Z"
    }
  ],
  "total": 15,
  "page": 1,
  "pageSize": 20,
  "totalPages": 1,
  "unreadCount": 3
}
```

### PUT /api/notifications

标记通知已读。

**认证**：需要

**请求体（标记单条）**：

```json
{
  "id": "notif1"
}
```

**请求体（标记全部）**：

```json
{
  "all": true
}
```

---

## 搜索 (Search)

### GET /api/search

全局搜索，跨产品、需求、公司、方案。

**认证**：不需要（公开）

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `q` | string | 搜索关键词 |
| `type` | string | 搜索类型（all / products / demands / companies / solutions） |
| `industry` | string | 行业筛选 |
| `category` | string | 分类筛选 |
| `status` | string | 状态筛选 |

**请求示例**：

```bash
curl "http://localhost:3000/api/search?q=知识库&type=all"
```

**响应示例**：

```json
{
  "products": [...],
  "demands": [...],
  "companies": [...],
  "solutions": [...]
}
```

---

## 控制台 (Dashboard)

### GET /api/dashboard/metrics

获取控制台指标数据。根据当前用户角色返回不同的指标。

**认证**：需要

**需求方 (buyer) 指标**：

```json
{
  "metrics": {
    "activeDemands": 5,
    "receivedProposals": 12,
    "activePoc": 2,
    "unreadMessages": 8
  }
}
```

**供应商 (supplier) 指标**：

```json
{
  "metrics": {
    "publishedProducts": 3,
    "newMatchingDemands": 15,
    "activeProposals": 7,
    "unreadMessages": 4
  }
}
```

**OPC 团队 (opc_team) 指标**：

```json
{
  "metrics": {
    "pendingMatching": 8,
    "activePoc": 5,
    "weeklyNew": 12
  }
}
```

**管理员 (admin) 指标**：

```json
{
  "metrics": {
    "totalUsers": 120,
    "totalProducts": 45,
    "totalDemands": 80,
    "activePocs": 15,
    "pendingReviews": 3
  }
}
```

---

## 文件上传 (Upload)

### POST /api/upload

上传文件并创建附件记录。

**认证**：需要

**请求格式**：`multipart/form-data`

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `file` | File | 是 | 要上传的文件 |
| `targetType` | string | 是 | 目标类型（product / demand / proposal / poc / message） |
| `targetId` | string | 是 | 目标 ID |

**请求示例**：

```bash
curl -X POST http://localhost:3000/api/upload \
  -H "Cookie: iwantu_session=<token>" \
  -F "file=@document.pdf" \
  -F "targetType=poc" \
  -F "targetId=poc1"
```

**响应**：201 Created

```json
{
  "id": "att1",
  "fileName": "document.pdf",
  "fileSize": 1024000,
  "fileType": "application/pdf",
  "url": "/data/uploads/2025/06/document.pdf",
  "targetType": "poc",
  "targetId": "poc1",
  "createdAt": "2025-06-05T10:00:00.000Z"
}
```

### GET /api/upload/[id]

获取附件信息。

**认证**：需要

---

## API Key 管理

### GET /api/api-keys

获取当前用户的 API Key 列表（密钥脱敏显示）。

**认证**：需要

**响应示例**：

```json
[
  {
    "id": "key1",
    "name": "My Agent Key",
    "keyMasked": "------------a1b2",
    "keySuffix": "a1b2",
    "scopes": ["read", "write:demand"],
    "expiresAt": null,
    "lastUsedAt": "2025-06-04T15:30:00.000Z",
    "createdAt": "2025-06-01T10:00:00.000Z"
  }
]
```

### POST /api/api-keys

创建新的 API Key。

**认证**：需要

**请求体**：

```json
{
  "name": "My Agent Key",
  "scopes": ["read", "write:demand", "write:proposal"],
  "expiresAt": "2026-06-01T00:00:00.000Z"
}
```

**可用权限范围**：
- `read` — 只读访问（搜索、查看产品 / 需求等）
- `write:demand` — 创建 / 修改需求
- `write:proposal` — 创建 / 修改提案

**响应**：201 Created（完整密钥仅在创建时返回一次）

```json
{
  "id": "key1",
  "name": "My Agent Key",
  "key": "iwantu_a1b2c3d4e5f6...",
  "scopes": ["read", "write:demand"],
  "expiresAt": "2026-06-01T00:00:00.000Z",
  "createdAt": "2025-06-05T10:00:00.000Z"
}
```

### DELETE /api/api-keys/[id]

删除（吊销）API Key。

**认证**：需要（Key 所有者）

---

## MCP 协议 (AI Agent)

### GET /api/mcp

获取可用工具列表。

**认证**：不需要

**响应示例**：

```json
{
  "name": "iWantU Marketplace MCP",
  "version": "0.1.0",
  "tools": [
    {
      "name": "search_products",
      "description": "Search AI products by keyword, industry, or capability",
      "riskLevel": "low",
      "requiredScope": "read"
    }
  ]
}
```

### POST /api/mcp

执行 MCP 工具调用。

**认证**：API Key（Authorization 请求头）

**请求体**：

```json
{
  "tool": "search_products",
  "params": {
    "query": "知识库"
  }
}
```

**可用工具**：

| 工具名 | 说明 | 风险等级 | 所需权限 |
|--------|------|----------|----------|
| `search_products` | 搜索产品 | low | read |
| `get_product_detail` | 产品详情 | low | read |
| `search_agents` | 搜索 AI Agent | low | read |
| `search_companies` | 搜索公司 | low | read |
| `search_solutions` | 搜索方案 | low | read |
| `search` | 统一搜索 | low | read |
| `list_demands` | 需求列表 | low | read |
| `get_demand_detail` | 需求详情 | low | read |
| `match_demand` | 需求匹配 | low | read |
| `create_demand_draft` | 创建需求草稿 | medium | write:demand |
| `submit_proposal` | 提交提案 | medium | write:proposal |

**请求示例**：

```bash
curl -X POST http://localhost:3000/api/mcp \
  -H "Authorization: Bearer iwantu_xxxxxxxx" \
  -H "Content-Type: application/json" \
  -d '{"tool": "search_products", "params": {"query": "知识库"}}'
```

**响应示例**：

```json
{
  "tool": "search_products",
  "result": {
    "products": [...]
  }
}
```

**创建需求草稿示例**：

```json
{
  "tool": "create_demand_draft",
  "params": {
    "title": "需要智能客服系统",
    "industry": "零售",
    "budgetRange": "20-50万",
    "description": "面向售前售后场景的多渠道智能客服",
    "supportPoc": true
  }
}
```

---

## 管理后台 (Admin)

### GET /api/admin/agent-actions

获取 AI Agent 行为审计日志。

**认证**：需要（admin 或 opc_team 角色）

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `userId` | string | 按用户筛选 |
| `action` | string | 按操作类型筛选 |
| `riskLevel` | string | 按风险等级筛选（low / medium / high / critical） |
| `page` | number | 页码（默认 1） |
| `limit` | number | 每页条数（默认 20，最大 100） |

**响应示例**：

```json
{
  "items": [
    {
      "id": "action1",
      "agentId": "mcp:user_supplier1",
      "userId": "user_supplier1",
      "userName": "陈工",
      "userEmail": "supplier1@demo.com",
      "userRole": "supplier",
      "organizationId": "org_zhizao",
      "actionType": "search_products",
      "targetType": "product",
      "targetId": "",
      "riskLevel": "low",
      "decision": "allowed",
      "approvalStatus": "approved",
      "createdAt": "2025-06-05T10:30:00.000Z"
    }
  ],
  "total": 42,
  "page": 1,
  "limit": 20,
  "totalPages": 3
}
```

---

## 用户 (Users)

### GET /api/users/me

获取当前用户资料（含组织名称）。

**认证**：需要

**响应示例**：

```json
{
  "id": "user_buyer",
  "name": "张明",
  "email": "buyer@demo.com",
  "role": "buyer",
  "orgId": "org_xinda",
  "orgName": "鑫达制造集团",
  "phone": "13800000001",
  "createdAt": "2025-01-01T00:00:00.000Z"
}
```

### PUT /api/users/me

更新用户资料。

**认证**：需要

**请求体**：

```json
{
  "name": "张明（已更新）",
  "phone": "13800000002",
  "avatar": "/avatars/user1.png"
}
```

### PUT /api/users/me/password

修改密码。

**认证**：需要

---

## 组织 (Organizations)

### GET /api/organizations

获取组织列表。

**认证**：不需要（公开）

### POST /api/organizations

创建组织。

**认证**：需要

### GET /api/organizations/[id]

获取组织详情。

**认证**：不需要（公开）

### PUT /api/organizations/[id]

更新组织信息。

**认证**：需要（组织成员）

### GET /api/organizations/[id]/members

获取组织成员列表。

**认证**：需要

### POST /api/organizations/[id]/members

添加组织成员。

**认证**：需要（组织管理员）

---

## 供应商 (Supplier)

### GET /api/supplier/leads

获取需求线索（最新的公开需求）。

**认证**：需要（supplier 角色）

---

## 公开 API (Public)

以下 API 不需要认证，供外部访问：

| 方法 | 路由 | 说明 |
|------|------|------|
| GET | `/api/public/products` | 产品列表 |
| GET | `/api/public/products/[id]` | 产品详情 |
| GET | `/api/public/products/[id]/markdown` | 产品 Markdown 格式 |
| GET | `/api/public/agents` | Agent 列表 |
| GET | `/api/public/agents/[id]` | Agent 详情 |
| GET | `/api/public/companies` | 公司列表 |
| GET | `/api/public/companies/[id]` | 公司详情 |
| GET | `/api/public/companies/[id]/markdown` | 公司 Markdown 格式 |
| GET | `/api/public/solutions` | 方案列表 |
| GET | `/api/public/solutions/[id]` | 方案详情 |
| GET | `/api/public/solutions/[id]/markdown` | 方案 Markdown 格式 |
| GET | `/api/public/demands` | 公开需求列表 |

---

## 健康检查

### GET /api/health

服务健康检查端点。

**认证**：不需要

用于负载均衡器和监控系统的健康探针。
