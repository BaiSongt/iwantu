# iWANTU V2-M11-06｜R8-B2 政策与授权来源审计（P0）

状态：**REVIEW REQUIRED / 仅设计证据**。日期：2026-10-24。关联 Issue #48；Issue #44 的执行 AgentVersion 证据绑定不包含在本切片内。

> 结论：现有 M2 发奖账本可证明“谁收到了多少 IWC”，现有终局 Settlement 可证明“哪一项合同如何结算”，但仓库当前**没有可直接复用的、已验证并冻结的 Incentive ProgramPolicy 与针对发奖动作的授权收据**。不能把调用参数、Ledger metadata.details、M1 AuthoritySnapshot 或 B1 候选哈希当作这些缺失的事实。R8-B2 不应直接落库一个声称 `verified` 的奖励触发绑定。

## 一、逐层核对的现有来源

| 已有来源（master） | 可以证明 | 不能证明 |
| --- | --- | --- |
| `next-app/src/lib/ledger/incentive-awards.mjs` 的 `awardProtocolIncentive` | 已存在的 Principal 为 active，调用 M2 发奖，有限 `system_incentive` 池向受益 Principal 的 `principal_available` 入账；交易包含 programId/awardId/beneficiaryPrincipalId | 发奖时采取了哪一版不可变政策、是否有独立已认证发奖授权、是否由某一 Settlement 触发。输入 `metadata` 是可选调用参数，不是认证材料 |
| `20260905110000_v2_m2_ledger_accounting_foundation`、M2 后续约束 | LedgerTransaction/Entry 双分录、入账后不可变、哈希、幂等和账户约束 | `programId` 指向哪一条冻结政策，或一个奖励与一个终局结算的因果关联 |
| `20260905101500_v2_m1_authority_snapshot` 和 `authority-snapshot.mjs` | 在先行实时身份/授权解析通过后，保留主体、Agent、Mandate、签名请求上下文等历史证据 | AuthoritySnapshot **不是**新的授权来源；存在快照不自动意味着有权限发放激励。尤其不能凭当前有效 Mandate 重建历史批准 |
| `20260914173000_v2_m5_atomic_settlement_foundation` 与 M6/M8 后续迁移 | `settlements` 绑定终局经济事件、合约、结算哈希及对应 LedgerTransaction | 该结算按哪个奖励计划应得多少奖励，或应由哪个 Principal 领奖 |
| `20260919161000_v2_m9_terminal_reputation_evidence` | ReputationEvidence 源于终局 Settlement，按主体/角色形成不可变证据 | 不能充当奖励政策或发奖授权；更不能把奖励频次本身判作舞弊 |
| R8-B1 `incentive-trigger-binding-draft.mjs` 与 B2 只读 `incentive-trigger-source-inspection.mjs`（开发分支） | 候选结构/哈希一致性；Ledger 奖励事实与指定终局 Settlement 的存在性、金额和时间相容 | **没有**从冻结政策或授权收据验证输入 `programPolicyHash`、`triggerEvidenceHash`、`authorityEvidence`；现在返回 `attributionStatus=unavailable` 是正确的 Fail-Closed 行为 |

审查了 `master` 的 Prisma 模型及现有 SQL 迁移目录：现有已建模对象中没有可供 R8 直接查询的、专用不可变 Incentive ProgramPolicy Revision / Award Authorization Receipt。此结论限定于本次核查的代码与数据库结构，不代表对未来治理设计作出决定。

特别注意：M2 `awardProtocolIncentive` 本身接收程序内的受益 Principal、奖励标识、金额和可选 metadata，未在函数内验证经过签名的奖励政策或与 Settlement 的对应关系。这是**尚未建模的协议授权边界**；不应在没有 API 可达性审计的情况下推断外部用户可以直接调用该函数。

## 二、待评审的最小协议决策

**D1：冻结政策来源（必须先于归因）**。建议新增 append-only `incentive_program_policy_revisions`，每条冻结 `programId`、无歧义 `policyVersion`、规范哈希、允许的 `triggerType`、可奖励的终局结果/主体角色、计奖公式和封顶规则、资格时间窗口、去重粒度以及发布者授权证据。历史版本不可 UPDATE/DELETE；停用应追加撤销/终止事实，而不是修改旧政策。未经授权的政策修订不得被发奖链路消费。

**D2：授权事实与身份**。建议单独定义 `incentive_award_authorization_receipts`，绑定已验证的**签名命令摘要、签名凭据、实际授权主体、实时权限解析证据、ProgramPolicy revision/hash、受益 Principal、触发 Settlement、规范金额、授予时间**。发布政策的治理授权与实际发奖授权是不同动作，必须分别裁决；不得从 `authority_snapshots` 是否存在推断是否已授权，也不得依赖调用方传入的 `authorized=true`。签名与 Mandate 的具体 action/capability、授权发布者归属、平台经济操作身份仍须先在业务契约中决定。

**D3：可信绑定收据**。在 D1/D2 可被真库复核后，再建立 `incentive_award_trigger_bindings`。至少以已 POSTED 的奖励 LedgerTransaction ID 作唯一键，外键限制删除地绑定 Settlement、冻结政策修订和授权收据；固定候选收据的 `receiptHash`，数据库核对奖池 debit/受益 credit、金额/币种、奖励元数据与 provenance、终局 Settlement/hash、政策资格和角色归属，任何不符均拒绝。不能仅由传入 JSON 自述“verified”。

**D4：重放身份与并发**。新协议的 programId/awardId 必须使用无歧义规范编码，不更改旧 M2 `credit:incentive-award:<programId>:<awardId>` 历史。新发奖命令的幂等身份至少绑定冻结 policyRevision、trigger Settlement、资格主体及政策规定的奖励槽位；“一个 Settlement 只能领一次”与“一个 Settlement 可以依据不同计划/角色合法多次领奖”应由冻结政策明确决定，而不是凭空增加通用唯一约束。重复完全相同命令应返回同一已认证凭证，冲突载荷必须报错。

**D5：原子性和锁顺序**。B3 必须先通过当前实时认证、签名和政策门禁，在与现有 `postLedgerTransactionInTransaction` 兼容的事务中同时写入奖励与三类收据，失败整体回滚；不得另造 Ledger 锁序。M5 Settlement 路径存在合约/托管/账本锁交互，方案评审时须列出锁顺序，验证并发与重试，而非仅以“单事务”声称安全。

## 三、B2 数据库评审前的硬门禁

| 检查 | 不可省略的验收证据 |
| --- | --- |
| 不可变性 | 新政策修订、发奖授权收据、触发绑定收据的 UPDATE/DELETE 均由 PostgreSQL 触发器拒绝；FK `ON DELETE RESTRICT`；仅新增迁移，不回填、不更改已 POSTED Ledger |
| 授权 | 签名消息/Nonce/凭证主体/实时 Mandate 权限/政策发布者或发奖执行者职责均可验证；过期、吊销、跨 Principal、权限错配负例拒绝 |
| 政策 | 精确政策版本与哈希、允许的 Settlement 类型/受益角色/金额计算、时间范围、超额与重复颁奖规则；不能查询“当前最新政策”替代历史依据 |
| Ledger/Settlement | 两条标准借贷分录、对应入账交易哈希、收益者及金额一致；Settlement 已终局且时间不晚于发奖；旧奖励无收据必须保持 `unavailable` |
| 并发/幂等 | 同一发奖命令并发最多产生一份奖励；不同载荷复用幂等键拒绝；任意插入步骤失败时账本/授权/绑定收据一起回滚 |
| 规则投影 | 只有完整可验证的收据链能进入 R8 统计候选；`unavailable`/`not_applicable`/`invalid` 均不能自动产生 R8 风险信号，不写 ReputationEvidence/Trust，不执行 I0–I4 经济处罚 |

## 四、建议下一切片及停止条件

**R8-P1（下轮优先）**：先写可审查的政策修订与签名授权命令规范（纯函数规范化/哈希黄金向量及正反例）；确认 Program 的治理 Principal、授权 action/capability、合法计奖公式与去重粒度。只允许测试/设计，不接入发奖写入。

**R8-B2（P1 评审通过后）**：只增量迁移不可变政策/授权/绑定表与数据库 Fail-Closed 触发器，建立独立 `iwantu_test` 的结构/防篡改验收；没有经审核的政策/授权写入路径，不得产生声称 `verified` 的实收据。

**R8-B3/B4**：再单独实施已授权的原子发奖与只读 R8 规则。涉及信用、签名、政策版本、历史证据的任何缺口均不能靠降级校验绕过。

**当前验证标记**：本 P0 是审计文档，不新增可执行代码。Node invariants、Prisma Validate、ESLint、Typecheck、Build、PostgreSQL E2E 在本切片均 **NOT_RUN**。开发分支早期 B1/B2 模拟或独立测试的历史记录不能替代本轮 exact-HEAD 集成验收。本审计也不表示已实施新政策、授权或处罚。

## 五、与其他分支的关系

- `master`：截止本次核验 `d80e88e35af30e4473aa7eeffde91dcf8d953d09`，R1–R6 是已合并基线；本文件并未进入 `master`。
- R7 `feature/v2-m11-genesis-credit-loop`：Genesis 来源校验属于独立切片，真库验收未完成，不挪用其结果作为 R8 的归因证明。
- Issue #44：执行 AgentVersion 必须绑定到有签名的经济证据；该方案不将当前 AgentVersion 推断为历史执行版本。
- README/里程碑：保持“协议基础已进展但产品未上线”的区分。未经过 PR 评审与完整门禁不得写成 R8 COMPLETE。


## 六、R8-P1a 候选政策修订结构与确定性哈希（2026-10-24）

本切片新增 `next-app/src/lib/integrity/incentive-program-policy-draft.mjs` 与 `next-app/tests/v2-m11-incentive-program-policy-draft.test.mjs`，版本标签 `iwantu.incentive-program-policy/0.1`。它只做**候选政策快照的输入规范化与哈希**，没有持久化政策、核验发布者身份、验证任何签名或执行奖励经济写入。

候选结构精确限定为 `programId`、`policyVersion`、`issuerPrincipalId`、`triggerType=terminal_settlement`、显式且不重复的 `eligibleSettlementTypes`、`beneficiaryRole=buyer|supplier`、`awardSlot`、`rewardFormula={kind:fixed_amount,amountIwc}`、`effectiveFrom/effectiveUntil` 及 `deduplicationScope=program_policy_settlement_role_slot`。当前只定义 **定额 IWC** 候选公式，其他计奖方式须单独版本化设计，不能作为现有已支持能力。时间区间采用前闭后开的建议语义，未来消费侧还需验证真实 Settlement 的时点、角色和预算。

拒绝未知字段、对象原型污染、含冒号的歧义标识、重复终局类型、非规范 UTC 时间、非法金额或非 Decimal(36,8) 字符串、零额度及时间倒置。支持字段与可枚举终局类型重排后生成同一 SHA-256；修改身份、结算类型、角色、金额、奖励槽位或有效期均改变摘要。黄金向量：

`63566eaefba6f45cc822e32c200f25852b6e31fa2e5362ed4ee09da52dfb03f3`

关键边界：`issuerPrincipalId` 是**候选字段**，不是已验证的政策发布治理主体；`policyHash` 是候选内容摘要，不是签名证明、数据库不可变事实、M1 AuthoritySnapshot 或发奖许可。尚未批准 `incentive.policy.publish` 等具体 Mandate action/capability，也没有建立程序治理 Principal、政策版本全局唯一性、重叠生效窗口禁止或跨版本重复奖励约束。这些必须在 P1b / B2 中由签名授权与 PostgreSQL 事实证明，不能靠本纯函数验证替代。

**验证事实：** Node.js v22.16.0 直接执行 P1a 单测 **7/7 PASS**，两个 .mjs `node --check` **PASS**；GitHub blob SHA 与运行的本地两文件完全一致；新测试已接入 `test:invariants` 和 `lint:m11`，独立命令为 `npm run test:m11:r8-p1a`。完整仓库 invariants、Prisma Validate、ESLint、Typecheck、Build、PostgreSQL E2E 均 **NOT_RUN**；不可将上述局部测试算作完整工程验收。

**下一独立切片 P1b：** 审查现行 M1/M3 签名经济命令与授权验证机制，设计政策发布与发奖两个相互区分的签名命令摘要、nonce/有效期、Principal/Agent 身份及 AuthoritySnapshot 证据绑定；先固定可审计的签名边界，再讨论 B2 的不可变数据库收据与 B3 原子发奖。老 Ledger 不回填、不改写，R8 `r8RiskEvaluationEligible` 仍必须为 `false`。


## 七、R8-P1b 待签名业务意图与授权边界（2026-10-24）

本切片新增 `incentive-authorization-intent-draft.mjs` 及对应 Node 测试，协议候选版本 `iwantu.incentive-authorization-intent/0.1`。**实现范围仅限只读候选载荷/规范摘要**，未签名、未授权、未消费 Nonce、未落库、未调用 `awardProtocolIncentive`。不更改 M2 旧幂等键或历史奖励记录，也不推断 Issue #44 所缺失的执行 AgentVersion。

### P1b-1：两个不同的拟议动作

| 待签动作（均待治理评审） | payloadHash 覆盖的事实 | 后续必须独立核验 |
| --- | --- | --- |
| `incentive.policy.publish` | `programId`、`policyVersion`、`policyHash`、`issuerPrincipalId` | 发布者属于受信治理 Principal，签名/实时 Mandate 允许发布该 Program 的政策修订，版本和有效期在 PostgreSQL 唯一且无冲突 |
| `incentive.award.issue` | 精确政策身份及哈希、指定 Settlement ID/hash/终局类型/触发证据哈希、受益 Principal/角色、awardId/槽位、**政策固定金额**和 IWC 币种 | 当前执行者有发奖权限，Settlement 是终局真实事实，角色与实际受益 Principal 匹配，真实金额/时间/可用奖池和冻结政策一致 |

两个拟议 action **尚未成为正式 Mandate 权限定义**。发布政策的治理主体不应被自动视为发奖主体，反之亦然；两者必须分别完成权限评审。

### P1b-2：与 M1/M3 现成签名链的接口

调用方将 P1b 输出的 `payloadHash` 作为现有 M3 `buildEconomicCommandEvidence` 的 `payloadHash`，用现有 `iwantu-economic-command/0.1` 封装 action、已认证 Principal/AgentIdentity、指定 Mandate、Nonce、issuedAt/expiresAt、signingKeyId 与 EdDSA 算法后，对 `hashEconomicCommandEvidence` 签名。不能把候选载荷哈希当成已签名或已授权的收据。

后续的**真实数据库写入路径**须复用 M3 已有的访问凭据与独立签名凭据校验、EdDSA 公钥验签、实时 `resolveAuthority`、`bindAuthorityToAuthentication`、`captureAuthoritySnapshot`；10 分钟最大 TTL、时钟偏差和过期拒绝遵从 M3 已实施边界。须在同一数据库事务内保存唯一 Nonce、命令签名、公钥凭据引用、签发时授权快照和冻结政策；历史 AuthoritySnapshot 只用于证明已经发生的历史核验，不能重新授权新交易。**现有 OfferRevision Nonce 唯一索引不等于激励命令 Nonce 的重放保护**，必须为新领域建立单独约束。

### P1b-3：去重冲突与归因失败闭合

候选 `deduplicationFingerprint` 只包含 `programId + policyVersion + policyHash + settlementId + beneficiaryRole + awardSlot` 的规范哈希，**刻意不包含** awardId 和 beneficiaryPrincipalId。这样同一政策/结算/角色/槽位更换奖项编号或受益人仍可在未来唯一约束中冲突；同一指纹而不同 payloadHash 必须拒绝，不得按首次命令偷偷改收款主体。是否允许跨政策版本、不同 Program 多次奖励必须由治理政策明确，不凭本候选指纹断言舞弊。

目前结算类型、ID、Hash、受益主体均为**调用者候选输入**：纯函数只做格式、静态政策枚举与摘要验证，**没有查询终局 Settlement、ReputationEvidence、Ledger、AgentVersion 或历史授权**。在 PostgreSQL 完成这些事实核验前，`r8RiskEvaluationEligible=false`、`attributionStatus=unavailable` 的既有 B2 预检结论不变。不得生成 R8 风险信号、I0–I4 经济处罚或已认证的归因收据。

### P1b-4：本切片验证与下一阶段验收

Node.js v22.16.0 原生单测 **7/7 PASS**，代码/测试 `node --check` **PASS**；本地测试依赖的 P1a 与 M1 AuthoritySnapshot 源文件均经 Git Blob SHA 核对与远端完全一致。新增独立命令 `npm run test:m11:r8-p1b`，接入 `test:invariants` 与 `lint:m11`。完整 Node invariants、Prisma Validate、ESLint、Typecheck/Build、PostgreSQL E2E 仍为 **NOT_RUN**，不能用本切片的单测代替。

下一步应先评审治理 Principal 与发奖 Mandate action/capability，冻结签名命令及收据字段；之后以 **B2 PostgreSQL 不可变存储/签名证据门禁** → **B3 真实授权下原子发奖** → **B4 可解释、非处罚性风险观察** 的顺序推进。R7 真库验收独立处理。

## 八、R8-P1c：候选签名密码学预检（2026-10-24）

本切片新增 `next-app/src/lib/integrity/incentive-signature-preflight-draft.mjs` 以及 `next-app/tests/v2-m11-incentive-signature-preflight-draft.test.mjs`。协议候选版本为 `iwantu.incentive-signature-preflight/0.1`，仍属于**只读、无数据库副作用的数学验签门禁**，不是政策发布或真实发奖的授权实现。

### P1c-1：和 M3 签名协议保持兼容

分别从 P1b 的候选政策发布和候选奖励意图重新计算 `payloadHash`，要求呈交的 `iwantu-economic-command/0.1` 严格对应 `action` 和 `payloadHash`，固定 Principal/Agent/Mandate、Nonce、签名键、发放/到期时间与 EdDSA 算法。按现有 M1 `sha256Evidence` 的规范化 JSON 实现 SHA-256 命令摘要，再对其**32 字节原始摘要**用 Ed25519 检验 64 字节签名，与 M3 `hashEconomicCommandEvidence` 的编码/验签口径一致。候选政策发布另外要求签名命令的 Principal ID 与候选政策发布者一致；真正的治理主体资格仍需实时服务端校验。

拒绝未知命令字段、非规范毫秒 UTC 时间、过期/最长 10 分钟外的签名窗口、超出 60 秒的未来签发、非 EdDSA 算法、非规范 Base64url、带私钥字段的 JWK、签名/公钥不匹配以及签名后的业务载荷篡改。冻结跨模块黄金摘要：奖励意图 `8f0e6de969ceefb2d8f4caec6229beec583af7ec36f02d804e6a697ec444200d`，对应经济命令 `4501ae84d5b5d2d929a9f573d0b3b519ab7178b750ab3af72cc91ad48c8f75ac`。

### P1c-2：明确不作授权推断

`presentedPublicKeyJwk` 仅是**呈交的公钥**，没有连接 M1 数据库 `AgentCredential`，也没有核验该公钥属于已认证的 Agent、签名凭据是否 active/未吊销或 Mandate 是否具备相应 action。攻击者自己生成密钥、自己签名也可通过这一数学验证；因此结果只能返回 `signatureCheck=valid_for_presented_key_only`，并明确 `authorizationStatus=not_checked`、`nonceReplayStatus=not_checked`、`r8RiskEvaluationEligible=false`。同一命令重复预检会再次得到一致结果，**不是重放幂等或 Nonce 已消费证明**。

`now` 是显式传入的验证时点，未来可信服务只能由服务端时钟提供，不能采纳调用方声称的时间。候选意图不等于已经持久化的政策、发奖授权、Settlement 证据或 Ledger 收据；不得以本预检结果调用现有 `awardProtocolIncentive`，更不能声称 R8 已有效归因或执行经济处罚。

### P1c-3：验证、质量门禁及后续

使用 Node.js v22.16.0 对与远端 Git Blob SHA 一致的 P1c 源码、测试及精确重建的 P1a/P1b/M1 依赖运行原生测试 **8/8 PASS**；两个新文件 `node --check` **PASS**。已将独立命令 `npm run test:m11:r8-p1c` 接入 `test:invariants` 与 `lint:m11`。**完整** Node invariants、Prisma Validate、ESLint、Typecheck、Build、PostgreSQL E2E 均为 **NOT_RUN**，不借用以前 master 的 CI 成功作为此次通过证明。

后续必须先在独立设计评审中确定 Program 的治理 Principal 和签名动作权限，再把 M3 经过验证的服务端访问凭据/签名凭据/实时 `resolveAuthority` / `captureAuthoritySnapshot` 复用到新收据写入路径；为新命令领域建立 PostgreSQL 唯一 Nonce 与冻结政策版本的审计约束。授权校验应发生于**经济写入之前**，且遵守现行 Ledger 原子提交/锁序与失败整体回滚。未完成这些条件前，R8-B2/B3/B4 均不可判定完成。


## 九、R8-P1d：存储签名凭据与认证身份的只读交叉预检（2026-10-24）

本切片新增 `next-app/src/lib/integrity/incentive-credential-preflight-draft.mjs` 与配套负例测试。版本 `iwantu.incentive-credential-preflight/0.1`。**它只接受服务端已经认证的 V2 Agent 访问上下文和 Prisma 读取适配器，不能把普通客户端传入的对象当作已认证上下文。**

### P1d 已实现的有限能力

- 对 `Principal`、`AgentIdentity`、访问 `AgentCredential` 和签名 `AgentCredential` 做当前数据库只读查验（四项 `findUnique`），拒绝状态失效、跨 Principal 所有权、Agent 不匹配、访问/签名凭据类别混用及无效时间窗口。
- 要求签名命令的 `principalId` 与 `agentIdentityId` 对应已经存在的 V2 访问身份；签名凭据必须绑定该 AgentIdentity，算法为 EdDSA。
- 不接受外部 `presentedPublicKeyJwk`；将从数据库签名凭据查得的 `publicKeyJwk` 交给此前 P1c 候选 Ed25519 验签函数，分别支持政策发布和奖励发放意图。
- 返回 `accessCredentialId`、`signingCredentialId`、`economicCommandHash` 和 `intentPayloadHash`，明确保持 `authorizationStatus=not_checked`、`nonceReplayStatus=not_checked`、`policyGovernanceStatus=not_checked`、`immutableReceiptStatus=not_written`、`r8RiskEvaluationEligible=false`。

**绝对不可将此预检结果用于真实发奖、发布政策或产生风险处罚。** `tx` 和 `authentication` 是可信服务端调用的先决输入，本函数不校验 Bearer Token 本身；其记录一致性不能代替 M1/M3 的实时 `resolveAuthority`、`bindAuthorityToAuthentication`、`captureAuthoritySnapshot`，也不检查 Mandate 动作权限、Program 治理资格、历史 AgentVersion、签名命令 Nonce 消费、冻结政策、终局 Settlement 或奖励池资金。

### P1d 验证证据与仍存缺口

已对新增两个 .mjs 运行 Node.js v22.16.0 语法检查。隔离执行新测试 **8/8 PASS（P1c 依赖使用本地测试替身，执行了真实 Node Ed25519 数学验签）**；该结果仅证明 P1d 的数据库读取适配逻辑在模拟依赖下行为符合预期，**不能标作真实 P1c 全链路测试或 PostgreSQL E2E PASS**。正式仓库测试文件引用真实 P1c，需在安装齐全依赖的工作环境运行 `npm run test:m11:r8-p1d`；已加入 `test:invariants` / `lint:m11`。完整 invariants、实际 P1c 联动、Prisma Validate、ESLint、Typecheck/Build、PostgreSQL E2E 均 **NOT_RUN**。

下一切片 P1e 须在不复制 M3 安全逻辑的前提下复用实时 Authority Resolver，先**评审并冻结** `incentive.policy.publish` / `incentive.award.issue` 的治理 Principal、Mandate action/capability 和奖励金额限额，再为该领域设计不可变、唯一 Nonce 及签名授权收据。B2 数据库持久化、B3 原子发奖、B4 R8 非处罚性规则均尚未完成；Issue #44 的执行 AgentVersion 不得从当前凭据或当前 AgentVersion 推断。
