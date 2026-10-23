# iWANTU V2-M11-06｜R8 激励触发归因协议 RFC v0.1

状态：**PROPOSED / 待协议评审**（2026-10-24）。这是后续开发约束草案，**不是已部署能力或已经冻结的 R8 检测阈值**。

关联：Issue #48；与执行 AgentVersion 绑定 Issue #44 保持职责独立。

## 1. 实测代码与数据库事实

已对照 `master` 的 M2 `awardProtocolIncentive`、`postLedgerTransaction`、`buildCreditProvenance`，以及 M5/M9 迁移审查：

- 标准奖励由 `system_incentive` 借方和受益 Principal 的 `principal_available` 贷方组成；`ledger_transactions` 是 `type=incentive,status=posted,referenceType=protocol_incentive_award`，`ledger_entries.provenance` 的版本为 `iwantu-credit-provenance/0.1`。
- 奖励幂等键当前为 `credit:incentive-award:<programId>:<awardId>`，事务 `metadata` 保存 programId/awardId/beneficiaryPrincipalId，`details` 来自调用者的可选 metadata。
- M5/M6/M8 的终结 `settlements` 具有 `id`、`contractId`、`type`、`settlementHash`、`ledgerTransactionId`；M9 的 `reputation_evidence` 由终结 Settlement 派生，不接受中间 REJECT/REWORK 直接作为交易事实。
- **现有 M2 奖励协议没有“奖励 → 某一不可变触发事件”的强制引用或数据库验证。** 调用者填入 `metadata.details.settlementId`，即使入账哈希中包含该字段，也只是自述，不能证明当时满足政策条件，不能用于自动 R8 风险归因。
- `readIncentiveAwardFacts` 已提供只读标准奖励事实，明确返回 `triggerEventAttribution=unavailable`、`r8RiskEvaluationEligible=false`。保留此 Fail-Closed 默认值，直到新协议通过真库 Gate。

## 2. 边界与决策

**建议采用“前瞻式新增绑定收据 + 旧奖励继续不归因”的分阶段方案**，不要修改或回填既有已 POSTED LedgerTransaction / LedgerEntry / ReputationEvidence。

首批只处理确实由终结 Settlement 触发的奖励计划（`triggerType=terminal_settlement`）。开户、文档贡献等非结算奖励并非天然可疑；对非结算计划返回 `not_applicable`，对未知/旧策略返回 `unavailable`，不能把缺失归因等同违规。

新增协议候选名称：`iwantu.incentive-trigger-binding/0.1`。**绑定收据本身是不可变的协议事实**，而非从当期数据库查询或模糊时间邻近关系推断出的缓存。

建议收据至少包含：

| 字段 | 必须验证的含义 |
| --- | --- |
| `awardLedgerTransactionId`、`awardTransactionHash` | 恰好一笔已 POSTED 的标准双分录奖励及规范交易哈希 |
| `programId`、`programPolicyVersion`、`programPolicyHash` | 当次发奖所依据的已冻结计奖规则及其摘要，而非目前可变的活动配置 |
| `awardId`、`beneficiaryPrincipalId`、`amountIwc` | 与已入账奖励的元数据、分录受益者和定点金额严格相等 |
| `triggerType`、`settlementId`、`settlementHash` | `terminal_settlement` 时绑定同一条已形成的终局 Settlement 原始哈希 |
| `triggerEvidenceHash`、`receiptHash`、`createdAt` | 绑定原始证据、规范化哈希、收据创建时刻；精确重放身份稳定 |
| `authorityEvidence` | 使用何种已验证的政策/授权路径允许该主体领取该奖励；不能由调用者自填“已授权”布尔值 |

新增收据表候选 `incentive_award_trigger_bindings`：以奖励 LedgerTransaction 为唯一键，使用到 `settlements` / `ledger_transactions` 的限制删除外键。应用和 PostgreSQL 都必须拒绝收据 UPDATE/DELETE、跨主体绑定、哈希不匹配、非终局/不存在的 Settlement、非标准奖励交易。规则依赖的字段必须以事务内数据库事实复算，不能仅信任 API 传入 JSON。

如业务规则允许同一 Settlement 对同一 Program 的多个合法奖励，应由**版本化政策**决定唯一性粒度；不得在未核实政策前一律设成“每个 Settlement 只能奖励一次”。

## 3. 新的规范发奖边界（待设计审查）

对需要结算触发的**新**发奖命令，建议设置独立入口 `awardProtocolIncentiveForSettlement`，不复用可填写任意 metadata 的旧接口冒充已验证链路：

```text
实际终局 Settlement（不可变事实）
  → 查询冻结 ProgramPolicy(version/hash/eligible outcomes/领取主体/时间窗/额度)
  → 验证触发条件、受益 Principal、live Authority/Policy 与可审计证据
  → 规范奖励命令与确定性幂等标识
  → 在同一原子数据库事务中：
       按既有 M2 Ledger 并发/锁顺序使用 postLedgerTransactionInTransaction
       + 写入不可变 IncentiveTriggerBinding 收据
  → 同时提交或同时回滚
  → M11 只读消费已验证的奖励 + 触发收据
```

不得创造第二条账本锁顺序。由于原有 M4/M5 交易形成/结算也存在锁顺序和并发门禁，正式实现前应评审 Settlement 行锁、Ledger 全局 advisory lock 与奖池账户锁的获取顺序及重试策略；不能仅靠“同一个事务”宣称不会死锁。事务提交前由数据库独立核验奖励分录/收据/Settlement/策略哈希的一致性。

现行 `programId:awardId` 存在 `:` 分隔符歧义：例如不同的 (programId, awardId) 组合可能产生相同 referenceId。**新协议必须使用无歧义的规范编码或显式拒绝分隔符歧义**；既有凭证保留历史含义，不重写 Ledger 哈希或幂等键。新旧机制以协议版本和收据存在性区分，不能对旧奖励静默“升级”。

## 4. R8 判定资格与解释性输出

R8 检测前需先验证触发收据、Policy 快照、终局 Settlement、交易哈希和独立 Principal 关系；不能将奖励次数、同一主体多次领奖或合法集中交易直接判定为 `INCENTIVE_FARMING`。

| 观察状态 | 结果 | 允许的处理 |
| --- | --- | --- |
| 旧奖励、缺失政策或缺失可信绑定 | `unavailable` | 只读展示金额/来源，不进入自动 R8 风险分类 |
| 明确无需结算触发的合法 Program | `not_applicable` | 独立统计，不假装有关联的 Settlement |
| 新协议有效绑定 + 政策可验证 | `verified` | 才可进入 R8 v0.1 统计候选；仍不是欺诈定论 |
| 收据伪造、跨主体、哈希不一致、时间反转 | `invalid` | Fail-Closed；保留审计失败，不发合格风险信号 |

统计门槛应在真库样本与假阳性评估后**另行冻结** `ruleVersion`：样本最小量、独立对手方数、同策略重复收益、奖励/终局结算关系以及窗口定义必须具备可解释的证据分母。不得把 R3/R4/R5 关系风险替代为 R8 的实际激励归因，也不得因为存在 R8 信号自动执行 I0–I4 经济处罚。信用是可替代余额；该归因只能证明政策触发关系，**不代表追踪到具体 IWC 资金的穿透来源**。

## 5. 分期开发与验收门禁

**R8-B1（下一独立切片）**：先实现纯函数 Policy/Trigger 收据结构校验与规范化哈希，含必填字段、跨主体、金额/日期、重复与歧义引用的负例；不增加生产写入，也不改变原有奖励行为。

**R8-B2**：新增带外键和数据库保护的不可变收据表/迁移；验证 UPDATE/DELETE/伪造/重复拒绝，迁移仅创建新结构，不清理数据、不强行回填旧奖励。

**R8-B3**：使用既有 `postLedgerTransactionInTransaction` 和确定性政策快照完成规范发奖与收据的原子写入。经授权、政策检查与账本预算校验；注入异常保证资金与收据同时回滚，并发重放 exactly-once。

**R8-B4**：R8 只读检测严格仅消费 `verified` 的触发收据与 M9 终局证据。先校验正例、无绑定/旧计划/合法集中关系的负例，再经过人工评审冻结策略阈值。默认 Signal-only，不写 Ledger / ReputationEvidence / Trust、不自动执行 I0–I4。

**必须给出 exact HEAD 的证据**：相关 Node invariants、`prisma:validate`、ESLint、Typecheck、Build、独立 `iwantu_test` PostgreSQL E2E、重复执行、并发、伪造/篡改、防重复奖励、不同奖励计划及跨主体场景。真库 Gate 未执行前一律标记 NOT_RUN。既有 R8 事实层及测试属于早期切片，**不得据此将 R8 检测标记 COMPLETE**。

## 6. 与其他阶段的边界

Issue #44 的执行 AgentVersion 绑定需要在经济签名/交付证据链独立解决；R8 触发收据不能从当前 AgentVersion 状态推断历史执行者。M11-07 的动作等级只能先做可解释投影及 Passport 展示，任何冻结/限权都需要独立安全、授权与申诉门禁。Legacy V1→V2 兼容适配应在这些底层协议契约稳定后分阶段上线。

**本 RFC 当前仅供审查，不代表实现、测试通过、合并或实际处罚授权。**

## 7. R8-B1 实施记录（2026-10-24）

本分支新增纯函数候选收据模块 next-app/src/lib/integrity/incentive-trigger-binding-draft.mjs 和对应 Node 单元测试。采用 iwantu.incentive-trigger-binding/0.1 协议标签；规范化并检查账本交易 ID/哈希、ProgramPolicy 版本/哈希、受益 Principal、Decimal(36,8) IWC 金额、终局 Settlement ID/哈希、触发证据摘要、授权引用与 UTC 创建时间；对完整的规范化 JSON 计算 SHA-256 候选收据摘要。键顺序重排不改变哈希，篡改数值与绑定主体会改变哈希或拒绝输入。新协议 programId/awardId 禁止冒号等分隔符歧义，但不改写历史 M2 奖励。

**重要边界：** policy_authorization_reference 只是未验证的授权引用。B1 的结构检查和哈希计算不能证明政策获准、Settlement 存在、授权有效或奖励与触发事件存在真实关联。B1 不使用 Prisma、不写入 Ledger 或 PostgreSQL，也不产生 R8 Signal、信任评分或 I0–I4 处罚。B2/B3 必须再由数据库不可变事实复核这些绑定条件、原子性与重放幂等；本模块的候选 receiptHash 不得当作已认证经济事实。

**独立验收：** 已在隔离目录使用 Node.js v22.16.0 对与 GitHub blob SHA 一致的模块/测试文件运行原生 node --test，结果 7/7 PASS；两个文件 node --check PASS。B1 已接入 test:invariants 和 lint:m11，单独入口 npm run test:m11:r8-b1。完整仓库 invariants、Prisma Validate、ESLint、Typecheck、Build、PostgreSQL E2E 为 NOT_RUN，不能据纯函数用例声称全链路已通过。B2 数据库迁移只允许增加新结构，不删除用户数据、不覆盖历史账本。

本 RFC 整体状态依旧为 PROPOSED。B1 是尚未评审合并的候选协议切片，不代表 R8 已能够识别激励套利。
