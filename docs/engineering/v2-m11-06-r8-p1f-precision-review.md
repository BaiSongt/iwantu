# iWANTU V2-M11-06｜R8-P1f 候选奖励额度定点核验与可信来源评审

状态：**局部纯函数已实现；治理、真实预算和经济授权未实现，禁止用于生产发奖**。日期：2026-10-24。跟踪 Issue #48，Issue #44 单独跟踪。

## 1. 实现范围

在 R8-P1a 候选政策、P1b 待签名意图、P1c–P1d 凭据校验、P1e Mandate action 只读预检之后，新增：

- next-app/src/lib/integrity/incentive-amount-preflight-draft.mjs
- next-app/tests/v2-m11-incentive-amount-preflight-draft.test.mjs
- 独立入口：npm run test:m11:r8-p1f

inspectDeclaredIncentiveAmountDraft **只证明**奖励金额不超过调用方提供的单笔上限、计划剩余额度和有限 Incentive pool 声明余额。全部金额为精确规范的 Decimal(36,8) 字符串，运算采用 BigInt 最小单位（1 IWC = 100000000 units），禁止 Number、浮点近似、隐式舍入、科学计数、零奖励、负数、超出 28 位整数部分、未知字段和伪造 authorized。余额或上限为零可以表达，但无法通过正金额检查。超过任何一个声明的上限即 Fail-Closed。

返回的成功状态仅为 within_unverified_declared_caps，始终携带 evidenceSourceStatus=not_checked、mandateEconomicLimitStatus=not_checked、programBudgetStatus=not_checked、incentivePoolBalanceStatus=not_checked、authorizationStatus=incomplete、economicWritePermitted=false 和 r8RiskEvaluationEligible=false。

**它没有读取数据库，也没有验证调用方额度的可信性。不得把通过纯算术测试解释为经济授权通过。** P1f 不引入任何新发奖路径、政策持久化、收据、Nonce 消费、Ledger 写入或 IntegritySignal。

## 2. 可信额度来源必须在正式事务中建立

| 项目 | 候选来源 | 真正用于发奖前的必需证明 |
| --- | --- | --- |
| 奖励金额 | 经 P1a 规范化的定额 rewardFormula.amountIwc | 已授权发布、冻结版本和哈希的 ProgramPolicy 修订；P1b 发奖签名意图必须绑定同一 revision/hash |
| 单笔上限 | 本切片 declaredCaps.perAwardCapIwc | 可信 Mandate 授权与独立版本化精确 IWC 额度策略交集；不能使用 M1 通用 economicLimits 的 Number 比较冒充 Decimal 精确授权 |
| Program 预算剩余 | 本切片 declaredCaps.programRemainingIwc | 已冻结/已授权的 Program 总预算及关联真实 POSTED Ledger 奖励（含跨版本、跨受益者去重）；不得相信客户端余额或可变计数器 |
| 奖池可用余额 | 本切片 declaredCaps.poolAvailableIwc | 在 canonical M2 ledger advisory lock + 账户锁保护下从真实 system_incentive 账本计算；不能使用先前只读预检的快照作为提交依据 |
| Governance Principal | P1a issuerPrincipalId | 不可变 Program 治理授权链或受监管登记事实；身份 active + Mandate action 不等于 Program 所有权 |
| 非重放与原子性 | P1b 去重指纹和候选命令 Nonce | PostgreSQL UNIQUE、不可变签名授权收据、政策/Settlement/绑定收据、原子双分录入账与失败全回滚 |

建议在数据模型评审时明确 ProgramGovernanceAssignment 的签发主体、Program 唯一身份、有效时段和撤销追加事件；同时明确总预算在政策跨版本修订时能否共享、是否允许不同槽位合法多次发奖。**这些都是待评审决策，并非已建模能力。**

## 3. 正式经济边界的约束

政策发布与发奖权限仍保持 incentive.policy.publish、incentive.award.issue 隔离。必须完成服务端可信凭据验签、当前 Mandate、治理主体、精确额度策略、冻结政策和终局 Settlement 实体关联、Nonce 占用后，才能在与 M2 兼容的事务中核对真实预算/余额并实施经济写入。锁序首先以现有 M2 ledger advisory lock 与规范账户锁为基础，不额外引入相反顺序的锁。

应明确使用同一个原子事务捕获当次 AuthoritySnapshot、签名收据、政策和触发绑定、Ledger 双分录；任何步骤失败必须整体回滚。既有未绑定激励奖励保持 attribution_unavailable，不得推断历史政策、替换旧账本或按 R8 自动处罚。

## 4. 验证与下一切片

2026-10-24 本地 Node.js v22.16.0：新模块原生 node --test **9/9 PASS**、两文件 node --check **PASS**，并对照远端 Blob SHA 核验完全一致。新增测试覆盖最大 Decimal(36,8)、1e-8 最小单位、三重上限、额度归零、精度与溢出负例、未知字段和重复确定性。

完整 test:invariants、ESLint、Prisma Validate、Typecheck、Build、PostgreSQL E2E：**NOT_RUN**；历史 master CI 不能替代本轮验收。

下一切片：R8-P1g 冻结 Program 治理主体与预算政策的**可信来源模型评审**，然后独立开发 B2 PostgreSQL 不可变收据与真实数据库测试。Issue #44 的执行 AgentVersion 必须另行绑定签名的历史经济事实，不从当前状态推测。
