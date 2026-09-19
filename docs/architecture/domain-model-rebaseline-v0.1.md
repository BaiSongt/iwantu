# iWANTU v2 Domain Model Rebaseline v0.1

- Status: **ENGINEERING BASELINE / PROPOSED FOR IMPLEMENTATION**
- Source baseline: current `master` Prisma schema and MCP authentication/execution path
- Goal: define the target v2 domain, map v1 models to it, and establish a migration sequence that does not break the current product.

## 1. Rebaseline decision

iWANTU v2 must not be implemented by renaming the current marketplace entities in place.

The existing schema is structurally human-marketplace-centric:

- User/Organization encode buyer/supplier roles.
- AgentProduct is a catalog/product representation rather than a stable economic Agent identity.
- Demand/Proposal/PocProject encode a traditional procurement funnel.
- ApiKey belongs to User and stores a raw shared secret.
- AgentAction is a post-execution activity log with human-approval-era fields.
- Review is subjective star-rating data, not protocol Reputation Evidence.

The migration strategy is therefore:

```text
NEW PROTOCOL DOMAIN
      ↓
compatibility adapters
      ↓
dual-read / selective dual-write
      ↓
data backfill / migration
      ↓
route cutover
      ↓
legacy deprecation
```

Do not perform a destructive in-place table rename as the first step.

---

# 2. Target bounded contexts

The target modular-monolith domain is divided into eight bounded contexts.

```text
Identity & Authority
Market & Discovery
Transaction Protocol
Economy & Ledger
Assets & Data Access
Trust & Integrity
Interaction
Control Plane / Legacy UI
```

## 2.1 Identity & Authority

Core models:

- Principal
- AgentIdentity
- AgentVersion
- AgentCredential
- Mandate
- AuthoritySnapshot

## 2.2 Market & Discovery

Core models:

- CapabilityDefinition
- AgentCapabilityClaim
- AgentMarketProfile
- Task
- TaskRevision
- TaskCapabilityRequirement
- Offer
- OfferRevision

## 2.3 Transaction Protocol

Core models:

- Contract
- ContractAmendment
- Delivery
- AcceptanceDecision
- Dispute
- Settlement

## 2.4 Economy & Ledger

Core models:

- LedgerAccount
- LedgerTransaction
- LedgerEntry
- Escrow
- CreditProvenance / provenance metadata

## 2.5 Assets & Data Access

Core models:

- Asset
- AssetGrant

## 2.6 Trust & Integrity

Core models:

- ReputationEvidence
- ReputationSnapshot (derived/cache)
- IntegritySignal
- IntegrityAction

## 2.7 Interaction

Existing Message/MessageThread may remain for human UI compatibility.

A2A communication must not become an authoritative source of economic state. If persisted, use a separate AgentInteraction/A2AConversation record or minimal transcript/evidence hashes.

## 2.8 Control Plane / Legacy UI

The existing catalog/UI models Product, Solution, CompanyProfile, FeaturedItem and Notification can remain during migration. They are presentation/control-plane entities, not protocol truth.

---

# 3. Principal model

## Decision

Create a new `Principal` model rather than treating `User` or `Organization` directly as the protocol economic root.

Reason:

- an individual and an organization can both own Agents and Wallets;
- User is an interactive account, not necessarily the economic legal/operational Principal;
- Organization is currently typed as buyer/supplier/opc_team, which is incompatible with a two-sided autonomous market;
- future wallets, mandates, assets and reputation need one stable owner type.

Conceptual model:

```prisma
model Principal {
  id             String          @id @default(cuid())
  type           PrincipalType
  status         PrincipalStatus @default(active)
  userId         String?         @unique
  organizationId String?         @unique
  createdAt      DateTime        @default(now())
  suspendedAt    DateTime?

  // relations: agents, mandates, accounts, assets, reputation evidence
}
```

Invariant: exactly one of `userId` or `organizationId` should identify the represented owner in MVP. Enforce with service validation and preferably a database CHECK migration.

### Existing User

**KEEP** as human login/control-plane account.

Do not use `User.role = buyer/supplier` as v2 protocol authority. Buyer and supplier are transaction roles, not permanent account roles.

Long term, UserRole should converge toward platform/control-plane roles such as member/operator/admin rather than market-side identity.

### Existing Organization

**KEEP** as organization profile/legal-operational entity.

`OrgType buyer/supplier` becomes legacy presentation data and must not restrict whether the Organization Principal can buy or sell.

---

# 4. Agent identity model

## Existing `AgentProduct`

Current AgentProduct stores catalog description, taskGoal, inputSpec/outputSpec, successRate, pricing, riskLevel and publication status.

It must **not** become the v2 AgentIdentity table by simple rename.

### Target split

```text
AgentProduct (legacy catalog)
        ↓ migration/adapter
AgentIdentity
  ├ AgentVersion
  ├ AgentCapabilityClaim
  └ AgentMarketProfile
```

Conceptual models:

```prisma
model AgentIdentity {
  id          String      @id @default(cuid())
  principalId String
  name        String
  status      AgentStatus @default(active)
  createdAt   DateTime    @default(now())
  suspendedAt DateTime?
  retiredAt   DateTime?
}

model AgentVersion {
  id          String   @id @default(cuid())
  agentId     String
  version     String
  runtimeMeta Json?
  createdAt   DateTime @default(now())

  @@unique([agentId, version])
}

model AgentMarketProfile {
  id                 String  @id @default(cuid())
  agentId            String  @unique
  summary            String?
  description        String?
  a2aCardUrl         String?
  acceptsPublicTasks Boolean @default(true)
  availability       String  @default("available")
  extensions         Json?
}
```

AgentProduct UI may initially be backed by AgentIdentity + AgentMarketProfile through an adapter.

`riskLevel` must not remain a static product property that decides protocol authority. Risk belongs in Policy / Integrity context.

---

# 5. Credential model

## Existing `ApiKey`

Current ApiKey is user-owned and stores `key String @unique` directly.

### Target

Introduce `AgentCredential`.

```prisma
model AgentCredential {
  id           String           @id @default(cuid())
  agentId      String
  kind         CredentialKind
  status       CredentialStatus @default(active)
  keyId        String           @unique
  prefix       String?
  secretHash   String?
  publicKeyJwk Json?
  algorithm    String?
  expiresAt    DateTime?
  revokedAt    DateTime?
  retiredAt    DateTime?
  lastUsedAt   DateTime?
  createdAt    DateTime         @default(now())
}
```

Rules:

- API/shared secret credentials store only hash + prefix/id.
- Economic signing credentials store public verification material, never Agent private keys.
- historical public keys remain for historical signature verification.

### Migration of existing ApiKey

Do not immediately delete current ApiKey.

Staged path:

1. add AgentIdentity and AgentCredential;
2. establish a legacy AgentIdentity for each actively used API-key principal where needed;
3. support hashed credential lookup in new auth path;
4. migrate/rotate existing raw keys;
5. switch MCP v2 routes to AgentCredential;
6. deprecate raw ApiKey reads;
7. remove raw `key` only after compatibility period.

---

# 6. Mandate and authority models

Add `Mandate` as a first-class domain object.

```prisma
model Mandate {
  id                 String        @id @default(cuid())
  version            Int
  issuerPrincipalId  String
  issuerAgentId      String?
  subjectAgentId     String
  parentMandateId    String?
  status             MandateStatus @default(active)

  actionScopes       String[]
  capabilityScopes   String[]
  economicLimits     Json
  resourcePolicy     Json
  counterpartyPolicy Json

  delegationAllowed  Boolean       @default(false)
  maxDelegationDepth Int           @default(0)

  validFrom          DateTime
  validUntil         DateTime?
  payloadHash        String
  signature          String?
  revokedAt          DateTime?
  createdAt          DateTime      @default(now())

  @@unique([id, version])
}
```

Implementation may use a separate stable mandate family id + revision id if preferred; the invariant is immutable versioning.

Add `AuthoritySnapshot` for economic commitments:

```prisma
model AuthoritySnapshot {
  id                 String   @id @default(cuid())
  principalId        String
  agentId            String
  credentialKeyId    String
  mandateChain       Json
  effectiveAuthority Json
  chainHash          String
  createdAt          DateTime @default(now())
}
```

Contracts reference buyer/supplier AuthoritySnapshots.

---

# 7. Capability domain

Add a thin registry; it is an index, not an allowlist.

```prisma
model CapabilityDefinition {
  id          String  @id // URI/URN style capability id
  parentId    String?
  name        String
  description String?
  namespace   String
  version     String?
  schemaRef   String?
  status      String  @default("active")
  metadata    Json?
}

model AgentCapabilityClaim {
  id             String @id @default(cuid())
  agentVersionId String
  capabilityId   String
  claimStatus    CapabilityClaimStatus @default(declared)
  descriptor     Json?

  @@unique([agentVersionId, capabilityId])
}
```

Unknown external capability namespaces are allowed.

Observed capability performance is produced by ReputationEvidence, not manually written into successRate.

---

# 8. Task domain: Demand -> Task

## Existing `Demand`

Do not rename in place initially.

Introduce new protocol-native `Task` and immutable `TaskRevision`.

```prisma
model Task {
  id                String         @id @default(cuid())
  issuerPrincipalId String
  issuerAgentId     String
  status            TaskStatus     @default(draft)
  visibility        TaskVisibility
  currentRevision   Int            @default(1)
  createdAt         DateTime       @default(now())
  openedAt          DateTime?
  closedAt          DateTime?
}

model TaskRevision {
  id              String   @id @default(cuid())
  taskId          String
  revision        Int
  contentHash     String
  protocolPayload Json
  workPayload     Json
  marketPayload   Json
  trustPayload    Json
  policyPayload   Json
  createdAt       DateTime @default(now())

  @@unique([taskId, revision])
  @@unique([taskId, contentHash])
}
```

For discovery performance, duplicate/index a small number of stable query fields (deadline, pricing mode, max amount, visibility) or add normalized TaskCapabilityRequirement rows. Do not flatten every domain extension into columns.

### Compatibility

Legacy Demand remains readable in v1 UI. A compatibility adapter can expose selected Demand records as Tasks or create a Task shadow record for new Agent-native flows.

`allowAiSupplier` and `allowAiAutoBid` become obsolete in a platform whose normal path is Agent-native; do not carry these flags into the v2 protocol.

`matchScore` / `matchScoreNum` are not protocol truth and should not migrate into Task.

---

# 9. Offer domain: Proposal -> Offer

## Existing `Proposal`

Proposal currently has mutable human-procurement status and directly references Demand + supplierOrgId.

Introduce:

```prisma
model Offer {
  id                  String      @id @default(cuid())
  taskId              String
  supplierPrincipalId String
  supplierAgentId     String
  status              OfferStatus @default(draft)
  currentRevision     Int         @default(1)
  createdAt           DateTime    @default(now())

  @@unique([taskId, supplierPrincipalId]) // MVP: one active supplier-principal offer chain per task
}

model OfferRevision {
  id                         String   @id @default(cuid())
  offerId                    String
  revision                   Int
  taskRevisionId             String
  taskHash                   String
  priceAmount                Decimal
  currency                   String   @default("IWC")
  deliveryCommitmentSeconds  Int?
  validUntil                 DateTime
  termsPayload               Json
  termsHash                  String
  supplierAuthoritySnapshotId String
  supplierSignature          String
  createdAt                  DateTime @default(now())

  @@unique([offerId, revision])
}
```

Milestone and QuoteItem may continue for legacy human proposals. If v2 later needs structured milestones, include them in Offer terms/Contract deliverable schema rather than reusing mutable legacy proposal rows as protocol authority.

---

# 10. Contract domain: POC becomes a contract type

`PocProject` is not the v2 Contract table.

Introduce Contract:

```prisma
model Contract {
  id                          String        @id @default(cuid())
  taskId                      String        @unique // MVP exactly one contract per task
  acceptedOfferRevisionId     String        @unique

  buyerPrincipalId            String
  buyerAgentId                String
  supplierPrincipalId         String
  supplierAgentId             String

  buyerAuthoritySnapshotId    String
  supplierAuthoritySnapshotId String

  taskSnapshotHash            String
  offerSnapshotHash           String
  effectiveContractHash       String        @unique

  lifecycleState              ContractState
  outcome                     ContractOutcome?

  escrowId                    String?       @unique
  activatedAt                 DateTime
  closedAt                    DateTime?
  createdAt                   DateTime      @default(now())
}
```

POC becomes `contract_type = poc` in contract/task terms.

Existing PocProject remains a legacy workflow until migrated/adapted.

Add ContractAmendment as immutable chain:

```prisma
model ContractAmendment {
  id                     String   @id @default(cuid())
  contractId             String
  sequence               Int
  previousEffectiveHash  String
  amendmentPayload       Json
  amendmentHash          String
  buyerSignature         String
  supplierSignature      String
  createdAt              DateTime @default(now())

  @@unique([contractId, sequence])
}
```

---

# 11. Delivery / acceptance / dispute / settlement

```prisma
model Delivery {
  id                    String   @id @default(cuid())
  contractId            String
  sequence              Int
  effectiveContractHash String
  supplierAgentId       String
  manifest              Json
  deliveryHash          String   @unique
  supplierSignature     String
  receivedAt            DateTime @default(now())

  @@unique([contractId, sequence])
}

model AcceptanceDecision {
  id            String             @id @default(cuid())
  contractId    String
  deliveryId    String
  type          AcceptanceType
  reasonCodes   String[]
  details       String?
  actorAgentId  String?
  signature     String?
  createdAt     DateTime           @default(now())
}

model Dispute {
  id          String        @id @default(cuid())
  contractId  String        @unique
  status      DisputeStatus
  openedByAgentId String
  reasonCodes String[]
  evidence    Json?
  openedAt    DateTime      @default(now())
  closedAt    DateTime?
}

model Settlement {
  id                  String         @id @default(cuid())
  contractId          String         @unique
  type                SettlementType
  ledgerTransactionId String         @unique
  allocation          Json
  settlementHash      String         @unique
  createdAt           DateTime       @default(now())
}
```

Rejected intermediate delivery claims do not directly update Reputation. Terminal outcome does.

---

# 12. Economy and ledger domain

Do not add a mutable `principal.balance` as the accounting source of truth.

```prisma
model LedgerAccount {
  id          String            @id @default(cuid())
  principalId String?
  type        LedgerAccountType
  status      LedgerAccountStatus @default(active)
  createdAt   DateTime          @default(now())
}

model LedgerTransaction {
  id             String   @id @default(cuid())
  type           LedgerTransactionType
  referenceType  String
  referenceId    String
  idempotencyKey String   @unique
  metadata       Json?
  previousHash   String?
  transactionHash String? @unique
  createdAt      DateTime @default(now())
}

model LedgerEntry {
  id            String          @id @default(cuid())
  transactionId String
  accountId     String
  side          LedgerEntrySide
  amount        Decimal
  provenance    Json?
  createdAt     DateTime        @default(now())
}

model Escrow {
  id                       String       @id @default(cuid())
  contractId               String       @unique
  buyerAccountId           String
  amount                   Decimal
  currency                 String       @default("IWC")
  status                   EscrowStatus
  lockLedgerTransactionId  String       @unique
  releaseLedgerTransactionId String?    @unique
  createdAt                DateTime     @default(now())
}
```

Invariant: every LedgerTransaction balances total debit and credit. Enforce in transaction service and preferably database-level deferred validation/trigger if practical.

Balances are derived/cached read models only.

---

# 13. Asset domain: Attachment -> Asset

Existing Attachment is a generic UI attachment tied by targetType/targetId and URL.

Do not make it the authority layer for confidential contract assets.

Add:

```prisma
model Asset {
  id               String      @id @default(cuid())
  ownerPrincipalId String
  mediaType        String
  fileName         String?
  sizeBytes        BigInt?
  storageKey       String
  sha256           String
  sensitivity      AssetSensitivity
  status           AssetStatus @default(active)
  metadata         Json?
  createdAt        DateTime    @default(now())
}

model AssetGrant {
  id             String   @id @default(cuid())
  assetId        String
  contractId     String?
  granteeAgentId String
  permissions    String[]
  validFrom      DateTime
  validUntil     DateTime?
  revokedAt      DateTime?
  createdAt      DateTime @default(now())
}
```

Contract formation may atomically create contract-scoped AssetGrants after economic commitment succeeds.

Legacy Attachment can remain for public/product/UI files.

---

# 14. Trust and integrity domain

## Existing Review

Keep for legacy UI if desired, but **exclude star rating from protocol Reputation source-of-truth**.

## New evidence models

```prisma
model ReputationEvidence {
  id           String   @id @default(cuid())
  principalId  String?
  agentId      String?
  capabilityId String?
  contractId   String?
  type         String
  evidence     Json
  occurredAt   DateTime
  createdAt    DateTime @default(now())
}

model ReputationSnapshot {
  id           String   @id @default(cuid())
  principalId  String?
  agentId      String?
  capabilityId String?
  modelVersion String
  values       Json
  computedAt   DateTime @default(now())
}

model IntegritySignal {
  id          String   @id @default(cuid())
  principalId String?
  agentId     String?
  ruleCode    String
  score       Float
  evidence    Json
  status      String
  firstSeenAt DateTime
  lastSeenAt  DateTime
  createdAt   DateTime @default(now())
}
```

ReputationSnapshot is derived/cache; ReputationEvidence is the durable fact layer.

---

# 15. AgentAction / AuditLog migration

Current AgentAction is not suitable as v2 economic transaction truth because it:

- has optional free-form `agentId` string rather than AgentIdentity FK;
- has `delegatorUserId` rather than an authority chain;
- stores raw truncated payload strings;
- records `approvalStatus` from a human-approval-era model;
- is written after MCP execution rather than serving as the command/transaction boundary.

## Decision

**KEEP LEGACY, DEPRECATE AS AUTHORITY SOURCE.**

Introduce protocol-layer records/events instead:

- EconomicCommand / CommandReceipt (optional explicit model)
- AuthoritySnapshot
- Contract / Delivery / Settlement
- LedgerTransaction
- ReputationEvidence
- IntegritySignal
- AuditEvent / ProtocolEvent if a generic immutable event stream is required

AuditLog can continue to support operator/security logs, but protocol objects and ledger events become authoritative economic facts.

Do not migrate `ApprovalStatus` into the normal v2 transaction path.

---

# 16. Message domain

Current Message requires a User sender, so it cannot represent Agent-native A2A interactions cleanly.

Decision:

- keep current MessageThread/Message for human/UI compatibility;
- do not use them as contract authority;
- if iWANTU persists A2A traffic, introduce AgentInteraction/A2AConversation with AgentIdentity references and strict data-minimization;
- retain only what is needed for UX/evidence, preferably hashes/references for sensitive negotiation content.

Economic commitments must always be represented by signed protocol objects, never inferred from chat text.

---

# 17. Legacy model disposition matrix

| Existing v1 model | v2 disposition | Target / note |
|---|---|---|
| User | KEEP | human/control-plane account; attach Individual Principal |
| Organization | KEEP | profile/legal-operational entity; attach Organization Principal |
| OrganizationMember | KEEP / EVOLVE | control-plane membership and issuer roles |
| UserRole | DEPRECATE market meaning | buyer/supplier not permanent protocol roles |
| OrgType | DEPRECATE market meaning | organizations can both buy and sell |
| Product | KEEP LEGACY | catalog/service presentation; not protocol identity |
| AgentProduct | MIGRATE / ADAPT | AgentIdentity + AgentVersion + CapabilityClaim + MarketProfile |
| CompanyProfile | KEEP | presentation/discovery metadata |
| Demand | MIGRATE / ADAPT | Task + TaskRevision |
| Proposal | MIGRATE / ADAPT | Offer + OfferRevision |
| Milestone | LEGACY / OPTIONAL REUSE AS DATA | v2 terms/deliverables should be immutable contract payload |
| QuoteItem | LEGACY | pricing detail can live in Offer terms |
| PocProject | MIGRATE / ADAPT | Contract with type=poc |
| PocParticipant | LEGACY | protocol principals/agents replace participant semantics |
| MessageThread | KEEP LEGACY | human/A2A UX only, not authority |
| Message | KEEP LEGACY | human messages; agent-native interaction needs separate sender model |
| AuditLog | KEEP / REFOCUS | operator/security audit, not economic source of truth |
| AgentAction | DEPRECATE authority role | protocol events/commands/ledger replace it |
| ApiKey | MIGRATE | AgentCredential; hash shared secrets and add signing keys |
| Attachment | KEEP LEGACY + ADD Asset | public/UI attachment vs secured protocol asset |
| Review | KEEP LEGACY, EXCLUDE from trust truth | ReputationEvidence replaces star-rating trust |
| FeaturedItem | KEEP | UI merchandising only |
| Notification | KEEP / ADAPT | human control-plane notification |
| EmailVerificationCode | KEEP | human account verification |
| Solution | KEEP LEGACY | catalog/bundle presentation |

---

# 18. Proposed target aggregate ownership

```text
Principal
├ AgentIdentity
│  ├ AgentVersion
│  │  └ AgentCapabilityClaim
│  ├ AgentCredential
│  ├ AgentMarketProfile
│  └ Mandate (subject)
├ LedgerAccount
├ Asset
└ ReputationEvidence

Task
├ TaskRevision
├ TaskCapabilityRequirement
└ Offer
   └ OfferRevision

Contract
├ AuthoritySnapshot (buyer/supplier refs)
├ Escrow
├ ContractAmendment
├ Delivery
│  └ AcceptanceDecision
├ Dispute
└ Settlement
   └ LedgerTransaction
      └ LedgerEntry
```

---

# 19. Migration phases

## M0 — Architecture baseline only

No production behavior change.

Deliverables:

- accepted protocol docs;
- target schema design;
- invariants/tests plan;
- current route/model compatibility inventory.

## M1 — Identity foundation

Add without breaking v1:

- Principal
- AgentIdentity
- AgentVersion
- AgentCredential
- Mandate
- AuthoritySnapshot
- CapabilityDefinition / AgentCapabilityClaim / AgentMarketProfile

Create adapters from existing User/Organization/AgentProduct/ApiKey.

No Task/Contract cutover yet.

## M2 — Economic ledger foundation

Add:

- LedgerAccount
- LedgerTransaction
- LedgerEntry
- Escrow

Implement strict accounting invariants and idempotency tests before any production Credit movement.

## M3 — Task / Offer protocol

Add:

- Task / TaskRevision
- Offer / OfferRevision
- signed economic command verification
- atomic Contract Formation service skeleton

Legacy Demand/Proposal routes remain intact; add v2 protocol endpoints separately.

## M4 — Contract execution

Add:

- Contract / ContractAmendment
- Asset / AssetGrant
- Delivery / AcceptanceDecision
- Settlement / Dispute

Run Phase-0 protocol prototype end-to-end with closed-loop test Credit.

## M5 — Trust / integrity

Add:

- ReputationEvidence
- ReputationSnapshot
- IntegritySignal / action policy

Implement initial deterministic anti-wash/Sybil rules.

## M6 — Compatibility migration

Gradually:

- expose legacy Demand as Task where semantically safe;
- map selected Proposal flows to Offer;
- adapt POC UI around Contract type=poc;
- migrate AgentProduct UI to AgentIdentity/MarketProfile;
- switch MCP v2 writes from direct legacy DAL operations to protocol commands.

## M7 — Legacy retirement

Only after traffic and data have migrated:

- remove raw ApiKey secret storage;
- stop new legacy Demand/Proposal/PocProject writes;
- remove approvalStatus semantics from normal Agent actions;
- remove buyer/supplier type restrictions from protocol decisions;
- retain/archive legacy presentation data as needed.

---

# 20. Non-negotiable database/service invariants

1. A Principal is the root owner for Wallets, Agents and Assets.
2. Agent Identity is not hard-deleted once referenced by protocol history.
3. Agent private signing keys are never stored by iWANTU.
4. Mandates are immutable/versioned; revocation blocks new commitments only.
5. Delegated authority can never exceed parent authority.
6. A Firm Offer binds an exact Task revision/hash.
7. MVP allows at most one terminal Contract per Task.
8. Contract formation (validation + escrow + status changes + ledger events) is atomic.
9. Contract snapshots preserve exact task, offer and authority evidence.
10. Deliveries and amendments are append-only immutable facts.
11. A Contract has exactly one terminal Settlement.
12. Ledger mutations occur only through balanced LedgerTransactions.
13. Direct context-free Principal-to-Principal Credit transfer is not exposed.
14. Reputation source-of-truth is Evidence, not editable score/rating fields.
15. Integrity decisions do not rewrite historical evidence or ledger entries.
16. Sensitive Asset access is explicit, scoped, expiring/revocable and normally contract-bound.
17. Chat/A2A conversation is never treated as economic commitment without a signed protocol object.
18. Legacy UserRole/OrgType buyer/supplier values never become v2 authorization rules.

---

# 21. Recommended implementation shape

Keep the current Next.js/PostgreSQL/Prisma modular-monolith deployment for v2 foundation.

Do **not** split into microservices yet.

Recommended application modules:

```text
src/domain/identity
src/domain/authority
src/domain/capability
src/domain/market
src/domain/contracts
src/domain/ledger
src/domain/assets
src/domain/reputation
src/domain/integrity
```

API adapters:

```text
/api/v2/agents
/api/v2/tasks
/api/v2/offers
/api/v2/contracts
/api/v2/ledger (read-only/user-authorized surfaces)
/api/v2/reputation
/api/v2/mcp or protocol gateway
```

All economic state-changing routes call application commands/services. They must not expose arbitrary PATCH of state/status fields.

---

# 22. First engineering milestone recommendation

The first code milestone after this design is accepted should **not** implement the entire transaction chain.

Start with `V2-M1 Identity & Authority Foundation`:

1. add Principal / AgentIdentity / AgentVersion / AgentCredential / Mandate / AuthoritySnapshot schema;
2. migrate authentication abstraction so it returns AgentIdentity + Principal instead of treating User as Agent;
3. hash new shared-secret credentials;
4. implement mandate resolution and non-escalating delegation;
5. write unit/integration tests for authority invariants;
6. preserve all existing v1 routes through compatibility adapters;
7. do not yet move Demand/Proposal production writes.

This creates a safe foundation on which Task/Contract/Credit can be implemented without repeating the current identity coupling.