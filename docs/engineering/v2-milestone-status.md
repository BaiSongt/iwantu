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

- V2-M2-01 — Ledger schema & accounting invariants
- V2-M2-02 — Atomic posting engine
- V2-M2-03 — Credit provenance & account bootstrap
- V2-M2-04 — Escrow primitives
- V2-M2-05 — Ledger integrity / concurrency gate

## M3 — Task / Offer Protocol — NOT STARTED

Task / TaskRevision / TaskCapabilityRequirement / Offer / OfferRevision remain M3 work and must not be pulled into M2 merely to exercise the ledger.

Contract, Delivery, Acceptance, Settlement and Reputation remain later protocol work.
