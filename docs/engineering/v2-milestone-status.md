# iWANTU v2 Engineering Milestone Status

Updated: 2026-09-05

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

## M2 — Economic Ledger Foundation — ACTIVE

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

### M2 work sequence

- V2-M2-01 — Ledger schema & accounting invariants — **COMPLETE** (`75986d9e`)
- V2-M2-02 — Atomic posting engine — **COMPLETE** (`fb489b51`)
- V2-M2-03 — Credit provenance & account bootstrap — **ACTIVE**
- V2-M2-04 — Escrow primitives — NOT STARTED
- V2-M2-05 — Ledger integrity / concurrency gate — NOT STARTED

### V2-M2-02 boundary

The atomic posting engine is the single canonical application write path for future economic events:

```text
normalize + validate
→ canonical economic evidence hash
→ idempotency check
→ SERIALIZABLE database transaction
→ lock active IWC accounts
→ create draft LedgerTransaction
→ append LedgerEntry rows
→ finalize posted
→ commit
```

M2-02 deliberately does not claim a global transaction hash chain. `previousHash` remains unset by the posting engine until M2-05 introduces a serialized chain-head/concurrency invariant. This avoids creating a hash chain that can fork under concurrent writes.

### V2-M2-03 boundary

M2-03 establishes:

- three Principal-owned IWC accounts: Available / Locked / Pending;
- four platform system accounts: Reserve / Clearing / Fee / Incentive;
- structured `iwantu-credit-provenance/0.1` metadata for Genesis, Purchased, Earned, Incentive and Refund origins;
- one Genesis allocation chain per Principal/allocation version;
- Purchased Credit idempotency keyed by the external purchase reference;
- a finite Protocol Incentive system pool funded from Reserve.

M2-03 does not add a P2P transfer API and does not allow an Agent to own a LedgerAccount. Genesis and Purchased Credit are the controlled issuance paths implemented in this phase. Protocol Incentive awards to a Principal remain deferred until M2-05 can enforce an atomic no-overdraft invariant against the finite Incentive pool under concurrent writers.

## M3 — Task / Offer Protocol — NOT STARTED

Task / TaskRevision / TaskCapabilityRequirement / Offer / OfferRevision remain M3 work and must not be pulled into M2 merely to exercise the ledger.

Contract, Delivery, Acceptance, Settlement and Reputation remain later protocol work.
