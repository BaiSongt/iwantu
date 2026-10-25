# R8 实验影子评估与误报校准

日期：2026-10-25（香港时间）。上一批治理、依赖修复、在线 API、撤销及观察功能已通过 [PR #55](https://github.com/BaiSongt/iwantu/pull/55) 合并至 `master`，合并提交为 `1ab4fe6db5950b41e74ffa36264862691cca6a0b`。其 HEAD `4584a6f` 的 [next-app-ci](https://github.com/BaiSongt/iwantu/actions/runs/40200899255) 通过了 Node 20 / PostgreSQL 15 验收；工作流保留既有非阻塞 legacy lint 基线。

合并后在 `feature/v2-m11-r8-shadow-evaluation` 开发本切片，接续[后续规划](./v2-next-development-plan.md)第 2 项。交付可运行的私有影子评估和校准样本，生产规则仍未批准，不写正式 IntegritySignal 或任何经济处罚。

## 固定实验规则

协议：`iwantu.incentive-farming-shadow/0.1`。规则标识：`R8_INCENTIVE_FARMING`，实验版本：`iwantu.integrity-rule.r8/0.1-exp.1`。固定政策摘要为 `1d7817e5254ddb095e31f1970ce469864137acd24bdcba252b8ad55c35473c10`。

| 条件 | 固定值 |
| --- | --- |
| 不同 Principal 间的去重已奖励 Settlement 最少数量 | 5 |
| 单个 Settlement 的高补贴标准 | 该受益 Principal 的窗口内奖励总和 ≥ 合同结算 gross |
| 高补贴 Settlement 占独立样本比例 | ≥ 80% |
| 全部独立样本的总奖励 / 总 gross | ≥ 100% |

同一 Principal、Program、Settlement 的不同政策版本、角色和合法奖励槽位合并计算奖励，gross 只计一次。同主体 Settlement 展示在证据中，但排除所有规则分子和分母；对手方集中度只作解释，不代替经济条件。使用 BigInt 交叉乘法判断边界，展示比率向下保留 8 位，不以显示舍入值作判断。

分母为该 Program、窗口内**已经获奖的合同结算 gross**，不是 Agent 全部交易额、净转账或利润，也不表示穿透追踪了某一份 IWC。任何未绑定候选使整个窗口不可评估，不能从完整窗口中抽取“看起来合格”的子集。

## 校准矩阵与限制

以下是可重放的规则契约样本，不是带有真实舞弊标签的生产数据集。

| 样本 | 预期影子结果 | 约束 |
| --- | --- | --- |
| 4 个独立高补贴 Settlement | `insufficient_evidence` | 不足最低样本 |
| 5 个独立 Settlement，4 个高补贴，总奖励也 ≥ 总 gross | `candidate_match` | 80% 的精确边界 |
| 同为 4/5 高补贴，但总奖励 < 总 gross | `clear` | 数量占比不能替代总额条件 |
| 总奖励 ≥ 总 gross，但仅 3/5 高补贴 | `clear` | 单笔大额不能替代重复模式 |
| 1 个 Settlement 的 5 个合法槽位 | `insufficient_evidence` | 奖励数量不能充当交易数量 |
| 5 个同主体 Settlement | `insufficient_evidence` | 不伪造独立交易证据 |
| 100 笔合法集中交易，奖励占比较低 | `clear` | 高频或集中不单独触发 |
| 合法高补贴促销，5/5 满足经济条件 | `candidate_match` | 明确保留合法解释，绝非舞弊裁决 |
| 已核验子集命中，但存在 1 条未绑定候选 | `unavailable` | 拒绝不完整分母 |

合法促销的命中证明：仅凭这些经济事实无法区分激励套利与获准活动。当前不能据合成样本声称生产误报率、精确率或舞弊检测能力。正式政策还需要带上下文的活动/授权样本、独立评审及明确的启用边界；不得把 `candidate_match` 当成 I3/I4 冻结、限制或处罚许可。

## 在线契约

新增私有 `GET /api/v2/incentives/programs/{programId}/evaluations`，沿用观察接口的两个严格参数 `windowStart`、`windowEnd`、31 天和 500 条完整证据上限、v2 Bearer、治理方/执行方可见性、凭据限流及 `no-store`。

评估从真实只读来源重新生成观察，并在纯评估器内再核对完整规范观察、摘要和统计，不接受自述总额或任意政策参数。请求开始时固定评估时间；在读取期间才结束的窗口不能被早先快照当作已闭合。

状态区分：未闭合窗口或未绑定候选为 `unavailable`；空窗口或没有足够独立样本为 `insufficient_evidence`；至少一个主体达到样本量时为 `evaluated`，各主体结果为 `candidate_match`、`clear` 或 `insufficient_evidence`。`clear` 只表示该样本没有此实验模式，不代表主体没有风险。

响应明确包含 `mode=shadow`、`productionPolicyStatus=not_approved`、`interpretation=economic_pattern_only`、固定政策与摘要、来源观察摘要、稳定评估摘要、各主体金额/分母及 Settlement 审计引用、可能的合法解释。`signalEmitted=false`、`automaticPunishmentApplied=false`、`capitalLineageTraced=false` 固定保留。旧 `/observations` 的 `riskAssessment=not_evaluated` 契约不变。

## 验收

从新建本机 `iwantu_test` 按 CI 顺序串行验收，**569/569 PASS，0 FAIL、0 SKIP、0 CANCELLED**：477 项协议/契约与纯函数不变量、42 项 R8 PostgreSQL、30 项实际生产 HTTP API、14 项生产安全 HTTP、6 项依赖兼容性。新增 26 项包括 16 项规则/校准/篡改测试、4 项真实 PostgreSQL 与 6 项生产 HTTP 测试。

真实五次结算场景对同一供应商使用不同买方的签名 M3–M5 流程，结算 gross 合计 `127.50000000 IWC`，高补贴奖励合计 `150.00000000 IWC` 命中候选模式；正常奖励合计 `5.00000000 IWC` 为 `clear`，四笔样本仍为不足。验证固定窗口重放、后续根/政策撤销、当前配置关闭读取、访问隔离、禁止覆盖阈值、未闭合窗口，以及 Ledger、Reputation、账户和 IntegritySignal 均无写入。未绑定候选与伪造观察的负例在纯函数门禁验证，不通过关闭数据库保护伪造已提交孤儿奖励。

37 个迁移、Prisma Validate、16 组定向 ESLint、Typecheck、生产 Build 及全级别依赖审计均 PASS，审计为 0 vulnerabilities。既有 storage tracing 和 Prisma 配置弃用提示保留。没有新增或修改迁移，也没有修改历史账本、政策或奖励。

本机为 Node 22.16.0、Prisma 6.19.3、WSL PostgreSQL 16.15；日志为 Git 忽略的 `next-app/shadow-final-*.log`、`shadow-build.log` 和 `shadow-quality.log`。HTTP 服务器由测试关闭，本轮临时数据库验收后停止。新功能的远端验收以其 PR 当前 HEAD 的 CI 为准；前述 PR #55 的成功结果只对应已合并基础，不代替本切片检查。没有修改真实生产配置或执行部署操作。
