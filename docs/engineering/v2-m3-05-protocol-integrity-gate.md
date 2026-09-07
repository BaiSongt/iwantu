# V2-M3-05 — Task / Firm Offer Protocol Integrity Gate

Status: ACTIVE

## Goal

Close the remaining Task / Firm Offer evidence-integrity gap before Contract Formation is introduced.

M3-04 secures the canonical write path for new Supplier Firm Offer issuance and revision. M3-05 adds the consumption-side integrity gate that a future Contract Formation command can run before treating stored Firm Offer evidence as a valid historical commitment.

## Stored Firm Offer integrity verification

`verifyStoredFirmOfferIntegrity()` re-verifies an exact immutable `OfferRevision` from persisted evidence:

```text
Offer + OfferRevision
→ exact sealed TaskRevision binding
→ termsHash recomputation
→ iwantu-firm-offer/0.2 offerHash recomputation
→ exact AuthoritySnapshot supplier binding
→ exact action / offerHash / nonce / signing key / algorithm binding
→ AuthoritySnapshot evidenceHash recomputation
→ historical SIGNING AgentCredential public-key lookup
→ EdDSA Supplier signature verification
→ OFFER_INTEGRITY_VERIFIED
```

This verifier is historical evidence validation, not live authorization. A future Contract Formation path must still evaluate current Task/Offer formability and current protocol policy before creating a Contract.

## Closed gap

The M3-02 storage foundation intentionally allowed `issueFirmOffer()` to persist pre-supplied historical evidence while M3-04 later introduced the canonical live signed writer. Database binding currently proves that an AuthoritySnapshot belongs to the same Supplier Principal/Agent, but that identity-level relation alone does not prove the snapshot belongs to this exact Offer command.

The M3-05 verifier therefore fails closed if a same-supplier snapshot is substituted but its request evidence does not match the exact immutable:

- action (`offer.issue` for revision 1, `offer.revise` for later revisions);
- `offerHash`;
- nonce;
- signing key id;
- signature algorithm.

It also recomputes the snapshot evidence hash and verifies the historical economic signature using the referenced public signing key.

## Revocation semantics

Historical signature verification deliberately does not require the signing credential to remain ACTIVE.

A signing credential or Mandate may be revoked after a Firm Offer was issued. Revocation blocks new commitments and can make an existing Offer non-formable under live policy, but it must not erase the ability to verify historical evidence. Public verification material therefore remains usable for historical integrity checks.

## CI coverage

The M3-05 gate adds tests proving:

1. a coherently stored Firm Offer can be fully re-verified from immutable evidence;
2. an AuthoritySnapshot from the same Supplier cannot be substituted when its payload binding is for a different Offer;
3. later signing-credential revocation does not destroy historical signature verifiability.

The new verifier and tests are included in `lint:m3` and the full `test:invariants` sequence.

## Remaining M3 closure

Before M3 can be marked COMPLETE, the remaining pre-Contract boundary is the canonical signed withdrawal/receipt path identified by M3-04. External production write-path cutover remains out of scope until that commitment-removal operation is authenticated and auditable.

M3-05 does not introduce Contract, Buyer acceptance, Escrow reservation, Supplier Stake, Delivery, Settlement, Reputation, or production legacy-route cutover.
