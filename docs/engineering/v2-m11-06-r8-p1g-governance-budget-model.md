# iWANTU V2-M11-06｜R8-P1g Program 治理与跨版本预算、权益边界评审

状态：**PROPOSED / 无可信持久化、无经济写入授权**。日期：2026-10-24。对应 Issue #48；执行 AgentVersion 的历史证据绑定继续由 Issue #44 独立处理。

## 1. 源码证据与本轮发现

基于 `master` `d80e88e35af30e4473aa7eeffde91dcf8d953d09`、R8 开发分支 P1a–P1f、`next-app/prisma/schema.prisma` 和现有 M2 发奖入口审查：

- 现行 Prisma schema **没有**可信 IncentiveProgram、ProgramGovernanceAssignment、政策修订或 Program 总预算事实；`awardProtocolIncentive` 接受 `programId`/`awardId`/金额并调用 M2 账本写入，不能证明治理发布者、签名政策及 Settlement 归因。
- P1a 候选政策中的 `issuerPrincipalId` 是签名载荷字段，不是受监管 Program 的治理权证明；P1d/P1e 只做凭据及当前 Mandate action 预检，不证明 Program 归属。
- P1f 使用 BigInt 对外部声明的三项额度做算术，**不查询可信预算**；任何通过均不能转为经济授权。
- **跨版本重复奖励缺口**：P1b `iwantu.incentive-award-deduplication/0.1` 指纹包括 `policyVersion`、`policyHash`。如果未来数据库仅对此键设置唯一索引，同一 Program/Settlement/角色/槽位换一个政策版本即可另发一笔。该行为未必是舞弊，但未经独立治理授权不得默认为合法。

## 2. 必须由治理决策明确的协议问题

| 决策 | 建议的安全默认值 | 尚未形成的权威证据 |
| --- | --- | --- |
| Program 身份 | `programId` 注册一次并具有不可变的初始治理主体；不从政策 `issuerPrincipalId` 反向创造 Program | 信任根/注册签名、身份与注册收据 |
| 治理权更替 | 以追加授权与追加撤销事件变更，记录效力时间；历史已生效政策与收据不修改 | 验签后的治理授权链与吊销事实 |
| 发布与发奖 | `incentive.policy.publish` 与 `incentive.award.issue` 是独立能力；Mandate 必须显式给出对应 action，且检查 Program 治理或执行资格 | 实时认证/Mandate、Program 授权、冻结 AuthoritySnapshot |
| 预算 | Program 稳定身份下的**全版本共享额度**；增额只能追加签名预算修订，不得将每个 `policyVersion` 当作新预算 | 程序预算注册/修订凭据、已 POSTED 支出事实 |
| 重复权益 | 默认一个 `(programId, settlementId, beneficiaryRole, awardSlot)` 只能领取一次，跨政策版本仍同一权益；若业务允许第二份奖励，必须由治理政策定义独立且可审计的 `awardSlot` | 版本化权益策略、数据库唯一键和冲突规则 |
| 资格时间 | 绑定**服务端可核验**的终局 Settlement 事件时间及当时生效的冻结政策；时间边界前闭后开 | 实际 Settlement 时间字段/终局事件约束审查 |
| 历史奖励 | 缺少签名政策/授权/绑定收据一律保留 `attribution_unavailable`，不回填伪造治理事实 | 完整新协议写入链 |

这些是**待评审的协议方案**，不能宣称已经取得监管认可或上线。P1a 的旧 `deduplicationScope=program_policy_settlement_role_slot` 与此建议不同；升级必须单独发布协议版本并得到真实政策治理授权，**不得静默修改既有 v0.1 哈希或签名证据**。

## 3. 新增 P1g 候选权益指纹（无数据库副作用）

新增：
- `next-app/src/lib/integrity/incentive-program-entitlement-draft.mjs`
- `next-app/tests/v2-m11-incentive-program-entitlement-draft.test.mjs`

协议草案：`iwantu.incentive-program-entitlement/0.1`。输入严格只接受 `programId`、`settlementId`、`beneficiaryRole`、`awardSlot`，以排序后 JSON + SHA-256 生成候选指纹；与 P1b v0.1 的**政策版本级**指纹并存，不篡改旧摘要。

同一稳定权益可以由不同 `policyVersion`、`awardId`、收款 Principal 和金额声称；这些字段**不允许加入**该函数的稳定身份，以免通过改写字段绕开候选重复识别。真实受益 Principal 是否合法仍须逐项查询 Settlement/角色/签名政策，不由该指纹判断。不同 Program、Settlement、角色和受监管槽位可生成不同指纹。

此函数**不接受数据库查询结果作为权威**，不验证 Program 已注册、Settlement 已终局或奖励真的发生，且固定返回 `governanceStatus=not_checked`、`storageUniquenessStatus=not_checked`、`economicWritePermitted=false`、`r8RiskEvaluationEligible=false`。它不是防重放或风险规则，不会执行经济处罚。

## 4. 拟议 PostgreSQL 事实模型（本轮未迁移）

1. `IncentiveProgram`：稳定 `programId` 唯一、注册治理 Principal、可信注册凭据哈希/时间；先确定谁有权创建 Program，严禁自述 root。
2. `IncentiveProgramGovernanceGrant` + `GovernanceRevocation`：追加式授权链/撤销事件，Program、被授权 Principal、action、有效期、注册/父授权证据及签名绑定；不修改先前治理证据。
3. `IncentiveProgramBudgetRevision`：Program 共享预算，额度与版本化策略/治理签名绑定；历史预算修订不可变，不能凭 JSON 计数器得出余额。
4. `IncentiveProgramPolicyRevision`：`(programId, policyVersion)` 唯一，政策哈希、时间、治理发布授权收据及前序哈希；生效窗口冲突的裁决规则必须先冻结。
5. `IncentiveAwardAuthorizationReceipt` + `IncentiveAwardTriggerBinding`：签名命令/Nonce、当时的 AuthoritySnapshot、冻结政策、终局 Settlement、LedgerTransaction/hash、额度与实际受益 Principal 的不可变关系；稳定权益指纹数据库唯一且与幂等命令指纹分开。

对所有不可变事实使用 `ON DELETE RESTRICT`、数据库阻止 UPDATE/DELETE、唯一索引及关系校验；不同命令使用同一 Nonce 应拒绝或返回**完全相同**的既有收据，绝不用旧凭据覆盖新载荷。Database 侧的验证不能只信任 `verified=true` 或哈希文本本身。

## 5. 预算、锁序与原子事务

提议计算 `remaining = authorizedProgramBudget - SUM(本 Program 已 POSTED 的有效奖励)`，所有金额按 Decimal(36,8) → BigInt 最小单位处理，禁止浮点和跨版本重置。必须核对授权时生效的预算修订、**含跨版本/跨政策奖励的实际 Ledger**以及有限 `system_incentive` 池，并明确历史异常/缺失绑定奖励计入预算的保守策略。由于现有 M2 允许无新收据的历史发奖，预算查询必须避免把这类已 POSTED 支出当成 0。

B3 经济写路径必须在同一 PostgreSQL 事务中复查签名与实时 Mandate、治理资格、精确额度、政策、终局 Settlement、Nonce、唯一权益与 Ledger 余额，然后保存快照/收据/双分录；失败必须整体回滚。沿用 M2 全局 ledger advisory lock → 账户行锁的现成序列；**Program 行锁与 Settlement/Contract 锁加入后的全局顺序尚未证明无死锁，必须先绘制实际调用图并进行并发真库测试**，不能为了新预算引入反向锁顺序。

## 6. 验证边界与下一开发阶段

本切片仅有候选身份计算 + **7 组原生 Node 正反例**，覆盖规范化、跨版本字段规避、跨 Program/Settlement 隔离、无效角色、标识歧义及伪造授权字段。已与开发分支文件内容回读比对；完整 Node invariants、Prisma Validate、ESLint、Typecheck、Build、PostgreSQL E2E 按独立运行结果报告，未执行不得宣称 PASS。

**下一步**：对 Program 注册信任根、预算跨版本基准、政策修订生效规则与历史已入账支出处理做正式评审；再分独立 B2 小切片补 PostgreSQL 不可变迁移、真库负例及唯一约束，之后才允许 B3 签名原子发奖。R7 的 Genesis 来源真库验证继续独立处理，M11-07/I0–I4 不得抢跑自动经济处罚。
