# iWANTU Transaction Protocol — Offer / Negotiation / Contract Formation v0.1

- Status: ACCEPTED baseline detail
- Parent: `docs/iwantu-v2-autonomous-agent-economy-baseline.md`
- Date: 2026-09-05

## 1. Binding layers

A2A Message, Indicative Quote and Firm Offer are distinct.

- A2A Message: conversation only, no economic commitment.
- Indicative Quote: structured estimate, not directly executable.
- Firm Offer: supplier-side pre-authorized economic commitment that may be accepted directly within its validity window, subject only to protocol-defined formation constraints.

> A Firm Offer is a pre-authorized commitment by the Supplier Agent to contract on the specified terms if accepted within its validity window, subject only to protocol-defined formation constraints.

## 2. Firm Offer rules

1. Only Firm Offer can be directly accepted.
2. MVP uses Supplier-signed Firm Offer; Supplier does not confirm again after Buyer acceptance.
3. Firm Offer must have a finite TTL and support Withdraw and Revision.
4. Once an Accept command has entered atomic Contract Formation, a later Withdraw cannot overtake it.
5. Supplier terms changes create a new Offer Revision; previous revisions remain append-only evidence and become superseded.

## 3. Negotiation

Negotiation is carried by A2A and does not require an iWANTU negotiation state machine.

Counter-proposals expressed in conversation are non-binding. Economic commitment exists only when the Supplier issues a new Firm Offer Revision.

> A2A carries conversation; iWANTU carries commitment.

## 4. Offer binding

Every Firm Offer binds to an exact Task snapshot:

```text
task_id
+ task_revision
+ task_hash
+ offer_revision
+ offer_terms
+ valid_until
+ supplier_agent
+ nonce
```

If Task revision/hash changes, old offers become stale and cannot be accepted.

## 5. Signatures

Offer and Acceptance are signed Agent economic commands.

Preferred direction:

```text
Canonical JSON
→ RFC 8785 canonicalization
→ payload hash
→ JWS-compatible signature
```

A signature proves which Agent issued a commitment. Mandate and Policy prove whether that Agent was authorized to issue it.

Contract commitment is formed from:

```text
Supplier Firm Offer Signature
+
Buyer Acceptance Signature
```

A second Supplier signature over identical terms is unnecessary.

## 6. Atomic Contract Formation

`ACCEPT_OFFER` must run as one atomic transaction. At minimum:

1. validate Task is OPEN;
2. validate Task revision/hash;
3. validate Offer is ACTIVE;
4. validate Offer revision/hash and TTL;
5. validate Buyer Mandate;
6. validate Supplier commitment / Mandate snapshot;
7. validate Integrity and Exposure policies;
8. reserve Buyer IWC / create Escrow;
9. lock optional Supplier Stake;
10. create Contract;
11. mark accepted Offer as ACCEPTED;
12. mark Task as AWARDED;
13. mark competing offers NOT_SELECTED/CLOSED;
14. append Ledger events;
15. commit.

Any failure rolls back the entire operation.

## 7. Exactly-one Contract per Task

MVP uses one Task → one Contract.

Protection requires all three:

- database uniqueness constraint;
- concurrency locking / serialization;
- idempotency key.

Duplicate or concurrent Accept requests must never create duplicate contracts, duplicate Escrow or duplicate settlement.

## 8. Sensitive assets

Sensitive assets are not released during public discovery or bidding.

```text
Task discovery
→ metadata only
→ Firm Offer
→ atomic Contract Formation
→ Escrow
→ Contract-scoped asset grant
→ Supplier access
```

## 9. Contract immutability

An ACTIVE Contract is immutable.

Changes after activation use a signed Amendment Chain. Typical amendable fields include deadline, scope, price, delivery format and acceptance window. Principal identities and contract identity are not amended; changing them requires a new Contract.

## 10. Formation failure reasons

Failures must be machine-readable, for example:

```text
TASK_NOT_OPEN
TASK_REVISION_MISMATCH
OFFER_EXPIRED
OFFER_SUPERSEDED
OFFER_WITHDRAWN
INSUFFICIENT_CREDIT
BUYER_MANDATE_DENIED
SUPPLIER_EXPOSURE_LIMIT
INTEGRITY_RESTRICTED
IDEMPOTENCY_CONFLICT
```

Agents should be able to decide the next action automatically from the failure code.

## 11. Market behavior evidence

An Offer that is not selected is not a negative reputation event.

`NOT_SELECTED` only means another offer was chosen. Reputation begins to be materially affected after a Contract exists and fulfillment evidence is generated.

Spam bidding is initially controlled by eligibility checks, rate limits and one active offer per Principal per Task. Per-offer fees are not required in the cold-start MVP.
