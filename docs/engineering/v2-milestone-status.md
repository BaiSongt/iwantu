# iWANTU v2 Engineering Milestone Status

Updated: 2026-09-07

This document is an engineering status companion to the v2 Living Baseline in Draft PR #1. It records implementation reality without replacing the product/protocol design documents.

## M1 — Identity, Authority & Capability Foundation — COMPLETE

Merged into `master` through V2-M1-08.

Implemented foundation:

- Principal
- AgentIdentity / AgentVersion
- AgentCredential
- immutable Mandate + append-only revocation
- one-hop delegation and effective-authority narrowing
- Authority Resolver
- legacy/v2 authentication compatibility boundary
- immutable AuthoritySnapshot evidence
- CapabilityDefinition
- AgentCapabilityClaim
- AgentMarketProfile
- database invariant tests and CI gates

M1 intentionally does not cut over legacy Demand/Proposal/MCP production economic writes.

## M2 — Economic Ledger Foundation — COMPLETE

Goal:

> Establish a strict, append-only, double-entry IWC accounting and escrow foundation before any production Agent economic movement is enabled.

Required M2 primitives:

1. LedgerAccount
2. LedgerTransaction
3. LedgerEntry
4. Escrow
5. atomic posting / idempotency
6. Credit provenance and controlled issuance semantics
7. ledger integrity CI gate

Core invariants:

- Ledger is the economic source of truth; there is no mutable `Principal.balance` source of truth.
- Posted entries are append-only.
- Every posted transaction balances: total debit = total credit.
- Entries must use positive amounts.
- A transaction is identified by a unique idempotency key.
- Draft transactions may accumulate entries, but posting is a one-way finalization step.
- Once posted, transaction identity and entries cannot be changed or deleted.
- Normal transaction settlement never mints IWC (`Transaction != Mint`).
- First-stage currency is closed-loop `IWC` only.
- Escrow state changes must be backed by immutable ledger transactions.
- Protected Principal and finite system accounts cannot become negative through the canonical posting path.
- Balance-sensitive domain workflows delegate account locking and no-overdraft enforcement to the canonical posting engine, preserving one ledger-first lock order.
- Canonical economic writes use one explicit concurrency model: Read Committed transactions behind a transaction-scoped global ledger advisory lock, followed by deterministic account row locks.
- Every non-root posted ledger transaction has at most one posted successor through `previousHash`; draft work-in-progress cannot reserve a predecessor in the immutable chain.
- Protocol Incentive awards spend only from the finite Incentive pool.

### M2 work sequence

- V2-M2-01 — Ledger schema & accounting invariants — **COMPLETE** (`75986d9e`)
- V2-M2-02 — Atomic posting engine — **COMPLETE** (`fb489b51`)
- V2-M2-03 — Credit provenance & account bootstrap — **COMPLETE** (`4ec1c565`)
- V2-M2-04 — Escrow primitives — **COMPLETE** (`4ba45a2d`)
- V2-M2-05 — Ledger integrity / concurrency gate — **COMPLETE** (`0566de9a`)
- M2 closure hardening — canonical lock-order, posted-chain fork guard, and contention model — **COMPLETE** (PR #16 / `e43e19a`)

### V2-M2-02 boundary

The atomic posting engine is the single canonical application write path for future economic events:

```text
normalize + validate
→ canonical economic evidence hash
→ idempotency check
→ READ COMMITTED database transaction
→ serialize ledger head with transaction-scoped advisory lock
→ lock active IWC accounts in deterministic order
→ enforce protected-account no-overdraft
→ create draft LedgerTransaction
→ append LedgerEntry rows
→ finalize posted
→ commit
```

M2-02 deliberately did not claim a global transaction hash chain. M2-05 now supplies the serialized chain-head/concurrency invariant without changing the canonical economic evidence hash introduced by M2-02.

Read Committed is deliberate after M2-05. The global ledger advisory lock is the serialization primitive for canonical economic writes; account row locks then protect participating balances. Using PostgreSQL Serializable on top of the same global lock caused transactions waiting for the lock to retain stale serializable snapshots and enter avoidable `40001` retry storms under mixed contention. Read Committed lets each statement observe the latest committed ledger state after acquiring the global lock while the explicit lock order continues to guarantee chain-head and no-overdraft integrity.

### V2-M2-03 boundary

M2-03 establishes:

- three Principal-owned IWC accounts: Available / Locked / Pending;
- four platform system accounts: Reserve / Clearing / Fee / Incentive;
- structured `iwantu-credit-provenance/0.1` metadata for Genesis, Purchased, Earned, Incentive and Refund origins;
- one Genesis allocation chain per Principal/allocation version;
- Purchased Credit idempotency keyed by the external purchase reference;
- a finite Protocol Incentive system pool funded from Reserve.

M2-03 does not add a P2P transfer API and does not allow an Agent to own a LedgerAccount. Genesis and Purchased Credit remain controlled issuance paths. Protocol Incentive awards introduced by M2-05 spend atomically from the finite Incentive pool and credit a Principal-owned Available account with structured provenance.

### V2-M2-04 boundary

M2-04 turns the Escrow schema primitive into atomic domain operations:

```text
lock:
  buyer Available → buyer Locked + Escrow create

release:
  buyer Locked → recipient Principal Available + Escrow released

refund:
  buyer Locked → buyer Available + Escrow refunded
```

The ledger transaction and Escrow state change commit inside the same database transaction governed by the canonical ledger concurrency model. After M2-05, Escrow deliberately delegates account row locking and posted-balance/no-overdraft checks to the canonical posting engine rather than taking a second independent account-lock path. This preserves the Escrow domain error contract while avoiding lock-order inversion with ordinary ledger postings. Release and refund still lock the Escrow row so competing terminal actions resolve to exactly one outcome.

Database invariants independently verify the exact lock/release/refund transaction type, reference, account direction and amount before accepting an Escrow lifecycle change. `contractId` remains an opaque protocol reference until the protocol-native Contract model exists; M2-04 does not introduce Contract early.

### V2-M2-05 boundary

M2-05 closes the economic foundation with a general integrity and contention gate:

- the canonical posting path uses Read Committed transactions and serializes the ledger head before taking participating account row locks;
- the canonical posting path rejects any posting that would make a protected Principal or finite system account negative;
- domain workflows that move Credit must reuse this posting path rather than establishing a competing account-lock order;
- `system_reserve` remains the controlled issuance source and is deliberately not treated as a finite spend account;
- a transaction-scoped PostgreSQL advisory lock serializes global ledger-head assignment and all canonical economic writes;
- every posted transaction records the current posted head in `previousHash`;
- the posted-chain partial unique index permits draft work-in-progress but prevents two posted transactions from sharing one non-null predecessor hash;
- bounded retries remain as defensive handling for database uniqueness/concurrency races, but correctness does not depend on serializable snapshot retries;
- Protocol Incentive awards debit only the finite `system_incentive` pool and preserve Credit provenance;
- contention tests prove concurrent awards cannot over-spend the pool and database constraints reject posted ledger-chain forks;
- closure hardening adds mixed Escrow/direct-posting contention coverage, prevents duplicated pre-post account locking from being reintroduced, prevents draft rows from poisoning the current ledger head, and locks the advisory-lock + Read Committed concurrency model into CI.

M2 intentionally stops here. It does not introduce Task, Offer, Contract, Delivery, Acceptance, Settlement, Reputation, or production economic write-path cutover merely to exercise the ledger.

## M3 — Task / Offer Protocol — ACTIVE

Goal:

> Establish immutable, machine-readable Task and Firm Offer snapshots that can later be bound atomically into exactly one Contract without falling back to mutable legacy Demand/Proposal state.

### M3 work sequence

- V2-M3-01 — Task / TaskRevision / TaskCapabilityRequirement foundation — **COMPLETE** (PR #17)
- V2-M3-02 — Firm Offer / OfferRevision foundation — **COMPLETE** (PR #18)
- V2-M3-03 — Task/Offer lifecycle, stale-offer and eligibility invariants — **COMPLETE** (PR #19)
- V2-M3-04 — signed economic command binding / authority snapshot integration — **COMPLETE** (PR #20 implementation gate / CI #66)
- V2-M3-05 — M3 protocol integrity gate — **NEXT**

### V2-M3-01 boundary

M3-01 introduces a new protocol-native Task domain alongside legacy `Demand`; there is no destructive rename or production route cutover.

The stable `Task` row owns issuer identity, visibility and lifecycle state. Economic/work content lives in append-only `TaskRevision` snapshots. Every committed Task must have a contiguous revision chain from 1 through `currentRevision`, and every committed revision must be sealed. Once sealed, a revision and its `TaskCapabilityRequirement` rows are immutable.

Task revision evidence is hashed from canonical structured payload groups:

```text
protocolPayload
+ workPayload
+ marketPayload
+ trustPayload
+ policyPayload
+ sorted capability requirements
→ contentHash
```

Capability requirements are attached to the exact TaskRevision so a future Firm Offer can bind `task_id + task_revision + task_hash`. Revising an OPEN Task creates a new immutable revision rather than rewriting the old one; future offers bound to older revision/hash pairs can therefore be detected as stale.

`TaskCapabilityRequirement.capabilityId` intentionally has no foreign key to `CapabilityDefinition`. The capability registry remains an index rather than an allowlist, so external URI/URN capability namespaces remain valid protocol requirements.

M3-01 does not yet introduce Offer, Contract, Escrow reservation during acceptance, production API cutover, or legacy Demand shadow-write behavior. Authority/signature enforcement for economic Task commands is a later M3 slice; this foundation only establishes protocol storage, deterministic evidence and database invariants.

### V2-M3-02 boundary

M3-02 introduces protocol-native `Offer` and immutable `OfferRevision` alongside legacy `Proposal`. A2A conversation and indicative quotes remain non-binding; the Offer aggregate is reserved for Firm Offer commitment evidence.

Each Offer chain is unique per `(taskId, supplierPrincipalId)` in the MVP. The original M3-02 storage foundation attached Task snapshot, supplier authority evidence, nonce and signature fields to each immutable revision. M3-04 later refines the signable economic payload into `iwantu-firm-offer/0.2` so the exact Offer hash is computable before server-side authority evidence is generated.

The v0.2 Offer hash now binds:

```text
task id
+ exact sealed TaskRevision revision / taskHash
+ offer revision
+ IWC price
+ optional delivery commitment
+ finite validUntil
+ canonical terms payload / termsHash
+ supplier Principal / Agent
+ nonce
→ offerHash
```

`OfferRevision.supplierAuthoritySnapshotId` and signature fields remain immutable attached evidence, but they are deliberately excluded from the signable Offer hash to avoid a circular dependency on a server-generated snapshot id.

`OfferRevision` rows are append-only. Supplier term changes create a new revision while preserving older evidence. Revision allocation locks the stable Offer row so concurrent revisions form a contiguous chain rather than duplicate revision numbers.

Database triggers independently require the referenced TaskRevision to belong to the Offer Task and match `taskHash`, and require the AuthoritySnapshot to belong to the same supplier Principal/Agent. The snapshot is historical evidence only; it is not reused as live authority for a future command.

M3-02 originally stored signature algorithm/key/signature material as commitment evidence without claiming cryptographic verification. M3-04 closes that gap for signed Firm Offer issue/revision through the live economic-command path.

No Contract, Escrow reservation during acceptance, production route cutover, or legacy Proposal shadow write is introduced in M3-02.

### V2-M3-03 boundary

M3-03 turns Task/Offer snapshots into a deterministic pre-formation state and eligibility layer.

Lifecycle writes now enforce:

```text
Task:  draft -> open
       draft/open -> cancelled
       open -> closed

Offer: active -> withdrawn
       active -> closed
```

Task `awarded` and Offer `accepted` / `not_selected` remain reserved for future atomic Contract Formation and are rejected by ordinary database writes. A deferred database consistency gate requires that a non-OPEN Task cannot commit while retaining ACTIVE Offers. Task cancellation or ordinary closure therefore closes active Offer chains in the same transaction.

Firm Offer staleness is derived rather than stored: the exact OfferRevision TaskRevision/hash must still equal the Task's current sealed revision/hash. No mutable `isStale` field is introduced.

`evaluateFirmOfferAcceptability()` evaluates an exact `offerId + revision + offerHash` and fails closed on Task lifecycle, Offer lifecycle, supersession, evidence-hash mismatch, TTL expiry, Task revision drift, inactive Supplier Principal/Agent, and capability mismatch.

Capability eligibility requires at least one non-retired AgentVersion of the Supplier AgentIdentity to satisfy the complete current Task capability requirement set. Claims are matched by exact capability id; both `declared` and `verified` claims establish capability presence in M3-03, while stronger trust/reputation semantics remain separate.

All M3 Task/Offer state mutations now share a `Task -> Offer(s)` row-lock order. This prevents cancellation/closure from introducing lock inversion against concurrent Offer revision or withdrawal.

M3-03 does not form a Contract, reserve Escrow, move Ledger value, verify the buyer acceptance signature, reuse AuthoritySnapshot as live authority, or cut over legacy Demand/Proposal production routes.

### V2-M3-04 boundary

M3-04 closes the gap between stored Firm Offer signature fields and an actually authenticated, signed and currently authorized Agent commitment.

The canonical signed Firm Offer issue/revision path is:

```text
v2 API AgentCredential authentication
→ exact Firm Offer v0.2 hash
→ EdDSA signature verification with a separate SIGNING AgentCredential
→ live Principal / Agent / credential kill-switch checks
→ named live Mandate / Delegation resolution
→ Buyer counterparty policy
→ all current Task capability scopes
→ exact fixed-point singleContract IWC limit
→ authenticated authority binding
→ fresh AuthoritySnapshot command evidence
→ immutable Offer / OfferRevision write
```

Access and economic signing credentials remain separate. A normal API credential cannot substitute for a SIGNING credential, iWANTU stores only public signing verification material, and caller-supplied historical AuthoritySnapshot ids are rejected by the canonical signed path.

The economic command envelope (`iwantu-economic-command/0.1`) binds action, authenticated Principal/Agent, presented Mandate, exact Offer payload hash, nonce, short issuedAt/expiresAt window, signing key id and algorithm. OfferRevision nonce remains the immutable replay guard.

All live authorization checks, fresh AuthoritySnapshot creation and the Offer write occur in one database transaction. Task state is locked before the Offer hash is computed, preserving the M3 `Task -> Offer` order and ensuring a Task revision racing an already-signed Offer fails signature verification rather than silently rebinding the commitment.

PR #20 implementation CI #66 passed the full migration/invariant/lint/typecheck/build gate with real Ed25519 key/JWK verification. M3-04 does not introduce Contract, Buyer ACCEPT_OFFER, Escrow reservation, Supplier Stake, Reputation/Integrity execution, or production route cutover.

M3-05 remains responsible for the final Task/Offer protocol integrity closure before Contract Formation begins.

Contract, Delivery, Acceptance, Settlement and Reputation remain later protocol work.
