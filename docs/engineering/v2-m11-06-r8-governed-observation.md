# R8 已治理奖励观察

日期：2026-10-25（香港时间）。接续已推送的 `13a67b3`，实现[后续开发规划](./v2-next-development-plan.md)的第一项：将已治理发奖事实接入真正的只读观察 API，为 R8-B4 的统计规则提供可靠分母。

## 来源核验

新增 `readGovernedIncentiveAwardSources`，使用一个 RepeatableRead、`SET TRANSACTION READ ONLY` 快照。所有查询均参数化，不获取 Ledger advisory lock、Contract 或 Escrow 行锁。按入账时刻选择最多 500 条候选，读取多一条以检测超量，超限整体失败。

已治理事实由 Program 登记、政策、授权收据、签名公钥、奖励绑定、真实终局 Settlement/Contract、M9 双类受益者证据以及 Ledger 组成。重新核验登记、政策发布及发奖的规范摘要与历史 Ed25519 签名，并校验相应 AuthoritySnapshot 的摘要、授权链及命令绑定；使用不可变授权创建时间验证命令，而不是用今天的密钥状态否认旧奖励。政策、跨版本权益身份、角色/槽位、受益人、金额、M2 标准奖池双分录与 Credit provenance 均须相符。

终局 Settlement 的证据摘要按其 full settlement、full refund 或 mutual split 协议重建。检查实际奖励及终局 Ledger 交易的 canonical posting hash；这不等于遍历和验证整个历史 Ledger 链。当前根或政策已撤销不使历史有效奖励失效，政策撤销上下文只展示在 `windowEnd` 之前形成的事件。

未绑定已入账候选单独计数，仍为归因不可用。候选覆盖激励类型、标准引用、自称激励的 metadata/provenance 及奖池借方，按 metadata、标准引用前缀或 provenance 的 Program 声明关联；这些声明只代表审计候选，不证明授权。查询不会根据自述授权或时间邻近性补出归因。未绑定候选不进入 verified 奖励和关系分母，旧事实层及其 `r8RiskEvaluationEligible=false` 契约保持原样。

## 统计与在线接入

新增私有 `GET /api/v2/incentives/programs/{programId}/observations`。要求精确的 UTC 毫秒窗口 `[windowStart, windowEnd)`，最长 31 天，证据总量上限 500。仅计划治理方/执行方可见，不向单个受益者公开全计划的对手方；未配置写入信任根时仍允许合格主体读取历史凭证。

纯聚合器使用 BigInt，输出奖励数量、去重 Settlement 数、受益 Principal 数、奖励金额、去重结算总额，以及每个 Principal 的对手方、同主体 Settlement、政策集合和角色/槽位明细。最高对手方占比分母为该 Principal 的全部去重已奖励 Settlement；独立对手方数排除主体自身。

相同来源集合和窗口产生相同排序与 SHA-256 `evidenceFingerprint`，不使用不稳定的当前观察时间作为指纹输入。跨政策/角色/槽位的合法奖励不重复计算 Settlement 交易分母。未绑定候选使 `attribution.state=partial`；无奖励为 `empty`；完整且有已核验奖励为 `verified`。

`riskAssessment` 明确为 `not_evaluated / rule_thresholds_not_frozen`。本切片不把合法集中交易判成 `INCENTIVE_FARMING`，不写 IntegritySignal、Ledger、ReputationEvidence、Trust 或处罚。后续在这些可重放统计上评估误报、冻结 R8 ruleVersion/阈值，再推进 R7 和动作/Passport 投影。

## 验收

本轮从新建本机 `iwantu_test` 按 CI 顺序串行执行，**543/543 PASS，0 FAIL、0 SKIP、0 CANCELLED**：461 项协议/HTTP 契约与来源不变量、38 项 R8 PostgreSQL、24 项实际生产 HTTP API、14 项生产安全 HTTP、6 项依赖兼容性。相较上轮增加 58 项：36 项来源核验、9 项纯聚合、8 项真库观察、5 项生产 HTTP 观察。

新增真库测试覆盖完整 M3–M5 正常结算、真实一秒到期后的 M6 全额退款、签名拒收与双方签名 M8 协商分账，再经过治理服务原子发奖及读取器核验。包括最小 IWC 单位、多槽位结算去重、重复命令、非 UTC 会话、数量上限、历史窗口稳定、当前密钥撤销/配置关闭、主体可见性及协议事实只读。纯测试另外覆盖篡改签名、AuthoritySnapshot、Ledger hash、金额、收据及 M9 对手方，拒绝把仅有 64 位摘要外形当作有效凭证。

37 个迁移、Prisma Validate、15 组定向 ESLint、Typecheck 和生产 Build 均 PASS，完整 `npm audit` 为 0 vulnerabilities。已有迁移不增加、不修改，也不回填旧凭证。构建保留既有 storage 动态 tracing 警告和 Prisma 配置弃用提示。

本机环境为 Node 22.16.0、Prisma 6.19.3、WSL PostgreSQL 16.15。原生日志保存为 Git 忽略的 `next-app/observation-final-*.log`、`observation-build.log` 和 `observation-quality.log`。测试 HTTP 服务器已自动关闭，验收后停止本轮临时数据库集群。未部署、未合并 master、未配置真实生产治理计划；远端 Actions 和 Docker PostgreSQL 15 尚未执行。
