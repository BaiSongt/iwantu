# V2-M11-06｜R7 Genesis Credit Loop 数据来源审计与修订边界

审查日期：2026-10-23；基线：master d80e88e35af30e4473aa7eeffde91dcf8d953d09；对象：feature/v2-m11-genesis-credit-loop。

## 本轮审查结论

**历史缺陷：最初的 R7 分支不能作为已实现能力合并。** R7 的 SQL 从 `reputation_evidence.evidence` 读取 `genesisOriginAmount`，但 `20260919161000_v2_m9_terminal_reputation_evidence/migration.sql` 中的 `iwantu_build_terminal_reputation_evidence` 只写入货币、结算总额、收款额、LedgerTransactionId、SettlementHash 等经济事实，没有 `genesisOriginAmount`。当前 R7 将不存在的字段 COALESCE 为 0，因此真实数据库即使发生循环交易，也会因 Genesis 比例永远为零而不产生 R7 信号。现有测试只向伪造的 queryRaw 结果注入该字段，无法覆盖真实 PostgreSQL 事实来源。

## 已核对的真实事实边界

- M2 的 `issueGenesisCredit()` 写入 `ledger_transactions(type=genesis, status=posted, referenceType=principal_genesis_allocation)`，同时在 `ledger_entries.provenance` 保存 `schemaVersion=iwantu-credit-provenance/0.1`、`kind=genesis`、`beneficiaryPrincipalId`、`allocationVersion`。
- `awardProtocolIncentive()` 的来源不是 Genesis，而是 `type=incentive`、从有限 `system_incentive` 账户转出的独立结构化 provenance；该来源应交由 R8 观察，不应混入 R7。
- M9 的 `reputation_evidence(evidenceClass=economic, subjectRole=supplier)` 可作为实际已结算的有向交易边：资金流向是 `counterpartyPrincipalId -> subjectPrincipalId`，`subjectReceivedAmount` 是供应方收到的 IWC。
- IWC 是可替代余额，当前基础账本只记录初始信用发放和后续交易分录，不记录每一单位 IWC 的跨交易归属转移。**Genesis 发放历史不等于某笔 Settlement 所用资金的 Genesis 来源证明。**
- R7 必须保持只写不可变 IntegritySignal，不写 ReputationEvidence、Ledger、Trust，不自动冻结、处罚或修改 I0–I4 状态。

## R7 v0.1 安全实施方案（需按实际数据验证）

1. 保留三 Principal 的有向经济结算环和既有 R5 的基本流量/边占比门槛；只读取最终 Settlement 导出的不可变 ReputationEvidence，按供应方经济证据计数一次，避免买卖双方证据重复计数。
2. 额外关联每个 Principal **在观察窗口首笔环形 Settlement 之前**已 POSTED 的 Genesis Credit 发行账本事实：`ledger_transactions -> ledger_entries -> ledger_accounts(principalId)`；检查事务类型、账户、credit 方向、结构化 provenance.kind、主体绑定与时间顺序。
3. 将规则语义限定为 **Genesis 收款主体参与了闭环结算** 的可解释风险观察：披露 Genesis 发放额、交易边、闭环总额、观察窗口和版本化阈值；明确 `capitalLineageTraced=false`。不得声称具体已结算 IWC 均来自 Genesis。
4. 如果后续业务要求证明资金穿透来源，需先设计独立、可审计的资金份额追踪协议（含支付拆分、退款、合并、手续费和守恒模型），冻结语义后再提高 R7 判定强度；不能凭历史余额比例倒推唯一资金来源。
5. 对等价循环起点和遍历次序采用稳定 canonical 排序；同一窗口、同一证据的精确重放只能产生同一组 Signal。

## 必须通过的验收 Gate

- R7 查询只能使用真实已入库字段；禁止读取不存在的 `genesisOriginAmount`，禁止基于当期可变余额推断历史信用来源。
- 正例：真实 Genesis 发放 + 三主体定向终结结算环 + 达到阈值；负例：只有 R5 环却无 Genesis 发放、仅奖励 Incentive、退款/未结算、中断环、后发 Genesis、同一 Principal、低额、边占比不足。
- PostgreSQL 真库端到端校验：建库迁移、创建交易事实、运行 R7、校验恰当 Signal、不变更任何 Ledger/Reputation/Trust、恶意 UPDATE/DELETE 拒绝、重复执行同一信号幂等。
- 运行 `node --test tests/v2-m11-genesis-credit-loop.test.mjs`、`npm run test:invariants`、`npm run prisma:validate`、`npm run lint:m11`、`npm run typecheck`、`npm run build`；每项必须报告 exact HEAD 和 PASS/FAIL/NOT_RUN。未运行绝不标注通过。

## R8 与其他依赖

- R8 INCENTIVE_FARMING 必须从 `ledger_transactions(type=incentive, status=posted)`、`ledger_entries.provenance(kind=incentive)` 的 award/program/受益主体事实出发，结合 M9 的独立 Principal 结算证据做版本化、可解释统计；重复合法奖励不能仅凭频次判定作弊。
- Issue #44：Contract/Delivery/Settlement 尚未绑定执行 `AgentVersion`。版本级信誉必须先在签名经济承诺或 Delivery 边界保存不可变版本身份及哈希，并延伸至终局 ReputationEvidence，不得推断当前激活版本即历史执行版本。

## 分支状态（2026-10-23 20:00，北京时间）

R7 开发分支 `feature/v2-m11-genesis-credit-loop` 已替换不存在的 `genesisOriginAmount` 提取路径，改为在循环中第一笔终局结算证据之前查询真实的已 POSTED Genesis 发行事实；闭环阈值沿用 R5，发行事实不再冒充资金穿透证明。加入循环旋转稳定性、无 Genesis/仅 Incentive/后发 Genesis、伪造发行结果、无写入副作用等测试，并将 R7 文件接入 `test:invariants` 与 `lint:m11`。

仅完成了隔离 JavaScript/V8 测试桩验证（13/13）；依赖完整 npm/Prisma/PostgreSQL 环境的原生 Node、迁移真库、ESLint、Typecheck 和 Build 仍为 **NOT_RUN**。因此 R7 为 **开发中、未合并**，不得描述为已完成、数据库验收通过或已证明 Settlement 的 Genesis 资金来源。不创建可合并 PR，不触发付费 CI。下一轮需要真实 PostgreSQL E2E、资金事实时间门禁与数据库级重放检查。
