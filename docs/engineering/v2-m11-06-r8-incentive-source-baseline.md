# V2-M11-06 R8 激励事实来源基线（2026-10-23）

## 当前事实边界

R8 `INCENTIVE_FARMING` 首期不直接下舞弊结论。M2 的 `awardProtocolIncentive` 从有限 `system_incentive` 账户借记，向受益 Principal 的 `principal_available` 账户贷记，使用 `ledger_transactions(type=incentive,status=posted,referenceType=protocol_incentive_award)`，分录的 `provenance` 标记 `iwantu-credit-provenance/0.1`、`kind=incentive`、`programId`、`awardId`、`beneficiaryPrincipalId`。交易元数据亦保存 program/award/Principal。奖励事实不等于独立交易，不得把多次合法发奖自动推断为刷激励。

本切片建立 `readIncentiveAwardFacts` 的只读事实层，不发布 R8 风险信号，不创建 I0–I4 处罚动作。数据查询要求主交易 POSTED、源凭证一致、借方来自有限奖励池且与贷方同额、信用方向/币种/受益主体正确；窗口采用 `[windowStart, windowEnd)`；最多 20 个 Principal、500 条奖励凭证，超过上限 Fail-Closed，避免基于截断数据判定风险。每笔事实包含 Principal、programId、awardId、referenceId、交易哈希、入账时刻、IWC 金额。`transactionHash` 仅用于追溯原始已入账事实，不能证明奖励动机。

## 后续 R8 判定设计门槛

1. 先明确具体奖励政策的计奖触发条件及版本化 program 规则。当前 M2 的 `awardProtocolIncentive` 并未强制奖励一定关联某个 Settlement，故不能仅通过奖励次数/金额推断 `INCENTIVE_FARMING`。
2. 真实交易侧仅使用 M9 的终局 Settlement 派生 `ReputationEvidence`，必须排除中间状态、区分独立 Principal，并避免买方和供应方证据重复计数。
3. 对协议上确实可由交易触发的奖励，先建立「奖励凭证 → 不可变触发事件」映射；没有映射的 program 应显示 `attribution_unavailable`，不得自动匹配最近交易。
4. 如开展 R8 v0.1 统计观察，应限定明确窗口、独立对手方样本量、重复奖励比率及证据最低量；频次/集中度只生成可解释统计，不等同欺诈指控。阈值必须随规则版本冻结，避免与 R3/R4/R5 指标混同。
5. 同一个 `referenceId = programId + ':' + awardId` 存在分隔符歧义的潜在协议风险；M2 现存设计未禁止标识中出现 `:`。本切片保留 M2 当前事实结构，不通过拆分 `referenceId` 反推 program/award，而是读取事务元数据和分录 provenance 的双向一致值；未来调整新版本 idempotency key 前须先设计旧凭证兼容策略。

## 验收计划与已知限制

- 可在无数据库依赖环境使用 `node --test tests/v2-m11-incentive-award-facts.test.mjs` 验证输入、查询形状、返回结果拒绝门禁（需要实际 `@prisma/client`，或明确声明本地模拟依赖）。
- 真实 PostgreSQL Gate：独立 `iwantu_test` 数据库进行迁移，用真实 M2 发奖路径创建本金池/奖池/受益 Principal；正例查获奖励凭证，负例排除 Genesis/Purchased/未 POSTED、错误来源、时间边界和非奖励池分录；验证完全不修改 Ledger、ReputationEvidence、Trust。
- 变更不可宣称已实现 R8 检测或资金穿透，不创建处罚动作；原生 Node + Prisma + PostgreSQL + lint + build 未全部执行前标记 `NOT_RUN`，不得以模拟测试冒充端到端通过。

关联：Issue #48（M11），Issue #44（AgentVersion 不可变绑定独立议题）。
