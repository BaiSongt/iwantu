# R8 单独政策撤销与分支推送

日期：2026-10-25（香港时间）。已通过 SSH 将依赖修复、治理与原子发奖及在线 API 基线推送为提交 [`0bfb9da`](https://github.com/BaiSongt/iwantu/commit/0bfb9da857bd2e68d0c77048b566774ee347910b)，分支为 [`feature/v2-m11-r8-postgres-validation`](https://github.com/BaiSongt/iwantu/tree/feature/v2-m11-r8-postgres-validation)。本切片在此基础上增加单独政策撤销。

## 行为与授权

治理方可通过固定治理签名密钥和实时、精确的 `incentive.policy.revoke` Mandate，停用某个已经发布的政策。撤销协议为 `iwantu.incentive-policy-revocation/0.1`，签名载荷绑定 Program、政策摘要及 `security`、`policy_error`、`superseded`、`operational` 之一的原因代码。

这是非货币命令：不要求 IWC 金额上限，授权快照中的 `economic` 固定为 `null`。身份、API 凭据、治理根、公钥、独立 Ed25519 签名、Mandate action、命令期限和跨 action Nonce 唯一约束仍完整生效。客户端不能指定生效时间、金额或自述授权。

撤销与发奖共用 M2 全局事务锁。若发奖先提交，其奖励保持；若撤销先提交，新发奖被拒绝。撤销不删除或修改政策、历史奖励、Ledger、Reputation 或收据，旧命令的精确重放也不重新消费预算。其他政策版本继续使用原有共享预算和跨版本权益去重域，撤销不会重置预算或退款。

## 数据库门禁

新增第 37 个迁移 `20261025123000_v2_m11_incentive_policy_revocation`，保留旧迁移及其校验和。撤销事件保存授权引用、规范证据摘要和服务器时间，每个政策仅有一条，禁止 UPDATE/DELETE。

数据库扩展精确 action 白名单，只有撤销 action 可使用非货币授权快照，且授权与撤销记录必须相互绑定。新奖励绑定在插入时和延迟提交时检查政策撤销状态。撤销侧另检查本事务已新增的绑定，防止直接 SQL 提前切换 `SET CONSTRAINTS ... IMMEDIATE` 后清空延迟事件。内部事务来源标记由触发器使用顶层事务 ID 写入，涵盖 savepoint；旧记录保持空值，签名政策、奖励载荷、收据及摘要均不改写。

SQL 门禁验证结构与授权证据绑定；实际 Ed25519 验证仍由可信服务器服务完成，数据库所有者仍属于可信运维边界。

## 在线 API

新增 `POST /api/v2/incentives/programs/{programId}/policies/{policyHash}/revocations`，严格请求体为 `{revocation, commandEvidence, signature}`，两个路径标识必须与载荷一致。首次提交返回 201，精确重放返回 200；新命令再次撤销返回 `409 R8_POLICY_ALREADY_REVOKED`，新发奖使用已撤销政策返回 `409 R8_POLICY_REVOKED`。

计划 GET 的政策项增加同级 `revocation`，值为 `null` 或显式撤销 DTO；冻结政策正文和 `policyHash` 保持原样。旧奖励 GET 仍返回相同收据。沿用真实 v2 Bearer 认证、主体可见性、32 KiB/10 秒 JSON 边界、凭据限流、`no-store` 和错误脱敏。默认空治理配置继续关闭写入。

## 验证与边界

新增真实 PostgreSQL 和生产 standalone HTTP 回归覆盖非货币精确授权、并发幂等、旧奖励重放、独立政策版本、错误签名/密钥/action/Nonce、撤销根密钥、追加事实不可变、插入故障回滚及相同 Nonce 重试、发奖与撤销竞态，以及延迟/立即约束和 savepoint 的直接 SQL 门禁。CI 的既有数据库/API 聚合脚本已纳入这些测试，并增加对应 ESLint 步骤。

本轮从新建本机 `iwantu_test` 数据库串行验收，**485/485 PASS，0 FAIL、0 SKIP**：416 项协议/HTTP 契约不变量、30 项 R8 PostgreSQL（含 9 项撤销）、19 项生产 HTTP API（含 7 项撤销）、14 项生产安全 HTTP、6 项依赖兼容性。37 个迁移、Prisma Validate、14 组定向 ESLint、Typecheck、生产 Build 均 PASS；完整依赖审计为 0 vulnerabilities。Build 保留既有 storage 动态文件系统 tracing 警告，Prisma 保留既有配置弃用提示。

实际环境为 Node 22.16.0、Prisma 6.19.3、PostgreSQL 16.15（本机 WSL 临时集群，端口 55436）。本地日志为 `next-app/revocation-final-*.log`、工作区外 `F:/code/iwantu-build-revocation.log` 与 `F:/code/iwantu-revocation-quality.log`，均不提交。HTTP 服务器由测试关闭；验收结束后停止本轮临时 PostgreSQL 集群。Docker PostgreSQL 15 尚未验证。

此次仅开发和推送功能分支，没有合并 `master`、部署服务或选择真实生产治理身份。远端 Actions 当前仅在 PR 或 `master` 推送触发，不能将功能分支推送视为远端 CI 通过。R8 风险统计规则、预算修订、治理密钥轮换、历史计划迁移、R7 验收、MCP/界面和 Issue #44 仍待后续工作。
