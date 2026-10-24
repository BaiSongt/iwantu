# iWANTU V2-M11-06｜R8-P1h 跨版本权益兼容核验与历史预算证据审计

日期：2026-10-24。Issue #48。状态：**PROPOSED / 候选只读校验已实现；可信治理、数据库唯一性及发奖授权未实现**。Issue #44 独立跟踪。

## 1. 对现有实现的核查

代码核查基线：`master` `d80e88e35af30e4473aa7eeffde91dcf8d953d09`；R8 分支在 P1g 之后追加 P1h。已查看 M2 `incentive-awards.mjs`、`incentive-award-facts.mjs`、`incentive-program-policy-draft.mjs`、`incentive-authorization-intent-draft.mjs`、`incentive-program-entitlement-draft.mjs`、Prisma schema 和 M1/M3 签名证据边界。

- M2 `awardProtocolIncentive()` 的真实幂等键是 `credit:incentive-award:{programId}:{awardId}`，不会自动阻止同一 Settlement 更换 `awardId` 再发奖。
- P1b `iwantu.incentive-award-deduplication/0.1` 同时含 `policyVersion` 与 `policyHash`，换版后会形成新的去重键；旧候选政策 `deduplicationScope=program_policy_settlement_role_slot` 是明确的历史签名语义，**不能静默改写**。
- P1g `iwantu.incentive-program-entitlement/0.1` 从 `programId + settlementId + beneficiaryRole + awardSlot` 派生跨版稳定权益指纹。当前仅是内存候选值，未建立 PostgreSQL 唯一键及真实受益角色审查。
- `readIncentiveAwardFacts()` 仅返回满足完整来源条件、时间窗口、Principal 范围和最多 500 条上限的奖励样本。**该有限过滤结果绝不能作为 Program 历史支出总额或已用预算**：无效/未关联/超出窗口的 POSTED Incentive Ledger 项可能被过滤掉，不能按 0 处理。
- `next-app/prisma/schema.prisma` 当前没有可信 Program 治理注册、政策冻结、预算修订、签名授权收据和稳定权益数据库唯一约束。因此不存在可直接用于发奖的权威 Program 注册表。

## 2. 本轮最小代码切片

新增 `next-app/src/lib/integrity/incentive-entitlement-bridge-draft.mjs`，以及 `next-app/tests/v2-m11-incentive-entitlement-bridge-draft.test.mjs`，对应独立命令 `npm run test:m11:r8-p1h`，同时接入 `test:invariants` 与 `lint:m11`。

`inspectIncentiveEntitlementBridgeDraft()` 对现存 P1b 发奖候选意图执行严格对象形状、动作、IWC 金额格式与哈希交叉检查：重算 `payloadHash`、旧政策版本级 `deduplicationFingerprint`，再调用现有 P1g 生成 **独立的** Program 级权益键。即使政策版本、政策哈希、`awardId`、金额或受益 Principal 改变，新权益键仍由 Program/Settlement/角色/槽位稳定确定；跨 Program 或真实不同权益则不同。

**输出始终是审查性结果**：`governanceStatus=not_checked`、`policySnapshotStatus=not_verified`、`authorizationStatus=not_checked`、`databaseUniquenessStatus=not_checked`、`economicWritePermitted=false`、`r8RiskEvaluationEligible=false`。它既不证明候选政策真实生效，也不鉴别 Settlement 与受益 Principal 的真实绑定，不构成任何 R8 舞弊推断或处罚依据。旧 P1b v0.1 哈希未改动。

## 3. 待冻结的 B2 决策

1. **Program 注册信任根**：注册只能由已明确批准的治理 Principal/受控流程签名，不能凭 `issuerPrincipalId` 自述。初始注册与治理授权修订应分别有不可变证据；具体治理主体、密钥生命周期和恢复方案尚待评审，**不在代码中假设平台超级权限**。
2. **政策修订与跨版本唯一权益**：发布新协议版本和有治理签名的政策修订，明确单个 `(programId, settlementId, beneficiaryRole, awardSlot)` 允许的一份权益，不能仅在旧 P1b 哈希上建立 UNIQUE。额外合法发奖需独立可审计的槽位/政策语义。
3. **历史支出预算**：在 Ledger 全局锁保护内以全部 POSTED 激励支出为核算基础，建立不因旧记录缺失签名归因而低估支出的保守策略。必须考虑不同版本、无效 provenance、悬空元数据、重复 awardId、退款/冲正等事实；有无法归类支出时在预算授权上 **Fail-Closed**，而非绕开。
4. **完整原子写入**：服务端真实签名凭据、实时 Mandate、治理资格与精确经济限额、政策生效、终局 Settlement、Nonce/权益唯一键和预算/奖池余额，应在同一确定锁序的事务内核对、捕获快照并调用 M2 唯一账本写路径。任一失败整笔回滚。
5. **反舞弊与信誉分离**：旧奖励缺少触发绑定收据时维持 `attribution_unavailable`；不给历史 Ledger 补写伪证。数据库校验通过也不自动发布 R8 信号或执行 I0–I4 经济处罚。
6. **AgentVersion**：Issue #44 仍需在签名的经济执行证据中冻结实际版本；不从最新 AgentVersion 反推历史执行者。

## 4. 验收记录与下一步

本轮在本地 Node.js v22.16.0 对新模块执行 `node --check` 和 8 组原生 Node 正反例：**8/8 PASS**。隔离环境使用从远端核对的 P1g 源码与等价的 M1 规范 SHA-256 helper；这**不是**完整的实际 P1a/P1b/M1 集成测试。完整 Node invariants、Prisma Validate、ESLint、Typecheck、Build、独立 PostgreSQL E2E 均 **NOT_RUN**，不能认定 B2/PostgreSQL 通过。

下一切片优先做 Program 注册治理权的信任根 ADR、历史 Ledger 全样本预算源审计和 B2 不可变数据库键/触发器方案。禁止直接让本桥接结果进入经济写路径；后续真库测试须独立测试库，不操作用户数据。
