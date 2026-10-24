# iWANTU V2-M11-06｜R8-P1i 历史 POSTED 激励支出覆盖审查

日期：2026-10-24。对应 Issue #48；AgentVersion 历史执行绑定仍由 Issue #44 跟踪。状态：**只读候选审计已实现，PostgreSQL 真库与可信预算授权未通过**。

## 1. 问题与审查基线

本轮核验的 `master` exact HEAD 为 `d80e88e35af30e4473aa7eeffde91dcf8d953d09`；开发起点 `feature/v2-m11-r8-award-facts-20261023` 为 `0083e3778afa7c33525cd018fc16570936b96ff9`。以 M2 `ledger/incentive-awards.mjs`、M11 `integrity/incentive-award-facts.mjs`、Prisma Ledger schema 与 P1h 的预算审计为依据。

现有 `readIncentiveAwardFacts()` 受 Principal、观察时段及最多 500 条限制，并过滤不符合标准来源结构的奖励。它适合作为 R8 观察样本，但**不能**代表 Program 全部历史支付额，更不能据此计算预算余额。M2 发奖入口的现行幂等键使用 `programId:awardId`，既无跨政策版本权益唯一约束，也未绑定可信 Program 治理/签名政策/Settlement。

## 2. 本轮实现：只读、全体 POSTED 候选的保守聚合

新增 `next-app/src/lib/integrity/incentive-posted-budget-coverage-draft.mjs` 及同名 Node 测试。协议 `iwantu.incentive-posted-budget-coverage/0.1`。

单条参数化 SQL 在一个数据库语句快照中扫描**全部** `status=posted` 且满足以下任一条件的 LedgerTransaction：`type=incentive`，或者存在从 `system_incentive` 借方流出的记录。没有 `LIMIT`、观察时段或指定 Principal 过滤，也不调用之前的 R8 500 条样本入口。

对每笔候选交易分别检查：两条标准分录、唯一的奖池借方和受益 Principal 贷方、IWC、双方金额、不可变 POSTED 交易哈希形式、provenance、Program/Award/受益主体引用与 M2 幂等键。`programId`、`awardId` 使用无分隔歧义的规范标识，旧历史记录若不能唯一解释 `programId:awardId` 则拒绝覆盖结果，不悄悄认作另一个 Program。

只要发现任何不能确定归属的 POSTED 激励交易或异常奖池借方交易，即抛出 `INCENTIVE_POSTED_BUDGET_COVERAGE_DRAFT_FAILED`；不允许将不完整的金额视为 0。金额按数据库 numeric 字符串转 `BigInt` 最小单位校验与格式化，拒绝 Number、指数、精度丢失和越界聚合值。

成功时仅返回本 SQL 快照的全池借方累计额、指定 Program 的**可归类**已 POSTED 奖励累计额与候选交易计数。输出始终：`budgetAuthorityStatus=not_checked`、`programGovernanceStatus=not_checked`、`immutableTriggerAttributionStatus=unavailable`、`economicWritePermitted=false`、`r8RiskEvaluationEligible=false`，不生成 IntegritySignal、不修改 ReputationEvidence、不实行 I0–I4 经济处罚。

**边界**：当前只是 SQL 形态与响应校验的原生 Node 模拟测试，未在独立 PostgreSQL 中执行真实聚合。SQL 查询结果仍不是签名政策预算、可信治理主体、真实 Settlement 因果或提交时可用奖池余额；单语句快照不是 M2 锁内原子性承诺。存在超大历史数据量时，该查询可能较慢，因此暂不接入在线发奖路径。

## 3. 下一阶段必须决定的治理与数据库边界

1. **Program 注册信任根**：治理方身份不能从候选 `issuerPrincipalId` 自证。需明确受控的创设批准流程/受信任签名材料、权限轮换及失效处理，并创建不可变注册收据；尚未批准哪个 Principal 具有该权力。禁止假定全局超级管理员。
2. **跨版本共享预算**：预算修订必须作为治理签名的追加事实；不能按 `policyVersion` 重置预算。跨 Program 共享有限系统奖池与单 Program 预算是两个独立约束。
3. **历史模糊记录**：无归因收据、结构异常或标识有歧义的已入账奖励，不得篡改历史；在获得人工审计与有签名的补充治理决策前，对预算授权保持 Fail-Closed。即使结构全部匹配，也不自动补造缺失的 Settlement 触发证据。
4. **权益唯一性与重放**：`(programId, settlementId, beneficiaryRole, awardSlot)` 必须经冻结的政策版本裁决，并在 PostgreSQL 设唯一约束；与旧的政策级哈希、命令 Nonce、M2 `awardId` 幂等键分别记录。任何合法补发须独立的治理签名/槽位语义，不能仅改 `awardId`。
5. **真实原子发奖**：先冻结 Policy/Mandate/治理/签名/额度证据，再在同一数据库事务内以 M2 全局 Ledger advisory lock 为锚点，完成实时余额、稳定权益、Nonce、不可变收据和双分录；需先验证增加 Program/Settlement 行锁后不会形成锁序环。
6. **独立 AgentVersion**：必须从签名的执行经济边界产生历史版本事实，不能从当前 AgentVersion 或 AgentCapabilityClaim 推断。

## 4. 验收证据与未完成项

本轮使用 Node.js v22.16.0，对新增模块/测试执行语法检查及 9 组确定性正反例：**9/9 PASS**。测试覆盖参数绑定、完整 SQL 扫描语义、双分录与 provenance 检查、未分类阻断、非法计数、Decimal 精度、输入污染和 DB 读失败。没有 PostgreSQL 真库，因此这些只是**模拟 SQL 调用的原生测试**，不证明 PostgreSQL SQL 语法、实际计划、并发或执行结果。

完整 `test:invariants`、Prisma Validate、ESLint、Typecheck、Build、PostgreSQL E2E：**NOT_RUN**。在独立测试数据库中应补充：真实合规发奖、多版本累计、缺失 provenance、额外分录、奖池异常借方、冒充 Program、分隔符歧义、空表、读取时并发新增、数据量上界。真库通过前，不接入实际发奖或风险信号。

## 5. R8-P1j：独立 PostgreSQL 回滚验收用例（已提交，尚未真库执行）

新增 `next-app/tests/v2-m11-incentive-posted-budget-coverage-postgres.test.mjs`，专用命令 `npm run test:m11:postgres:r8-coverage`。该用例不是新经济发奖入口，只针对 P1i 只读审计的真实 SQL/数据库语义建立验收路径：

1. **强制隔离**：仅在显式 `IWANTU_R8_POSTGRES_TEST=iwantu_test` 且 `DATABASE_URL` 指向本机 `iwantu_test` PostgreSQL 数据库时连接，拒绝其他主机、数据库名和显式 schema 参数。测试使用单个 Prisma ReadCommitted 交互式事务，最后主动抛出哨兵异常并断言完整回滚；测试期间不提交用户经济事实。
2. **真实 M2 分录**：复用 `postLedgerTransactionInTransaction()`、Credit provenance 构造器和既有账户辅助函数；同一事务内模拟有限 Incentive 奖池拨款、两个 Program 的合法 POSTED 奖励、重复幂等读取，不自行绕过 canonical posting engine。
3. **实际 SQL 检验**：对比聚合前后的全池支出、Program 历史支出、交易数和 Decimal(36,8) 最小单位；检查跨 Program 隔离及 `economicWritePermitted=false`、`r8RiskEvaluationEligible=false`。
4. **Fail-Closed 负例**：在相同未提交事务中加入带分隔符的旧式 Award ID，要求实际 SQL 将其识别为未分类历史账本事实并拒绝预算结果；事务随后整体回滚，结束后核查测试幂等键没有留下持久交易。
5. **边界**：该用例尚未证明并发可重复读、批量性能、授权预算或治理凭据；未来需增加完整 R7 真库负例、R8 跨政策版本权益唯一性、签名 Nonce 及原子经济写入专项门禁。不得把回滚事务的结构测试视为发奖授权测试。

本轮**仅对新测试文件进行了 Node v22.16.0 的 `node --check` 静态语法检查（PASS）**，并回读 GitHub 远端文件。当前环境未安装完整仓库、Prisma/ESLint 依赖及 PostgreSQL 服务；`test:m11:postgres:r8-coverage` **NOT_RUN**，完整 invariants、Prisma Validate、ESLint、Typecheck、Build 同为 **NOT_RUN**。因此 P1i/P1j **不得标记真库验收 PASS**。
