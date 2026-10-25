# 依赖告警清零与 R8 在线 API

日期：2026-10-25（香港时间）。本记录接续[治理与原子发奖首切片](./v2-m11-06-r8-governance-atomic-awards.md)。变更尚未推送或部署。

## 先修复全部依赖告警

对完整依赖树执行审计，包括开发依赖。原有 9 high、1 moderate 共 10 项告警已清零，没有通过忽略、降低审计阈值或仅审计生产依赖隐藏问题。

| 告警来源 | 处理结果 |
| --- | --- |
| Nodemailer | 升级到 10.2.1；使用内置类型，移除旧 `@types/nodemailer` |
| Zod | 锁文件更新到 4.6.7 |
| brace-expansion | 两条依赖分支分别更新到 1.1.21、5.0.12 |
| js-yaml | 更新到 4.3.2 |
| browserslist | 更新到 4.29.4 |
| baseline-browser-mapping | 更新到 2.11.32 |
| source-map-js | 更新到 1.2.2 |
| deepmerge-ts 及其 Prisma/@prisma/config 传递告警 | 仅对 `@prisma/config` 限定覆盖为 deepmerge-ts 8.0.2；Prisma 保持 6.19.3 |

deepmerge-ts 的[官方公告](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx)确认修复线为 8.x。[Nodemailer 10.2.1](https://github.com/nodemailer/nodemailer/releases/tag/v10.2.1)使用新的内置类型和双模块入口。限定覆盖保留了当前 Prisma Client、连接方式和既有经济协议，不需要为间接依赖告警强行升级 ORM 主版本。

开始 API 开发前已完成：干净 `npm ci`（0 vulnerabilities）、实际 Prisma CJS/ESM 配置加载、递归图安全回归、Nodemailer 本地 stream/JSON 邮件编码、Prisma 生成/校验/36 个迁移、394 项协议测试、21 项 PostgreSQL 测试、14 项生产 HTTP 安全测试和 6 项依赖兼容性测试。没有发送 SMTP 邮件。

CI 使用 `npm run audit` 检查全部严重级别，并运行依赖兼容性回归；限定覆盖及其兼容性测试应在后续 Prisma 升级时一起复核。

## 新增在线路由

| 方法和路径 | 功能 |
| --- | --- |
| `POST /api/v2/incentives/programs` | 提交已签名的治理登记 |
| `GET /api/v2/incentives/programs/{programId}` | 治理方/执行方读取计划及最近 50 条政策，返回 `hasMorePolicies` |
| `POST /api/v2/incentives/programs/{programId}/policies` | 提交已签名的 0.2 政策 |
| `POST /api/v2/incentives/programs/{programId}/awards` | 为真实终局 Settlement 原子发奖 |
| `GET /api/v2/incentives/programs/{programId}/awards/{awardId}` | 治理方、执行方或真实受益方读取该奖励收据 |

全部使用 Node.js 动态 Route Handler，独立验证 `Authorization: Bearer <v2 Agent API Credential>`。Cookie、旧 v1 API Key、`x-user-id`/`x-user-role` 或请求体中的身份声明均不能替代认证。写入仍由原有治理服务重新验证实时凭据、独立 Ed25519 签名、精确 Mandate action、预算、政策和终局事实。

服务器配置 `IWANTU_INCENTIVE_TRUSTED_PROGRAMS={}` 仍默认关闭写入。非空配置下，不相关主体会在业务查询和 Ledger 锁前统一收到 403，避免根据政策/Settlement 错误探测其他计划。读取则在 SQL 中按真实 Principal 限制可见性；不存在和不可见资源均返回 404。配置停用后，已提交凭证仍可由合格的活跃身份读取。

## 请求与签名

注册请求严格为 `{registration, commandEvidence, signature}`；政策请求为 `{policy, commandEvidence, signature}`；发奖请求为 `{programId, policyHash, settlementId, commandEvidence, signature}`。政策/发奖载荷的 Program 必须与 URL 一致。

客户端先使用 `governance-protocol.mjs` 的规范载荷构造器，再使用现有 `buildEconomicCommandEvidence` / `hashEconomicCommandEvidence` 对载荷摘要建立签名命令，使用注册的 Ed25519 私钥签署命令 SHA-256 的原始 32 字节。仅提交 base64url 签名；私钥不提交给 API。

注册载荷绑定受信配置中的治理身份、公钥摘要、执行主体和预算；调用者必须事先与运营方确认这些配置，不能通过注册请求自行授予治理权。奖励金额、角色、槽位和受益者由被冻结政策与真实终局结算推导，不能从发奖 JSON 指定。

首次成功返回 201；同一已提交命令的精确重放返回 200 和 `idempotent: true`，不会再次发奖。新 Nonce、政策版本或请求路径均不能绕过跨版本权益唯一约束。可通过 GET 收据查询已提交结果。

## HTTP 边界

- 仅接受未压缩的 `application/json`，按实际字节限制为 32768，不能靠缺失或伪造 Content-Length 绕过。
- 读取请求体有总计 10 秒期限，超时/中断/超量会取消读取并清理监听器、读取锁和定时器。
- JSON 所有层级采用严格字段集；不接受 `authentication`、受信配置、AuthoritySnapshot 或自述授权标志。
- 每个已验证 API Credential 每进程每分钟最多 60 个 R8 请求，超限返回 429 和 Retry-After；多实例生产仍需共享网关限流。
- 所有接口结果为 `Cache-Control: no-store`。返回显式 DTO，不暴露 API Token、凭据哈希、原始签名、完整授权记录或内部 SQL。

应用层错误统一为 `{error: {code, message}}`，消息由固定白名单生成：401 无有效 v2 凭据，403 无权操作，404 不存在/不可见，408 读取超时，409 状态/Nonce/权益/预算冲突，413 超量，415 非 JSON/压缩体，422 不符合政策，429 限流，503 未启用或认证/配置不可用。未知数据库错误返回通用 500；R8 适配层日志只记录错误类别，不输出原始 ORM 查询数据。

## 执行顺序与验证

在线 E2E 使用实际构建的 standalone 服务器、真实 Bearer 凭据、签名注册/发布、M3→M5 交易与终局 Settlement；不通过模拟 Handler 冒充在线验收。测试为独立本机 `iwantu_test` 数据库创建隔离计划与密钥，没有配置真实生产计划。

CI 顺序调整为：安装与全级别审计 → 依赖兼容性 → Prisma 生成/迁移 → Build → R8 PostgreSQL 与 HTTP E2E → 通用协议不变量与其他检查。HTTP 发奖必须在通用 Ledger 负例污染历史覆盖之前验证。

最终按 CI 顺序从新建测试库执行，**464/464 PASS，0 FAIL、0 SKIP**：411 项协议/HTTP 契约不变量、21 项 R8 PostgreSQL、12 项实际 HTTP E2E、14 项生产安全 HTTP、6 项依赖兼容性。36 个迁移、Prisma Validate/Generate、M1–M11/R8/API/依赖测试 ESLint、Typecheck、Build、干净 `npm ci` 和全级别依赖审计均 PASS；审计所有级别均为 0。构建保留既有 storage 动态文件系统 tracing 警告。

本地原生日志为 `next-app/online-final-*.log`、`next-app/api-*.log`、`next-app/deps-*.log`（Git 忽略）。实际环境为 Node 22.16.0、Prisma 6.19.3、PostgreSQL 16.15。远端 Actions、Docker PostgreSQL 15 和外部部署尚未执行。验收结束后停止本次使用的临时数据库集群；测试 HTTP 服务器由测试自动关闭。

R8 风险规则、独立政策撤销、预算修订、治理密钥轮换、历史计划迁移、R7 分支和 Issue #44 仍不属于本次在线接入的完成范围。
