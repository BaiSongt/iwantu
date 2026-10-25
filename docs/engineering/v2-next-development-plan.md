# V2 后续开发规划

更新：2026-10-25（香港时间）。以功能分支 `feature/v2-m11-r8-postgres-validation` 的 `13a67b3` 为起点，并核对 [Issue #48](https://github.com/BaiSongt/iwantu/issues/48)、[Issue #44](https://github.com/BaiSongt/iwantu/issues/44) 与仓库实现。M1–M10、M11 R1–R6 的 master 状态保持独立；旧 RFC 中“下一切片”按其记录日期理解，当前优先级以本文件为准。

## 已完成的基础

本功能分支已完成依赖告警清零、R8 治理登记、冻结政策、共享预算、跨版本权益去重、真实 Settlement 原子发奖、6 个认证 API 和单独政策撤销。上一轮本地验收为 485/485 测试和 37 个迁移通过；这些提交已推送，尚未合并 master 或部署。

## 接续顺序

| 顺序 | 任务 | 可交付结果与验收门槛 |
| --- | --- | --- |
| 1，本轮已完成 | R8 已治理奖励观察 | 已提供只读来源核验、私有观察 API、精确金额/关系统计和稳定证据摘要；覆盖三类真实终局结果、窗口/数量/时区、历史撤销、旧奖励缺口及主体隔离。完整本地回归 543/543 通过 |
| 2 | R8 统计规则与误报评估 | 使用可重放样本验证真实激励归因、重复收益、独立对手方及奖励/交易分母；分别覆盖合法高频/集中交易、同主体、跨政策/角色/槽位。冻结明确的 ruleVersion 与阈值后，输出可解释的 R8 IntegritySignal |
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

本轮实施与验收细节见[已治理奖励观察记录](./v2-m11-06-r8-governed-observation.md)。

本轮通过 SSH 回读远端：`master=d80e88e35af30e4473aa7eeffde91dcf8d953d09`，R7 分支为 `78ad91d80664ad9ffad65bcf18dc55ac2da87945`。R7 本轮仅确认分支位置，尚未运行其专项验收；下一项主线是第 2 项的 R8 规则与误报评估。
