# iWANTU V2-M11-06｜R8-P1e 实时 Mandate 动作预检与经济授权边界

状态：**候选实现 / 待评审，不能用于生产经济写入**。对应 Issue #48；Issue #44 的执行 AgentVersion 绑定仍单独处理。

## 1. 源码核对基线

2026-10-24 依据 `master` `d80e88e35af30e4473aa7eeffde91dcf8d953d09` 与 R8 开发分支既有 P1a–P1d 进行审查：

- M1 `resolveAuthority()` 需要显式的 `mandateId`，核对 Principal/Agent 状态、撤销与有效期、委托收窄、action、capability 及请求明确携带的 economic 约束。`bindAuthorityToAuthentication()` 负责认证 Principal/Agent 与解析所得授权根主体的一致性。
- M3 `authorizeOfferCommandInTx()` 的顺序是签名与存储凭据核验 → 实时授权 → 业务额度/能力检查 → 在同一事务内捕获 `AuthoritySnapshot` → 不可变业务写入；新激励命令不得复制或绕过这套顺序。
- P1d 已从当前数据库读取签名凭据并验签，但明确没有检查实时 Mandate、政策治理资格、经济额度、Nonce 重放或收据持久化。
- M1 的通用 `economicLimits` 请求逻辑对 numeric 采用 JavaScript Number 比较。它不能被直接当作严格 Decimal(36,8) 的 IWC 奖励金额门禁；M3 的固定点金额比较也只针对 `singleContract`，不能未经审查直接套用到奖励。

## 2. P1e 最小代码切片

新增 `incentive-mandate-preflight-draft.mjs`，在 P1d 已检查当前存储凭据和 Ed25519 签名后，**直接调用 M1 `resolveAuthority` 和 `bindAuthorityToAuthentication`**。它只在服务端现有 Prisma 读取上下文中运行。候选 action 相互隔离：

| action | P1e 检查 | 尚未获得的权限 |
| --- | --- | --- |
| `incentive.policy.publish` | 命令签名/凭据、当前 Mandate action、签名 Principal 与候选政策 issuer 一致 | 是否真正拥有指定 Program 的治理/发布权 |
| `incentive.award.issue` | 命令签名/凭据、当前 Mandate action、认证身份与 Mandate 根主体一致 | 有效政策、归属 Settlement、受益 Principal、奖励额度、奖池资金和独立发奖授权 |

在敏感激励动作候选路径中，仅接受**叶子 Mandate 精确声明该 action**；`*` 和 `incentive.*` 不能代替精确授权。这是 P1e 的额外保守门禁，不改变通用 M1 Resolver 的 scope 规则。无授权、撤销、过期、主体错配、凭据停用或签名失配均 Fail-Closed。

P1e 返回 `mandateActionStatus=matched_live_explicit_action_scope`，但**同时固定** `authorizationStatus=incomplete`、`economicLimitStatus=not_checked`、`policyGovernanceStatus=not_checked`、`nonceReplayStatus=not_checked`、`immutableReceiptStatus=not_written`、`r8RiskEvaluationEligible=false`。仅回传 Mandate 链摘要，**不会**创建 AuthoritySnapshot、写政策/账本/收据、消费 Nonce 或实施 I0–I4。

## 3. 后续必须单独评审并冻结的决策

**政策治理 Principal。** P1a 中的 `issuerPrincipalId` 是待签名意图字段，不是可信的治理注册簿。需建立对 `programId` 的不可变、可校验治理主体授权（例如版本化 `ProgramGovernanceAssignment`），验证签名主体与当次政策所有权。不得因为 Principal 是 active、Mandate action 合法或候选 issuer 自称匹配，就赋予发布权。若允许多管理员或权限转移，必须明确授权链有效时段及历史冻结方式。

**发布与发奖职责隔离。** `incentive.policy.publish` 和 `incentive.award.issue` 使用不同 action、凭据和授权快照；奖励执行者可与 Program 治理发布者不同，但必须由可信 Program 治理事实明确授予奖励执行资格。不能从奖励执行者与发布者的相同/不同直接推断合法性。

**金额门禁。** 使用规范定点 Decimal(36,8) → BigInt 最小单位校验单笔上限、计划/时间窗累计额度及剩余有限 Incentive pool。经济限制策略版本必须与冻结政策哈希一致，并与 Mandate 的经济约束共同取交集；禁止以 JavaScript 浮点数替代金额比较。额度检查须在实际经济写事务内重复完成，避免预检后资金/权限变化。

**不可变签名授权证据。** 后续服务应对政策发布及发奖分别建立独立协议收据，原子保存签名命令、冻结版本、当时的 AuthoritySnapshot、动作/额度验证和独立唯一 Nonce；`AuthoritySnapshot` 不可重用为未来实时许可。数据库的唯一约束和防 UPDATE/DELETE 触发器须独立阻止旁路。不得将只读预检的 `mandateChainHash` 误认为历史 AuthoritySnapshot。

**执行先后与并发。** 正式写路径必须在统一事务中完成实时认证、授权、政策/结算核对、Nonce 唯一性占用、预算/双分录入账及绑定收据，全部成功或回滚；遵守 M2 全局 ledger advisory lock 与账户锁顺序。设计前要验证 Settlement 读取锁与 M2 写锁的关系，不能靠跨事务预检证明原子性。

## 4. 测试证据和未完成项

新增 `v2-m11-incentive-mandate-preflight-draft.test.mjs`，覆盖两类动作、精确授权、错误 action/通配符、撤销/期限/身份失效、伪造凭据、非法参数及重复预检无写入。已接入 `test:invariants`、`lint:m11` 和独立 `test:m11:r8-p1e` 命令。

**本次代码提交前/后 Node 测试、Prisma Validate、ESLint、Typecheck、Build 和 PostgreSQL E2E 须按实际运行结果记录，不能借用此前 CI。** P1e 完成的是只读动作解析切片，**不是 R8-P1e 全量经济授权、R8-B2 不可变持久化或 R8-B3 原子发奖完成**。

下一工作包：先确认真实 Program 治理注册簿/责任主体与严格金额模型，再在真实 `iwantu_test` 中验证授权快照、Nonce 唯一性及数据库层防伪造；之后设计 B2 收据迁移。所有旧奖励继续 `attribution_unavailable`，不自动回填或将规则信号解释为舞弊判决。

## 5. 本轮验证记录（2026-10-24）

- **PASS**：新增 P1e 源码与 Node 测试文件 `node --check` 语法检查；GitHub 回读的 Git Blob SHA 与本地一致。
- **PASS（隔离验证）**：7/7 Node 原生测试，P1e 实际模块控制流、模拟的 M1/P1d 只读依赖、真实 Node Ed25519 数学运算；**M1/P1d 由局部替身承接，并未证明真实模块完整联动**。
- **NOT_RUN**：使用完整仓库真实 M1/P1d 依赖执行 `npm run test:m11:r8-p1e`、完整 `test:invariants`、ESLint、Prisma Validate、Typecheck、Build、PostgreSQL E2E。当前运行环境缺少完整 npm 依赖及独立测试数据库，不能把隔离测试作为 CI 或真库验收。
- P1e 所有结果依旧只读、无授权放行；后续实现经济额度及 Program 治理边界之前禁止接入真实政策发布或发奖。
