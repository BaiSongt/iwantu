# V2-M3-03 — Task / Offer Lifecycle & Eligibility Gate

Status: ACTIVE

## Goal

Establish one deterministic protocol answer to the question:

> Is this exact Firm Offer revision still acceptable now?

M3-03 does not form a Contract and does not move IWC. It closes the protocol state and eligibility layer required before atomic Contract Formation can exist.

## Lifecycle

Task lifecycle available in this slice:

- `draft -> open`
- `draft -> cancelled`
- `open -> cancelled`
- `open -> closed`

`awarded` is reserved for future atomic Contract Formation and ordinary writes are rejected.

Firm Offer lifecycle available in this slice:

- `active -> withdrawn`
- `active -> closed`

`accepted` and `not_selected` are reserved for future atomic Contract Formation and ordinary writes are rejected.

A terminal Task cannot retain an ACTIVE Firm Offer at transaction commit. Task cancellation/closure therefore closes all active Offer chains atomically.

## Derived staleness

There is deliberately no mutable `isStale` field.

A Firm Offer is stale when its exact bound TaskRevision/hash no longer equals the Task's current sealed revision/hash. Revising an OPEN Task therefore makes prior Offer revisions unacceptable until the Supplier creates a new OfferRevision bound to the new Task snapshot.

## Acceptability evaluator

`evaluateFirmOfferAcceptability()` requires the caller to identify the exact `offerId + revision + offerHash` and returns machine-readable results.

Current checks, in protocol order:

1. Task exists and is OPEN.
2. Offer exists and is ACTIVE.
3. Requested Offer revision is the current revision.
4. Offer hash matches the immutable OfferRevision.
5. Offer TTL is still valid.
6. Offer TaskRevision/hash still equals the current TaskRevision/hash.
7. Supplier Principal is active.
8. Supplier AgentIdentity is active and still owned by that Principal.
9. At least one non-retired AgentVersion of the Supplier Agent satisfies the complete current Task capability requirement set.

Capability matching is exact by `capabilityId` in this slice. `declared` and `verified` claims both satisfy capability presence; higher trust semantics remain separate from basic capability eligibility.

The matching AgentVersion is returned as evaluation evidence, but M3-03 does not yet bind an execution AgentVersion into Contract state because Contract Formation does not exist yet.

## Lock order

Protocol state mutation uses one lock order:

```text
Task row
-> Offer row(s)
```

Offer revision was changed to follow the same order. This prevents lifecycle operations (`cancel/close`) from introducing Task/Offer lock inversion against concurrent Offer revision.

## Explicit boundary

M3-03 does not implement:

- Contract
- ACCEPT_OFFER
- Escrow reservation during acceptance
- Task `awarded`
- Offer `accepted` / competing `not_selected`
- cryptographic command signature verification
- live Mandate/Authority binding for the acceptance command
- Reputation / Integrity policy evaluation
- production Demand/Proposal cutover

Those remain later M3 slices.
