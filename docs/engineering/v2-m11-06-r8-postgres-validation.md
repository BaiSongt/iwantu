# M11 R8 PostgreSQL 验收与最小金额修复

日期：2026-10-25（香港时间）。起点：R8 分支 `c622dce`；主分支 `d80e88e`。

> 本文件记录先完成的只读事实层验收。后续 Next.js 安全升级、治理及原子发奖实现和最终验收已更新至[后续记录](./v2-m11-06-r8-governance-atomic-awards.md)；下文“尚待处理”是该阶段结束时的历史状态。

## 开发进展

M1–M10 已在主分支形成协议底座，M11 R1–R6 已合并。R7 和 R8 分别在功能分支开发；本次接续最新 R8 分支，落实此前验收评审要求的 G1/G2。R8 仍属于只读事实检查和候选预检，尚无可信 Program 治理、原子发奖或正式风险裁决能力。产品端到端切换未完成。

## 实际发现与修复

1. **奖励查询的数据库时区依赖**：Prisma 将 Date 参数绑定为 `timestamptz`，直接转换为 `timestamp` 会受会话时区影响。Asia/Shanghai 下，合法奖励查询返回空集。查询改为显式 `AT TIME ZONE 'UTC'`，与数据库内 UTC `postedAt` 比较；真库回归覆盖 UTC、Asia/Shanghai、America/New_York 以及左右时间边界。
2. **最小 IWC 单位解析失败**：Prisma Decimal 的字符串形式可能为 `1e-8`。账本余额聚合改用数据库 `numeric::text`，已存分录、报价及结算金额在相应读取边界使用固定小数表示；外部输入仍执行原有严格校验。回归覆盖最小单位扣款、透支拒绝、幂等重放、签名报价成约及托管、双方各 `0.00000001` 的并发拆分结算。
3. **保留既有签名兼容性**：签名接受证据的价格使用不补尾零的 `Decimal.toFixed()`，保留既有 `25.5` 的签名内容；内部已规范化到八位的金额继续使用 `toFixed(8)`。不改写已签名的历史证据或账本哈希。
4. **落实 CI 真库门禁**：新增 `npm run test:m11:postgres` 串行运行两组 R8 真库测试，并接入 CI。必须在迁移后、通用 invariants 前运行，避免历史完整性审计被 M2 故意创建的异常负例污染。
5. **统一测试目标校验**：两组 R8 真库测试共用连接检查，要求显式 opt-in、本机 `iwantu_test`、默认 public schema；拒绝连接参数覆盖。新增正反例验证。

## 本机验收

运行环境：Windows Node.js 22.16.0、npm 11.4.2、Prisma 6.19.3；WSL Ubuntu 24.04 上新建独立 PostgreSQL 16.15 测试集群。没有连接生产数据库。Docker Desktop 启动异常，经用户允许改用本机 PostgreSQL。

- 全部 35 个迁移：PASS。
- R8 两组 PostgreSQL 测试：5/5 PASS，覆盖合法奖励、跨 Program、来源伪造、异常奖池借方、额外伪授权字段及事务回滚。
- R8 现有纯函数/模拟查询测试：90/90 PASS。
- 新增测试目标校验：2/2 PASS。
- 完整 `npm test`：386/386 PASS，0 FAIL，0 SKIP；包含 M2、M4、M8 最小金额集成回归。
- `lint:m2`、`lint:m3`、`lint:m4`、`lint:m8`、`lint:m11`：PASS，0 错误、0 警告。
- Prisma Validate、Typecheck、生产 Build：PASS；Compose 配置静态校验 PASS。

完整协议测试按现有部署/CI 使用 UTC 数据库会话。旧 M4 过期判断仍有数据库时区假设；本次跨时区保证仅针对 R8 奖励读取，不代表所有旧协议均支持任意数据库时区。旧不变量测试含固定哈希及不可变负例，应在新建测试库上运行。

验收结束后，已停止本次创建的 WSL `16/iwantu_r8`、`16/iwantu_verify` 集群，保留数据和日志供排查；未改动原有 `16/main` 集群。原生执行日志保留在本地 `next-app/*-validation.log`，不提交 Git。

## 复现

Docker 就绪时，仓库新增的 Compose 文件提供只绑定本机端口、使用临时内存数据目录的 PostgreSQL 15，与 CI 主版本一致：

```powershell
docker compose -p iwantu-verification -f docker-compose.test.yml up -d --wait
cd next-app
$env:DATABASE_URL = 'postgresql://postgres:postgres@127.0.0.1:55432/iwantu_test?schema=public'
$env:IWANTU_R8_POSTGRES_TEST = 'iwantu_test'
$env:JWT_SECRET = 'local-test-only-jwt-secret-do-not-use-in-production'
npm ci
npm run prisma:generate
npm run prisma:migrate:deploy
npm run test:m11:postgres
npm test
npm run lint:m2
npm run lint:m3
npm run lint:m4
npm run lint:m8
npm run lint:m11
npm run prisma:validate
npm run typecheck
npm run build
```

重新开始完整验收前，停止并重新创建此临时测试容器，保证新库。该 Compose 配置不得用于生产。此次实际运行版本为 PostgreSQL 16，Docker PostgreSQL 15 和远端 GitHub Actions 尚未执行。

## 尚待处理

- M11 R7 独立分支的真实数据库验收与合并；R8 可信治理、不可变收据、权益唯一约束和原子写入；M11-07/08。
- 执行 AgentVersion 的不可变绑定（Issue #44）；不得用当前版本倒推历史。
- 现有依赖审计返回 14 项漏洞（1 critical、12 high、1 moderate），其中 critical 属于 Next.js；本次没有修改依赖锁文件。构建仍有原有 storage 路径 tracing 警告。
- 本次只验证源事实的结构与确定性，不将历史 hash 形式检查表述为全链密码学验真。
