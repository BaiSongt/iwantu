# R8 治理登记与原子发奖：首个可执行切片

日期：2026-10-25（香港时间）。在上一轮 PostgreSQL 验收基础上继续开发；修改尚未推送或部署。

> 本记录对应治理首切片。当时剩余的 10 项依赖告警及未接入 HTTP 的状态，已在[后续依赖清零与在线 API 记录](./v2-m11-06-r8-online-api.md)更新；下文保留本阶段验收事实。

## 先行安全修复

已将 `next`、`eslint-config-next` 从 16.2.6 同步锁定到 16.4.3，更新依赖锁文件；Next 使用的 `sharp` 为 0.35.5。复核了官方 [SVG 图像处理 RCE 公告](https://github.com/vercel/next.js/security/advisories/GHSA-2464-fhr4-w9xw)和 [Cache Components RCE 公告](https://github.com/vercel/next.js/security/advisories/GHSA-673q-mjm6-r5xr)。

推进 R8 前，已实际通过 386 项原有协议测试、类型检查、相关 ESLint、生产构建及 14 项 HTTP 鉴权检查。`npm audit` 不再列出 Next.js、sharp 或 postcss 漏洞，critical=0；仍有其他依赖的 9 high、1 moderate。此次没有强制升级 Prisma 或 Nodemailer 的主版本。

CI 新增 `audit:critical` 阻断严重依赖漏洞，并在构建后运行 `test:security:smoke`。HTTP 测试自动启动和关闭 standalone 生产服务器，覆盖无 Cookie、无效 Cookie、伪造身份头/中间件头、受保护页面跳转及 API 独立鉴权。

## 已落地的治理契约

- 服务模块：`next-app/src/lib/incentives/governance-service.mjs`。入口为 `registerProgram`、`publishPolicy`、`awardForSettlement`，均使用现有 v2 AgentCredential 身份、Ed25519 签名和实时 Mandate。
- 治理根来自受信服务器配置，明确绑定 Program、治理 Principal、签名 keyId、公钥摘要、发奖执行 Principal、预算上限。不存在按 admin 角色推断治理权的逻辑；注册命令自称的 issuer 也不能建立信任根。
- 注册、政策发布、发奖使用三个精确 action：`incentive.program.register`、`incentive.policy.publish`、`incentive.award.issue`；通配符授权不足以执行。Mandate 的 `economicLimits` 必须含 IWC 币种和规范八位小数字符串 `singleContract` 上限。注册核对整个预算，发布/发奖核对单笔固定奖励。
- 注册预算不可变，所有政策版本共享同一 Program 预算。当前支持固定金额、终局 Settlement、buyer/supplier 角色和显式 awardSlot；不支持预算增修、资金兑换或自动信用铸造。
- 政策协议显式升级为 `iwantu.incentive-program-policy/0.2`，去重域为 `program_settlement_role_slot`。旧 0.1 草案及其哈希不改变，也不会被默认为新授权政策。

## 原子性和数据库门禁

新增迁移 `20261025110000_v2_m11_governed_incentive_awards`，创建四张追加式表：

| 表 | 含义 |
| --- | --- |
| `r8_incentive_programs` | 配置指纹、治理身份、执行身份、共享预算和签名注册来源 |
| `r8_incentive_authorizations` | 签名命令、身份/签名凭据、AuthoritySnapshot、唯一 Nonce |
| `r8_incentive_policies` | 不可变政策版本、规范 SHA-256、发布授权 |
| `r8_incentive_award_bindings` | 终局 Settlement、真实受益方、奖励分录和授权的不可变绑定收据 |

服务先取得现有 M2 全局 Ledger advisory lock，再核验实时身份、政策、全历史已 POSTED 支出、授权和余额，并在一个事务内写入授权、M2 标准双分录及绑定收据。不会在 Ledger 锁后获取 Contract/Escrow 行锁；Settlements 与合同经济当事人为不可变读取。受益方账户必须已存在，避免在账本锁内创建账户造成反向锁序。

资格必须由政策发布后形成的真实终局 Settlement 触发，结算时间和发奖时间均在政策窗口内。受益 Principal 从不可变 Contract 的 buyer/supplier 推导，调用者不能指定另一个收款人。新发奖要求受益 Principal active；精确重放只返回已经提交的结果，可在之后停用或过期时读取原收据。

数据库拒绝四表 UPDATE/DELETE，以 `UNIQUE(programId, settlementId, beneficiaryRole, awardSlot)` 保护跨政策版本权益，以 Principal/Nonce 唯一约束防止跨动作重放。提交门禁要求受治理 Program 的新奖励必须同事务附带有效绑定，旧 M2 内部发奖方法不能绕过。失败会同时回滚授权、Nonce、奖励和收据。

SQL 独立校验规范哈希、实时身份/治理根、授权快照、政策条件、金额、标准 debit/credit、provenance 与预算；**Ed25519 验签和服务器配置的可信性由服务负责**。数据库管理员仍有管理权限，不能把数据库字段检查描述为数据库内的签名验真；数据库写凭据应仅交给受信服务。

## 配置和接入

`IWANTU_INCENTIVE_TRUSTED_PROGRAMS` 默认 `{}`，可通过 `createIncentiveGovernanceServiceFromEnvironment()` 在受信服务启动时读取。映射中的每项必须完整声明：

```json
{
  "example-program": {
    "governancePrincipalId": "configured-principal-id",
    "governanceSigningKeyId": "configured-signing-key-id",
    "governanceKeyHash": "sha256-of-the-canonical-stored-public-jwk",
    "awardIssuerPrincipalId": "configured-award-executor-id",
    "maximumBudgetIwc": "100.00000000"
  }
}
```

上述值仅示意，公钥摘要必须为真实的 64 位小写 SHA-256，配置不得来自用户请求。修改与注册不一致的配置会拒绝后续写入；移除配置、吊销治理签名凭据、停用治理主体可关闭新奖励。当前没有单独政策撤销、预算修订或密钥轮换收据，需另行扩展协议。

本次没有选择任何真实治理身份、配置生产计划或发放真实奖励，也没有新增在线 HTTP/MCP/界面入口。将来接入时必须先使用现有认证层取得 v2 authentication context，再调用服务；不能从请求 JSON 构造认证上下文或信任根。

## 验收与边界

首轮已通过 36 个迁移和 16 项独立 PostgreSQL 治理/发奖测试，包括并发幂等、跨版本去重、买卖双方受益、最小单位、预算耗尽、奖池不足、撤销、旧入口绕过、历史计划拒绝静默升级、收据写入故障回滚及 Nonce 可重试。测试真实执行 M3→M5 签名交易和终局结算，没有伪造 Settlement。

最终在新建测试库从空库执行：36 个迁移、394 项协议不变量、21 项 R8 PostgreSQL 测试（含 16 项治理/原子发奖）、14 项生产 HTTP 安全测试全部 PASS，0 FAIL、0 SKIP。`npm ci`、M1–M11/R8/安全测试 ESLint、Prisma Validate、Typecheck、Build 和 critical 审计门禁均 PASS。生产构建仍报告既有 storage 动态文件系统 tracing 警告。

环境为 Node 22.16.0、Prisma 6.19.3、独立 PostgreSQL 16.15；CI 配置使用 PostgreSQL 15，远端 Actions 尚未执行。本地原生执行日志在 `next-app/final-*.log`（Git 忽略）。

验收结束已停止本次使用的临时 WSL 测试集群，保留测试数据及日志；原有 `16/main` 集群未启用或修改。没有常驻测试 HTTP 服务器。

在新建的独立 `iwantu_test` 数据库上，先运行 `prisma:migrate:deploy` 和 `test:m11:postgres`，随后运行 `npm test`；通用 Ledger 负例会故意产生未分类历史事实，因此不可颠倒顺序。再执行 `lint:r8-governance`、相关里程碑 lint、Prisma Validate、Typecheck、Build、`test:security:smoke` 与 `audit:critical`。

本切片没有改写历史 Ledger、ReputationEvidence、现有候选协议或旧奖励归因状态；已有历史支出的计划需单独签名迁移方案。全历史覆盖发现未分类支出仍会拒绝新发奖。R8 风险统计阈值与 IntegritySignal、M11-07/08、R7 独立分支和 Issue #44 的执行 AgentVersion 绑定仍待后续开发。
