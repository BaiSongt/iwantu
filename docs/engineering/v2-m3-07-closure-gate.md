# V2-M3-07 — Task / Firm Offer Closure Gate

Status: IMPLEMENTED ON PR #23

## Goal

Close the final M3 application/database bypass before Contract Formation begins.

M3-06 established the canonical authenticated and signed Supplier withdrawal command, but retained the older `withdrawFirmOffer()` lifecycle helper for compatibility tests. That helper could still move an ACTIVE Firm Offer to `withdrawn` without v2 AgentCredential authentication, EdDSA verification, live Mandate resolution, a fresh AuthoritySnapshot, or an immutable withdrawal receipt.

M3-07 removes that compatibility mutation and makes the signed receipt a database prerequisite for the state transition itself.

## Canonical boundary

Supplier-initiated withdrawal is now one protocol path:

```text
v2 AgentCredential authentication
→ exact current Offer revision/hash
→ signed iwantu-economic-command/0.1 action=offer.withdraw
→ live Mandate / Delegation resolution
→ fresh AuthoritySnapshot
→ immutable withdrawal receipt
→ Offer active -> withdrawn
```

`task-offer-lifecycle.mjs` no longer exposes an unsigned `withdrawFirmOffer()` mutation.

## Database closure gate

The migration adds two independent database guards.

### Receipt binding guard

Before an `offer_withdrawal_receipts` row may be inserted, PostgreSQL verifies that it binds to:

- an existing ACTIVE Offer;
- the Offer's exact current revision and `offerHash`;
- the Offer's Supplier Principal and AgentIdentity;
- an AuthoritySnapshot for the same Supplier;
- `resolvedAction = offer.withdraw`;
- the same command hash, withdrawal payload hash, nonce, signing key id and signature algorithm captured in AuthoritySnapshot request evidence;
- a non-empty signing credential reference in the AuthoritySnapshot evidence.

Receipt UPDATE and DELETE remain prohibited by the M3-06 append-only trigger.

### Offer status guard

Any transition into `withdrawn` is rejected unless the matching immutable withdrawal receipt already exists for the exact current Offer revision/hash and Supplier identity.

This deliberately matches `withdrawSignedFirmOffer()`, which writes the validated receipt before changing the Offer status in the same database transaction.

## Invariant coverage

M3 lifecycle tests now prove that:

1. the lifecycle module contains no exported unsigned withdrawal mutation;
2. a direct Prisma `active -> withdrawn` write fails closed and the Firm Offer remains eligible;
3. a direct withdrawal racing a legitimate Offer revision cannot bypass the receipt gate;
4. the existing M3-06 signed withdrawal tests remain the positive path for entering `withdrawn`.

## M3 closure

When PR #23 passes the full migration/invariant/lint/typecheck/build gate and is merged, M3 Task / Offer Protocol is complete for the v2 pre-Contract boundary.

M3 closure does not cut over legacy Demand/Proposal production routes and does not introduce Contract, Escrow reservation, Delivery, Settlement or Reputation.

The next milestone is M4 Contract Formation: bind one exact current TaskRevision and one exact verified Firm Offer into one immutable Contract under authenticated requester authority and atomic economic reservation rules.
