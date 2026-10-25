# V2 后续开发规划

更新：2026-10-25（香港时间）。R8 治理至观察基础已由 [PR #55](https://github.com/BaiSongt/iwantu/pull/55) 合并至 `master`，合并 SHA 为 `1ab4fe6db5950b41e74ffa36264862691cca6a0b`；其 exact HEAD 的远端 Node 20 / PostgreSQL 15 CI 已通过。当前接续分支为 `feature/v2-m11-r8-shadow-evaluation`。规划继续对照 [Issue #48](https://github.com/BaiSongt/iwantu/issues/48)、[Issue #44](https://github.com/BaiSongt/iwantu/issues/44) 与实现，旧 RFC 的阶段记录不替代当前状态。

## 已完成的基础

master 已完成依赖告警清零、R8 治理登记、冻结政策、共享预算、跨版本权益去重、真实 Settlement 原子发奖、单独政策撤销及已治理奖励观察，共 7 个认证接口。合并前本地验收为 543/543 测试、37 个迁移通过，合并门禁还执行了远端 CI；没有配置真实生产治理计划或执行部署操作。

## 接续顺序

| 顺序 | 任务 | 可交付结果与验收门槛 |
| --- | --- | --- |
| 1，已合并 | R8 已治理奖励观察 | 已提供只读来源核验、私有观察 API、精确金额/关系统计和稳定证据摘要；三类真实终局结果等门禁已随 PR #55 合并 |
| 2，影子切片已实现 | R8 统计规则与误报评估 | 已提供固定实验政策、私有 `/evaluations`、精确奖励占优计算、校准矩阵和真实五次结算对照；本地完整回归 569/569 通过。合法高补贴活动也可能命中，结果仍为经济模式候选；正式生产 ruleVersion、活动上下文校准和 IntegritySignal 启用仍需独立评审 |
| 3 | R7 分支对齐与真库验收 | 独立复核 `feature/v2-m11-genesis-credit-loop` 的 exact HEAD、来源边界及数据库回归，再与 R8 合并验证 M11-06；不根据旧进展文字直接标记完成 |
| 4 | M11-07 动作投影与 Passport | 将已验证信号映射为可审计的建议动作，接入 Reputation Passport；区分无信号、证据不足与尚未评估。I3/I4 的实际冻结、限权另设授权与申诉门禁 |
| 5 | M11-08 重建与集成 | 完成规则重建、幂等、篡改、并发和真实 PostgreSQL 回归；整理功能 PR 并检查其 exact HEAD CI。通过后再按授权推进合并与发布 |
| 6，并行独立事项 | 治理生命周期与产品接入 | 预算修订、密钥轮换、历史计划迁移分别使用版本化签名协议；随后接 MCP/界面与 V1→V2 兼容切换。Issue #44 的执行 AgentVersion 绑定单独设计，不能用当前版本推断历史 |

## 本轮观察 API 的决定

新增 `GET /api/v2/incentives/programs/{programId}/observations`。治理 Principal 和执行 Principal 可以读取，单个受益者不能借此查看整个计划的其他交易关系。保持当前配置关闭写入后，仍可读取历史证明。

窗口为显式 UTC 毫秒时间 `[windowStart, windowEnd)`，最长 31 天，按奖励实际入账时间选择。证据总量超过 500 时拒绝，调用者缩短窗口后重试，不能用被截断的样本生成完整统计。查询和汇总共享只读一致快照，不获取发奖锁。

按 Principal 汇总可核验奖励数量、独立 Settlement 数、IWC 总额、独立对手方数、同主体 Settlement 数、最高对手方占比、政策集合及角色/槽位明细。跨合法奖励槽位或买卖双方的同一 Settlement，只在对应分母中计一次。金额使用定点整数运算。

旧版未绑定奖励维持归因不可用；若观察窗存在该 Program 的未绑定已入账候选，明确报告缺口。当前 `riskAssessment.state=not_evaluated`，原因是 R8 统计阈值尚未冻结。观察结果不构成 `INCENTIVE_FARMING` 结论，不写 IntegritySignal、Ledger、Reputation 或 Trust，也不触发 I0–I4。

政策撤销是历史事实的上下文：只展示观察窗结束前已经发生的撤销；观察窗之后的撤销不改变已完成窗口的奖励归因。当前根密钥失效或命令到期不否认先前已经提交的有效历史签名。

观察基础详见[已治理奖励观察记录](./v2-m11-06-r8-governed-observation.md)，本轮规则与误报样本见[实验影子评估](./v2-m11-06-r8-shadow-evaluation.md)。旧观察接口保持 `not_evaluated`；实验评估使用独立路由，固定 `productionPolicyStatus=not_approved`，没有隐式升级为生产分类。

合并前通过 SSH 回读的 R7 分支仍为 `78ad91d80664ad9ffad65bcf18dc55ac2da87945`。R7 尚未运行本轮专项验收；接下来可先推进第 3 项的分支对齐与真库门禁，同时补充 R8 的活动上下文与生产校准证据。
