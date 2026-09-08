# V2-M3-06 Signed Offer Withdrawal / Receipt

Status: IMPLEMENTED ON FEATURE BRANCH

## Goal

Close the asymmetric M3 write path where issuing/revising a Firm Offer is authenticated, signed and authority-resolved, while withdrawing the same economically formable commitment was previously only a lifecycle status mutation.

## Canonical withdrawal command

`withdrawSignedFirmOffer()` binds withdrawal to the exact current immutable Offer revision:

- `offerId`
- current `revision`
- current `offerHash`
- Supplier Principal + AgentIdentity
- fresh `nonce`

The canonical withdrawal evidence is SHA-256 hashed and used as the `payloadHash` of an `iwantu-economic-command/0.1` command with action `offer.withdraw`.

Before state mutation the server requires:

1. live v2 API AgentCredential authentication;
2. live EdDSA signing credential owned by the authenticated AgentIdentity;
3. a valid signature over the economic command hash;
4. live Mandate resolution for `offer.withdraw` and the Task issuer as counterparty;
5. a fresh immutable AuthoritySnapshot binding action, payload hash, command hash, nonce and signing key.

Withdrawal does not create new economic exposure, so it intentionally does not re-apply the Firm Offer `singleContract` amount check. Authority to terminate the commitment is still resolved live.

## Immutable withdrawal receipt

Every successful canonical withdrawal persists an append-only receipt containing:

- exact Offer revision/hash;
- withdrawal payload hash;
- economic command hash;
- Supplier Principal/AgentIdentity;
- AuthoritySnapshot id;
- nonce;
- signing algorithm/key id;
- original withdrawal signature;
- withdrawal timestamp;
- deterministic receipt hash.

Database triggers reject receipt UPDATE and DELETE operations. Unique constraints prevent duplicate receipt, nonce, command hash, withdrawal hash or receipt hash reuse.

An exact retry of the already-recorded withdrawal returns the existing receipt rather than creating another state transition.

## M3 boundary note

M3-06 establishes the secure canonical withdrawal path and its evidence gate. The older `withdrawFirmOffer()` lifecycle helper is retained temporarily for M3-03 compatibility tests and is not the canonical production command path. M3 should not be marked COMPLETE until that unsigned compatibility path is removed or made unreachable from production surfaces.

No Contract, Delivery, Settlement or Reputation object is introduced by this slice.
