# v2 M5-01 Signed Delivery Foundation

## Purpose

Close the first execution-side protocol boundary after Contract Formation without introducing settlement or Buyer Acceptance semantics.

The canonical path is:

`ACTIVE Contract -> Supplier-signed delivery.submit -> immutable Delivery -> Contract ACCEPTANCE_PENDING`

A Delivery records a protocol-valid submission. It does not prove Buyer Acceptance, completion, quality, or Escrow release.

## Required evidence binding

Every Delivery must bind the exact economic evidence already established by M4:

- `contractId`
- `effectiveContractHash`
- `taskId`
- `acceptedOfferRevisionId`
- supplier `Principal` and `AgentIdentity`
- supplier `delivery.submit` `AuthoritySnapshot`
- signing credential key id, algorithm, and signature
- monotonic attempt number
- submitted payload hash and payload metadata
- protocol timestamps and deadline evaluation result

The Delivery payload hash must be computed from a canonical serialization of the exact contract-bound submission, not from mutable presentation fields.

## Canonical command gate

The only supported write path is a signed economic command with `action = delivery.submit`:

1. Authenticate the supplier credential.
2. Verify the signature over the canonical command payload.
3. Resolve live Mandate / Delegation authority.
4. Validate the resolved authority against the active Contract and its supplier Principal.
5. Re-load the Contract under a write transaction and verify `status = ACTIVE`.
6. Verify `effectiveContractHash` and `acceptedOfferRevisionId` match the submitted evidence.
7. Enforce deadline and attempt policy.
8. Persist the immutable Delivery and transition the Contract to `ACCEPTANCE_PENDING` atomically.

There must be no direct CRUD path that can create a Delivery or move a Contract into `ACCEPTANCE_PENDING`.

## Invariants

- One Delivery is immutable after insert; no UPDATE or DELETE.
- A Delivery cannot be created for a missing, non-ACTIVE, or hash-mismatched Contract.
- A Delivery cannot be created by the Buyer or by a supplier identity that is not the Contract supplier.
- An invalid, expired, revoked, or economically insufficient authority chain fails closed before persistence.
- A replayed command with the same idempotency key returns the original Delivery receipt and does not create a second Delivery.
- A different payload under an existing idempotency key is rejected.
- A Contract may enter `ACCEPTANCE_PENDING` only after one protocol-valid Delivery exists.
- Delivery submission never releases or transfers Escrow.
- Buyer Acceptance, rejection, rework, dispute, and settlement remain separate later protocol transitions.

## Suggested implementation sequence

1. Add `DeliveryStatus` / attempt semantics and the immutable `Delivery` model plus migration.
2. Add the signed `delivery.submit` command builder / verifier.
3. Add the canonical application service that resolves authority and performs the atomic transition.
4. Add database triggers and uniqueness constraints for immutability, contract hash binding, and idempotency.
5. Add invariant tests for happy path, signature tampering, wrong supplier, stale contract hash, expired authority, replay, and escrow non-release.
6. Add a dedicated CI gate named `v2-m5-signed-delivery`.

## Non-goals for M5-01

- Buyer Acceptance or rejection
- Quality scoring or reputation writes
- Dispute resolution
- Settlement, refund, or fee posting
- Rework workflow beyond preserving an explicit future-compatible attempt field
