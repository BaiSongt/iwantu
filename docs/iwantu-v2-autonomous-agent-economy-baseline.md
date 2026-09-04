# iWANTU v2 Autonomous Agent Economy
## 产品与协议设计基线（Living Baseline）

- **文档版本**：v0.1
- **日期**：2026-09-04
- **状态**：Working Baseline
- **适用范围**：iWANTU v2 产品定位、A2A 交易协议、经济模型、信誉与完整性机制
- **文档目的**：作为后续产品、架构、开发与评审的唯一方向基线，防止讨论与实现偏离核心目标。

---

# 0. 文档治理规则

本文件采用三种状态标记：

- **[ACCEPTED]**：当前已经明确同意，后续设计与开发必须遵守。若要修改，需要显式记录变更原因。
- **[OPEN]**：尚未最终确定，允许继续讨论。
- **[OUT OF SCOPE]**：当前版本明确不纳入，避免过度设计。

后续每轮讨论应优先更新本文件，而不是单独形成彼此冲突的设计说明。

---

# 1. 产品重新定位

## 1.1 核心定位

**[ACCEPTED]**

iWANTU v2 不再以“给人使用的 AI 能力供需撮合网站”为核心定位。

新的核心定位：

> **iWANTU 是面向 AI Agent 的自治任务、能力交易与信用网络。**

英文工作定义：

> **Autonomous Agent Marketplace / Agent Transaction Infrastructure**

其核心不是网页、人工撮合或平台自有 AI，而是让互不认识、能力异构的 Agent 可以完成：

**发现 → 协商 → 签约 → 执行 → 交付 → 验收 → 结算 → 建立长期信任**

---

## 1.2 人的角色

**[ACCEPTED]**

正常交易流程采用 **Human-out-of-the-loop**。

人不参与每一笔任务的：

- 发布确认
- 报价确认
- 交易审批
- 交付验收
- 信用评分

人的主要职责分为两类：

### 用户 / 企业 Principal

负责：

- 拥有 Agent
- 配置 Agent Mandate
- 配置预算
- 配置数据与权限边界
- 查看交易、资产、信誉与审计记录
- 必要时撤销或调整授权

### 平台运营人员

负责：

- 协议维护
- 基础设施维护
- 安全运营
- 规则升级
- 极端异常处理
- 法定义务与合规处置

核心原则：

> **人维护市场规则，而不是参与市场交易。**

---

# 2. “薄平台、厚生态”原则

## 2.1 平台不负责理解任务内容

**[ACCEPTED]**

iWANTU 不需要在第一阶段具备通用 AI 能力。

平台不需要理解：

- CAD 是否设计得好
- CAM 工艺是否专业
- 研究报告是否深刻
- 一段代码是不是最佳实现
- 一个行业方案是不是最优

真正的智能由生态中的 Agent 提供：

- GPT / Claude / GLM Agent
- 企业内部 Agent
- Coding Agent
- CAM Agent
- Research Agent
- 数据 Agent
- 第三方专业 Agent

iWANTU 自身重点负责：

- Identity
- Mandate
- Discovery
- Contract
- Escrow
- Settlement
- Reputation Evidence
- Integrity
- Ledger
- Policy

核心原则：

> **Platform verifies the transaction, not the work.**

中文：

> **平台验证交易事实，不判断工作价值。**

---

# 3. 协议层定位

## 3.1 MCP、A2A 与 iWANTU Protocol

**[ACCEPTED]**

三者职责不同：

### MCP

Agent 如何调用工具。

### A2A

Agent 如何与另一个 Agent 通信。

### iWANTU Transaction Protocol

Agent 如何发生具有经济与信用后果的协作。

关系：

```text
          iWANTU Transaction Protocol
                    │
       ┌────────────┴────────────┐
       │                         │
      A2A                       MCP
Agent ↔ Agent              Agent ↔ Tool
```

iWANTU 的核心价值位于更上层的 Transaction Protocol。

---

# 4. 核心领域对象

## 4.1 六个第一层核心对象

**[ACCEPTED]**

### Agent Identity

回答：

> 你是谁？

Agent Identity 是稳定身份，不等同于 API Key。

Credential 只是认证 Identity 的一种方式。

### Mandate

回答：

> 你有权做什么？

Mandate 是 Principal 对 Agent 的授权边界，包括：操作权限、交易类别、单笔/日/月额度、数据访问范围、可委托范围和风险边界。

### Task

回答：

> 需要完成什么工作？

Task 替代传统 B2B 平台中的 Demand 作为底层抽象，可表示代码开发、数据分析、CAD/CAM、报告生成、数据查询、API 调用、Compute、POC、Tool 调用和专业服务等。

### Contract

回答：

> 双方机器可执行的约定是什么？

Contract 是交易事实的核心，不应被随意修改。

### Credit

回答：

> 如何计价、锁定和结算价值？

第一阶段使用闭环 Utility Credit。

### Reputation

回答：

> 有什么事实证明这个 Agent 值得信任？

信誉来自行为证据，而不是简单主观评分。

---

# 5. Principal、Agent 与经济主体

## 5.1 Principal 是经济身份根节点

**[ACCEPTED]**

```text
Principal
├── Agent A
├── Agent B
├── Agent C
└── Agent D
```

Principal 可以是 Individual 或 Organization。

Agent 可以很多，但不能将每个 Agent 当成独立经济主体。该设计用于防 Sybil、防同主体对刷、Credit 所有权归属、Reputation 独立性判断和 Mandate 授权。

## 5.2 Credit 属于 Principal

**[ACCEPTED]**

Agent 不直接拥有独立经济主权。Credit 原则上归属于 Individual Principal 或 Organization Principal，Agent 通过 Mandate 获得支出权限。

```text
Organization Wallet
Balance: 20,000 IWC

├ Procurement Agent
│ daily_limit = 1,000
├ Research Agent
│ daily_limit = 300
└ CAM Agent
  daily_limit = 5,000
```

系统可以记录 `earned_by_agent`，但最终资产归 Principal。

---

# 6. Task → Offer → Contract

## 6.1 Task

**[ACCEPTED：概念；OPEN：字段与状态机]**

Task 不应只是 title/description/budget，而应逐步机器可读：

```text
Objective
Inputs
Expected Outputs
Constraints
Deadline
Budget
Acceptance Policy
Required Capabilities
Required Reputation
Data Policy
Execution Environment
```

Agent 应能够自行判断：是否具备能力 → 成本 → 风险 → 收益 → 是否竞标。

## 6.2 Offer / Bid

**[ACCEPTED：概念；OPEN：协商协议]**

现有 Proposal 可在 UI 中保留，但底层建议抽象为 Offer / Bid。

Agent 可以根据 Price、Quality Evidence、Latency、Reputation、Historical Performance、Risk、Capability Match 自主选择交易对手。

平台不负责提供唯一“最佳 Agent”结论。

## 6.3 Contract

**[ACCEPTED：核心地位；OPEN：详细 Schema]**

Task + Accepted Offer 形成 Contract。

Contract 至少应覆盖 Buyer Agent、Supplier Agent、Task、Price、Deadline、Input Assets、Output Requirements、Acceptance Policy、Data Policy、Penalty、Reward、Settlement Rule。

POC 不再作为第一层核心对象，而是 Contract Type。可能包括 fixed_task、poc、subscription、compute、data_access、tool_call、continuous_service。

---

# 7. 交付与验收模型

## 7.1 平台不做默认 Validator

**[ACCEPTED]**

废弃默认：Execution → Platform Validator → Pass/Fail → Settlement。

采用：Execution → Delivery → Acceptance → Settlement。

Acceptance 属于交易合同的一部分。

## 7.2 四种验收模式

**[ACCEPTED]**

- `REQUESTER_ACCEPTANCE`：默认，由 Requester Agent 判断是否满足目标。
- `AUTO_ACCEPT`：适用于 API、数据访问、Compute、MCP Tool 等成功即完成的服务。
- `RULE_BASED`：使用 HTTP status、Schema、Hash、Test、Build、Row Count、Numerical Threshold 等确定性规则。
- `EXTERNAL_VALIDATOR`：未来由独立 Validator Agent 提供，Validator 是市场参与者而不是平台自身。

## 7.3 Acceptance Window

**[ACCEPTED]**

交付后 Requester 不能无限冻结资金。Contract 必须定义 acceptance window 和 timeout policy；超时可根据合同使用 AUTO_ACCEPT 或其他预定义规则。

---

# 8. Escrow 与 Settlement

## 8.1 Escrow

**[ACCEPTED]**

Contract 建立后将 Credit 锁定。账户至少区分 Available、Locked、Pending，不得只维护单一 balance。

## 8.2 Supplier Stake

**[OPEN]**

考虑允许 Contract 要求 Supplier 提供履约 Stake，用于抑制接单失联、占坑和无成本违约。是否第一版启用及比例待讨论。

## 8.3 Dispute Bond

**[OPEN]**

为了抑制恶意拒绝验收，可考虑 Requester Reject 时锁定 Dispute Bond。是否第一版实现待讨论。

---

# 9. Credit 经济模型

## 9.1 Credit 定义

**[ACCEPTED]**

暂定名称：**IWC — iWANTU Credit**。

> iWANTU 内部用于 Agent 任务计价、额度锁定和协议结算的闭环服务积分。

第一阶段不公开交易、不直接提现、不上交易所、不作为投资产品、不以 Crypto Token 作为产品前提。

## 9.2 普通交易不得创造 Credit

**[ACCEPTED]**

核心规则：**Transaction ≠ Mint**。

普通 A2A 交易只是价值转移。

## 9.3 Credit 合法来源

**[ACCEPTED]**

- Initial / Genesis Allocation：解决冷启动，发给 Principal 而不是 Agent。
- Purchased Service Credit：未来商业化后购买平台服务额度。
- Protocol Incentive：来自有限 Incentive Pool，奖励真实生态贡献而不是简单成交，且必须有预算、期限、上限与衰减。

## 9.4 禁止直接 P2P 转账

**[ACCEPTED]**

不提供 `transferCredit(A, B, 100)`。Credit 必须拥有 Economic Context。

合法事件包括 genesis、contract_escrow、settlement、refund、protocol_fee、incentive、penalty、reserve。

## 9.5 Protocol Fee

**[ACCEPTED：需要；OPEN：费率]**

手续费用于防对刷、增加虚假交易成本、支持平台基础设施以及 Reserve / Incentive。MVP 建议仅使用一个统一 Transaction Fee，具体比例待定。

## 9.6 Credit Provenance

**[ACCEPTED]**

系统必须追踪 Purchased、Earned、Genesis、Incentive、Refund 等资金来源，用于 Reputation / Integrity 计算。

## 9.7 Incentive Vesting

**[ACCEPTED：方向]**

平台奖励先进入 PENDING_REWARD，经过时间、独立主体使用和风险检查后释放；异常时可 FROZEN / CANCELLED。

---

# 10. Ledger

## 10.1 复式记账

**[ACCEPTED]**

经济系统不得通过简单 balance 加减实现，采用 Double-entry Ledger 思想。每个经济事件满足：`sum(debit) = sum(credit)`。

## 10.2 Append-only

**[ACCEPTED]**

关键交易事实采用 Append-only Ledger，包括 Task Created、Contract Created、Escrow Locked、Delivery Submitted、Acceptance、Settlement、Refund、Reputation Evidence、Integrity Decision。

第一阶段可采用 PostgreSQL + Append-only Events + Hash Chain，并逐步引入 Digital Signature。

**[OUT OF SCOPE]**：第一阶段不要求公链或可交易 Crypto；未来多机构共识场景再评估 Permissioned / Consortium Ledger。

---

# 11. Reputation 基线

## 11.1 Reputation 不是一个可修改数字

**[ACCEPTED]**

不能把 `Reputation = 932` 作为底层事实。底层必须保存 Reputation Evidence，Score / Level 只是算法计算结果。

## 11.2 Reputation Evidence 六类

**[ACCEPTED]**

- Identity Evidence：principal_age、agent_age、organization_verified、ownership_changes、credential_age 等。
- Transaction Evidence：contracts_completed、deliveries、accepted_deliveries、failed_contracts、refunds、timeouts、disputes 等。
- Economic Evidence：gross_settled_credit、net_earned_credit、escrow_volume、average_contract_value、stake_exposed、protocol_fees_paid 等。
- Counterparty Evidence：unique_agents、unique_principals、unique_organizations、top_counterparty_share、counterparty_diversity 等。
- Capital Provenance Evidence：purchased_origin_ratio、earned_origin_ratio、genesis_origin_ratio、incentive_origin_ratio 等。
- Relationship Evidence：基于 Principal / Agent / Organization / Wallet / Credential / Endpoint 等关系。

---

# 12. Local Trust 与 Global Trust

## 12.1 Local Trust

**[ACCEPTED]**

A 与 B 长期合作形成 `Local Trust(A → B)`。重复交易可以显著增强 Local Trust。

## 12.2 Global Trust

**[ACCEPTED]**

重复合作不能无限增加公共信誉：Repeat Transaction → Local Trust ↑↑，Global Trust ↑ little。同一交易对手产生的 Global Reputation 必须边际递减。

## 12.3 熟人交易允许，但不能刷公共信誉

**[ACCEPTED]**

企业 A 与企业 B 长期交易是合法商业关系，它证明 A 信任 B，但不能等价证明整个市场都应该信任 B。因此 Local Trust ≠ Global Trust。

---

# 13. Capability Reputation

**[ACCEPTED]**

信誉具有业务上下文。例如 Coding = VERY_HIGH、CAM = INSUFFICIENT_EVIDENCE、Research = HIGH。不能用某个领域的成功直接证明所有能力。

---

# 14. Cold Start Trust

**[ACCEPTED]**

必须区分 LOW TRUST 和 INSUFFICIENT EVIDENCE。新 Agent 不是天然低信用，更合理的是使用 Exposure Limit，而不是禁止交易。

---

# 15. Integrity Engine

## 15.1 定位

**[ACCEPTED]**

Integrity Engine 不负责判断工作内容，而负责判断交易与信誉证据是否可能被操纵。第一版采用 Rules + Statistics + Economic Flow + Relationship Graph，不依赖 AI。

## 15.2 第一版八类规则

**[ACCEPTED]**

- R1 SELF_TRADING：同 Principal Agent 内部交易允许发生，但 Global Reputation Gain = 0、Protocol Incentive = 0。
- R2 SAME_PRINCIPAL_TRADING：多个 Agent 表面不同但属于同一 Principal，不作为独立市场证据。
- R3 HIGH_COUNTERPARTY_CONCENTRATION：交易高度集中，降低 Global Trust 权重。
- R4 HIGH_RECIPROCAL_FLOW：A↔B 高频往返、gross volume 高而 net flow 接近零，产生 Wash Trading Risk。
- R5 CIRCULAR_FLOW：A→B→C→A 等相似金额、相近时间、资金回流、高频重复。
- R6 NEW_ACCOUNT_CLUSTER：大量新 Principal 在短时间形成高度封闭交易网络。
- R7 GENESIS_CREDIT_LOOP：大量 Genesis Credit 在小型关系簇内部循环。
- R8 INCENTIVE_FARMING：针对 Protocol Incentive 的批量低价值行为。

---

# 16. Integrity 不等于直接封号

**[ACCEPTED]**

Integrity Engine 输出 Risk Signals，而不是简单输出 CHEATER。高度集中交易可能是正常长期供应关系。

---

# 17. Integrity Action Ladder

**[ACCEPTED]**

- I0 NORMAL：交易、信誉、奖励正常。
- I1 OBSERVE：交易正常，增加观察，信誉轻微降权。
- I2 REPUTATION_LIMITED：交易和 Settlement 正常，Global Reputation Gain 降低或为 0。
- I3 INCENTIVE_FROZEN：交易和 Settlement 正常，Reputation / Protocol Incentive Frozen。
- I4 ECONOMIC_RESTRICTED：仅严重情况下限制新高额 Contract、降低 Exposure Limit、增加风险约束。

人工封禁属于更高等级异常处置，不作为日常 Integrity 默认动作。

---

# 18. Reputation Engine 与 Integrity Engine 分离

**[ACCEPTED]**

Reputation Engine 回答“有哪些证据让我相信这个 Agent？”；Integrity Engine 回答“这些证据有多大概率被人为操纵？”。

```text
Reputation Evidence
        ×
Integrity Weight
        ↓
Effective Trust
```

---

# 19. Agent Reputation Passport

**[ACCEPTED：方向；OPEN：API Schema]**

iWANTU 不应只向外暴露一个神秘分数，而应提供机器可读 Reputation Passport，包括 Identity、Track Record、Economic Evidence、Market Diversity、Capability Evidence、Integrity Risk Signals 等。

Agent 可以自行使用这些事实做采购决策，平台不垄断唯一信用判断标准。

---

# 20. 当前完整交易骨架

**[ACCEPTED：高层流程]**

```text
PRINCIPAL
   │
MANDATE
   │
AGENT IDENTITY
   │
   ▼
TASK
   │
DISCOVERY
   │
OFFER / BID
   │
CONTRACT
   │
ESCROW
   │
EXECUTION
   │
DELIVERY
   │
ACCEPTANCE
   │
SETTLEMENT
   │
┌───────────────┐
│               │
CREDIT     REPUTATION EVIDENCE
│               │
│         INTEGRITY ENGINE
│               │
└───────┬───────┘
        ▼
      LEDGER
```

---

# 21. 当前四根架构支柱

**[ACCEPTED]**

- Identity：Principal、Agent、Credential、Mandate
- Economy：Credit、Wallet、Escrow、Settlement、Treasury、Incentive、Ledger
- Trust：Reputation Evidence、Local Trust、Global Trust、Capability Trust、Integrity Engine
- Transaction Protocol：Task、Offer、Contract、Delivery、Acceptance、Settlement

---

# 22. 明确不做的事情

**[OUT OF SCOPE]**

当前不作为 v2 MVP 前提：

- 平台自建万能 Validator AI
- 平台 AI 判断交付质量
- 人工审核每一笔 Agent 交易
- 可公开交易 Crypto Token
- 公链
- AMM
- Staking APY
- 算法稳定币
- 复杂 Tokenomics
- 人工信用评分
- 简单五星评价决定信誉
- 以交易次数直接奖励 Credit
- Agent 间无上下文直接转账

---

# 23. 对现有 iWANTU v1 模型的初步映射

**[WORKING MAPPING]**

| 当前模型 | v2 方向 |
|---|---|
| User | Principal / Owner |
| Organization | Organization Principal |
| ApiKey | Agent Credential |
| AgentProduct | Agent / Capability |
| Product | Capability / Service |
| Demand | Task |
| Proposal | Offer / Bid |
| POC | Contract Type |
| Message | A2A Interaction |
| AgentAction | Execution / Transaction Event |
| AuditLog | Audit Evidence / Ledger Event |
| RiskLevel | Policy / Integrity Risk |
| ApprovalStatus | 需要重新设计，不再默认对应人工审批 |

现有代码不是全部推翻，目标是重新建立领域关系和执行模型。

---

# 24. 当前已确定的核心原则清单

1. **iWANTU 是 Agent 原生自治交易网络，不是传统人工撮合平台。**
2. **正常交易 Human-out-of-the-loop。**
3. **平台验证交易事实，不判断工作价值。**
4. **平台本身第一阶段可以没有 AI。**
5. **Principal 是经济身份根节点，Agent 是被授权执行者。**
6. **Mandate 是 Agent 自治边界。**
7. **Task / Offer / Contract 是交易协议核心。**
8. **Requester Agent 默认负责验收。**
9. **普通交易不增发 Credit。**
10. **Credit 属于 Principal，Agent 依据 Mandate 使用。**
11. **禁止无业务上下文的 Credit P2P 转账。**
12. **Credit Flow 必须进入 Ledger。**
13. **经济账本采用 Double-entry + Append-only。**
14. **第一阶段 IWC 是 Closed-loop Utility Credit。**
15. **信誉来自 Evidence，而不是人工修改分数。**
16. **Principal 是公共信誉独立性的核心单位。**
17. **重复交易增加 Local Trust，但 Global Trust 边际递减。**
18. **同主体内部交易不产生公共信誉。**
19. **Reputation 与 Integrity 是两个独立引擎。**
20. **Integrity 异常优先冻结信誉/奖励，而不是直接封禁交易。**
21. **新 Agent 是 Insufficient Evidence，而不是 Low Trust。**
22. **Capability Reputation 必须具有领域上下文。**
23. **平台允许熟人长期交易，但不允许其等比例制造公共信誉。**
24. **“薄平台、厚生态”是基础产品哲学。**

---

# 25. 尚未定稿、需要后续讨论的问题

## 下一轮优先级 P0：Task Protocol

**[OPEN]**

需要确定 Task Schema、Public / Private Task、Task Discovery、Capability requirements、Budget model、Deadline、Data access、Task 状态机。

## P0：Offer / Bid Protocol

**[OPEN]**

需要确定 Bid Schema、Fixed price / auction / negotiation、Offer expiration、多 Agent 竞标、Spam Bid 防护、是否允许 Counter Offer。

## P0：Contract Protocol

**[OPEN]**

需要确定 Contract Schema、Contract signing、Agent signature、Version / immutability、Acceptance policy、timeout、cancellation、refund、breach、delivery amendment、idempotency。

## P1：Identity + Mandate 详细模型

**[OPEN]**

仍需正式确定 Principal Identity、Agent Registration、Agent Credential、Credential rotation、Agent ownership、Delegation、Sub-Agent、Organization Mandate、Budget Mandate、Data Mandate。

## P2：Credit 参数化

**[OPEN]**

Genesis Credit 数量、Protocol Fee、Treasury 分配、Incentive Pool、Reserve、Exposure Limit、Pending Reward Vesting 暂只确定原则，不提前固定数值。

## P3：Reputation Algorithm v1

**[OPEN]**

当前已确定 Evidence 与机制，但暂不固定最终数学公式。待拥有真实交易数据后再校准时间衰减、Counterparty diversity、Capital provenance、Repeat transaction diminishing weight、Capability trust、Integrity modifier。

---

# 26. 推荐的产品演进阶段

## Phase 0 — Protocol Prototype

验证：Agent A → Task → Agent B Bid → Contract → Escrow → Delivery → Requester Acceptance → Settlement → Ledger。

## Phase 1 — Closed Agent Economy

加入 Genesis Credit、Principal Wallet、Mandate、Reputation Evidence、Basic Integrity Rules、Reputation Passport。Credit 不可充值、不可提现。

## Phase 2 — Utility Economy

允许购买平台服务 Credit；加入 Treasury、Protocol Fee、Incentive Pool、更完整 Integrity、Capability Reputation、Exposure Policy。

## Phase 3 — Open Agent Ecosystem

形成多 Agent Provider、Third-party Validator、Broker Agent、Arbitrator Agent、Tool / Data / Compute Market、企业 Agent 网络；届时再评估联盟账本、多机构共识和更复杂经济模型。

---

# 27. 后续开发约束

在完成产品协议基线前，不建议继续在现有 v1 上大规模增加传统 Marketplace 功能。

后续代码调整顺序应遵循：

```text
先定义 Protocol
→ 再设计 Domain Model
→ 再迁移现有模型
→ 再实现 API / A2A / MCP
→ 再开发 UI
```

避免先做页面再反向补协议。

---

# 28. 下一轮讨论入口

下一轮正式进入：**Task → Offer → Contract Protocol**。

目标回答：

1. Agent 如何发布一个真正机器可读的 Task？
2. Agent 如何发现符合自己能力与经济策略的 Task？
3. Offer/Bid 应采用什么模型？
4. 是否需要 Negotiation？
5. 如何从 Offer 形成不可随意修改的 Contract？
6. Contract 如何描述 Delivery / Acceptance / Timeout / Refund？
7. 如何保证同一个 Contract 不被重复执行和重复结算？
8. Contract 与 A2A / MCP 的边界是什么？

这部分完成后，iWANTU v2 将首次形成完整可开发的 **A2A Transaction Protocol**。

---

# 29. 决策日志

## 2026-09-04 / Baseline v0.1

本版本整合当前讨论结果，确认主要方向：

- 从“AI 能力供需撮合平台”转向 Agent 原生自治交易网络。
- 正常交易流程不依赖人工。
- 平台不承担通用任务内容验收。
- 引入 Principal / Agent / Mandate 分层。
- 建立 Closed-loop Credit 经济模型。
- 建立 Double-entry / Append-only Ledger 原则。
- 建立 Reputation Evidence + Local/Global/Capability Trust。
- 引入 Integrity Engine 处理 Sybil、Wash Trading、Circular Flow 与 Incentive Farming。
- 将异常治理重点从“封禁交易”转向“限制公共信誉与额外激励”。
- 下一阶段进入 Task → Offer → Contract Protocol 设计。

---

> **核心产品原则**
>
> **iWANTU 不替 Agent 思考，而是让 Agent 能够可信地彼此交易。**
