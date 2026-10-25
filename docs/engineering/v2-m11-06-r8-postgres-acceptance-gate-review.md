# V2-M11-06 / R8：PostgreSQL 验收门禁与实现边界复核

**复核日期：2026-10-24**  
**关联：Issue #48（M11-06）、Issue #44（AgentVersion）**  
**基线：master `d80e88e35af30e4473aa7eeffde91dcf8d953d09`；R8 分支复核起点 `016417c4eb83ebc0d4ab684f22462a2ae9c7e592`**

> 本文件是开发评审证据，不是 PostgreSQL PASS 报告、不构成激励发放授权，也不表示 M11-06 已闭环。

## 1. 已核对的工程事实

- 唯一操作仓库为 `BaiSongt/iwantu`，默认分支 `master`。复核时 R8 功能分支领先 master 89 个提交、未落后；当前仅有 Draft PR #1，属于 Living Baseline，不是 R8 功能 PR。
- `next-app/AGENTS.md` 要求涉及 Next.js 行为时查阅仓库依赖中的实际 Next 文档；本轮没有修改 Next.js 代码。
- `next-app/src/lib/integrity/incentive-posted-budget-coverage-draft.mjs`（审计协议 `0.4`）提供一条只读 PostgreSQL 聚合查询，检查 POSTED 奖励、奖池借方、Credit provenance、声明激励来源的元数据，并对未分类候选 Fail-Closed。
- `next-app/tests/v2-m11-incentive-posted-budget-coverage-postgres.test.mjs` 已覆盖多 Program 聚合、幂等、非规范 Award ID、伪造 Credit provenance、异常奖池借方、元数据伪装和额外伪授权字段；写入仅在可回滚的独立测试事务中执行。
- `next-app/package.json` 已定义 `test:m11:postgres:r8-coverage`，**但未将该真库测试纳入 `test:invariants`**；仓库现有 `.github/workflows/next-app-ci.yml` 只运行 `npm test` 等既有门禁，也**未设置**真库用例所需的 `IWANTU_R8_POSTGRES_TEST=iwantu_test`。因此“CI 成功”不能推导出该新增测试已运行。
- `next-app/src/lib/ledger/ledger-posting.mjs` 的 canonical posting 对同一幂等键重算证据哈希；R8 当前只读 SQL 检查历史 `transactionHash` 的 **64 位小写十六进制形式**，**不会重算每笔历史 M2 canonical Ledger hash 或重新验证全链**。不能将“来源结构可分类”写成“历史签名/哈希/预算均已验真”。

## 2. 验收门禁（按阻断顺序）

| 门禁 | 最小证明 | 当前状态 | 不通过时动作 |
| --- | --- | --- | --- |
| G0 环境隔离 | 单独本机 `iwantu_test`、`schema=public`、显式 `IWANTU_R8_POSTGRES_TEST`；无生产数据 | **静态核对；未执行** | 停止测试写入 |
| G1 PostgreSQL 实跑 | 原生运行 `npm run test:m11:postgres:r8-coverage`，确认测试事务回滚和幂等键无残留 | **NOT_RUN** | 优先修复真实 SQL / fixture / 事务问题 |
| G2 工程回归 | `npm run test:invariants`、`npm run prisma:validate`、`npm run lint:m11`，条件具备时 `npm run typecheck`、`npm run build` | **NOT_RUN** | 不宣称工程验收通过 |
| G3 不可变事实与账本哈希 | 基于 M2 canonical 数据核查历史 hash、双分录、来源、链连续性及异常情况；不能只检查 hash 形式 | **未实现为 R8 闭环验收** | 保留“结构审计”标识 |
| G4 Program 治理及经济授权 | 不可变 Program 注册与授权根、版本化签名 Policy、预算增修证据、Nonce/收据与数据库唯一权益约束 | **PROPOSED，未形成受信经济写路径** | 禁止真实激励写入 |
| G5 规则可解释性 | R8 证据与 ReputationEvidence 独立；生成非处罚性 IntegritySignal；不得将结构异常自动认定舞弊 | **R8 闭环未完成** | 不进入 I0–I4 自动经济动作 |

## 3. 真库执行前的具体检查

1. 以连接器重新读出唯一目标仓库、`master` exact HEAD 和 R8 feature HEAD，确认所有开放 PR/reviews、最近 CI；避免对不一致的历史 SHA 修改。
2. 在隔离环境取得 **同一个 feature HEAD** 的完整工程依赖，以 Node/Prisma 既有契约执行测试；明确记录 Node、PostgreSQL、Prisma 版本和 exact HEAD。不能使用隔离 V8 smoke 冒充 Node/PostgreSQL PASS。
3. 确保 `DATABASE_URL` 只指向本机**新建的** `iwantu_test`，不能复用个人或客户数据库。先校验/迁移该独立测试库，再运行：
   ```bash
   cd next-app
   IWANTU_R8_POSTGRES_TEST=iwantu_test npm run test:m11:postgres:r8-coverage
   npm run test:m11:r8-p1i
   npm run test:invariants
   npm run prisma:validate
   npm run lint:m11
   npm run typecheck
   npm run build
   ```
   其中 Node/PostgreSQL/Prisma 依赖和环境必须事先齐备；本评审没有执行上述命令。
4. 真库验证中发生 `FAIL` 时，首先保留实际报错、错误 SQL/fixture、最小重现和期望不变量；修复后重跑相应负例，**暂停继续增加来源扫描特例**。
5. 提交 PR 之前确认是否允许 PR 自动触发 GitHub Actions（当前工作流监听 `pull_request`）；未经允许不得为“获得 CI 结果”创建 PR 或主动运行付费 CI。

## 4. 下一步建议与风险边界

**下一交付切片优先级：G1 真库运行与失败收敛，高于新的 R8 候选规则。** G1/G2 不能运行时保留 `NOT_RUN`；随后围绕 G3/G4 分离交付可审查的数据库事实模型，不把 Draft preflight 直接接到 M2 发奖。跨政策权益身份是候选证据，数据库唯一约束未落地；奖励预算不可依据抽样观察窗计算。Issue #44 的执行 AgentVersion 只能绑定到未来明确的签名、不可变经济证据边界，不得从当前活跃版本倒推历史。

严禁：改写 Ledger/历史证据、自动施加经济处罚、真实发奖、合并 master、force push、删除用户数据，或将协议底座进展称为完整产品上线。
