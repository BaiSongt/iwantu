# v2 M5-02 Signed Buyer Acceptance / Rejection Foundation

## Purpose

Close the Buyer-side protocol boundary after a valid Delivery without collapsing acceptance into settlement.

Canonical paths:

`ACCEPTANCE_PENDING -> Buyer-signed delivery.accept -> immutable AcceptanceDecision`

`ACCEPTANCE_PENDING -> Buyer-signed delivery.reject -> immutable AcceptanceDecision -> REWORK`

Escrow remains locked in both paths. Settlement, refund, terminal reputation writes, auto-accept timeout processing, and dispute resolution remain later transitions.

## Binding requirements

Every Buyer decision binds the exact current protocol evidence:

- Contract id and `effectiveContractHash`
- latest Delivery id and `deliveryHash`
- Buyer Principal and AgentIdentity
- `delivery.accept` or `delivery.reject` live AuthoritySnapshot
- signed economic command hash and nonce
- immutable structured decision

A decision against a stale Delivery is invalid even if it belongs to the same Contract.

## Rejection semantics

A rejection is a Buyer claim, not a platform quality judgment. It must use one of the baseline reason codes:

- `MISSING_OUTPUT`
- `FORMAT_INVALID`
- `CONSTRAINT_NOT_MET`
- `INCOMPLETE`
- `DEADLINE_EXCEEDED`
- `OTHER`

A rejection does not release or refund Escrow and does not directly write negative Supplier reputation.

## State invariants

- Decisions are append-only and immutable.
- Exactly one acceptance decision may bind a Delivery.
- Direct `ACCEPTANCE_PENDING -> REWORK` is forbidden without a protocol-valid rejection decision.
- `accept` records acceptance evidence but does not close the Contract in M5-02.
- `reject` may move the Contract to `REWORK`; a later Delivery creates a new immutable Delivery object.
- Escrow remains `locked` after either decision.
- Signed Buyer decisions require live Buyer credential, signing key, Mandate/Delegation resolution, and fresh AuthoritySnapshot.

## Deliberate next boundary

M5-03 must add deterministic acceptance timeout / AUTO_ACCEPT evidence and then use signed ACCEPT or AUTO_ACCEPT as the only valid input to atomic settlement. Settlement must remain exactly-once and ledger-native.
