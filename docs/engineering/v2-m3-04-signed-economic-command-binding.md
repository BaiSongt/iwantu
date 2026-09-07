# V2-M3-04 — Signed Economic Command Binding / Authority Integration

Status: ACTIVE

## Goal

Close the security gap between stored Firm Offer signature fields and an actually authorized Agent economic commitment.

M3-04 makes new Supplier Firm Offer issuance/revision follow this canonical path:

```text
v2 API AgentCredential authentication
→ exact Firm Offer v0.2 hash
→ EdDSA economic signature verification
→ live signing AgentCredential
→ live Mandate / Delegation resolution
→ capability + counterparty + exact singleContract limit checks
→ authenticated authority binding
→ fresh AuthoritySnapshot evidence
→ immutable Offer / OfferRevision write
```

All checks and the Offer write occur in one database transaction.

## Firm Offer hash v0.2

`iwantu-firm-offer/0.2` hashes only the immutable economic commitment payload:

- Task id
- exact current Task revision / hash
- Offer revision
- price / currency
- delivery commitment
- finite validity window
- canonical terms / terms hash
- Supplier Principal / AgentIdentity
- nonce

The Offer hash deliberately does **not** include:

- `supplierAuthoritySnapshotId`
- signature bytes

Those are immutable evidence attached to the stored revision, not economic terms.

This removes the circular dependency that would otherwise require a server-generated AuthoritySnapshot id to exist before the client could compute and sign the Offer hash.

## Economic command envelope

The Supplier signature is verified over the SHA-256 hash of canonical `iwantu-economic-command/0.1` evidence containing:

- action (`offer.issue` / `offer.revise`)
- authenticated Principal id
- authenticated AgentIdentity id
- presented Mandate id
- Firm Offer payload hash
- nonce
- issuedAt / expiresAt
- signing key id
- signature algorithm

The command TTL is intentionally short and the Offer nonce remains the immutable replay guard.

## Credential separation

Access authentication and economic signing remain separate layers:

- API AgentCredential authenticates the request transport identity.
- SIGNING AgentCredential verifies the economic commitment signature.
- A normal API credential cannot substitute for a signing credential.
- Private signing keys are never stored by iWANTU.

M3-04 initially supports EdDSA signing credentials with public JWK verification material.

## Live authority

An old AuthoritySnapshot is never accepted as authority input.

The signed path rejects caller-supplied `supplierAuthoritySnapshotId`, resolves the named Mandate from current server-side state, checks current Principal / Agent / Credential / Mandate kill switches, validates every current Task capability against effective capability scope, validates Buyer counterparty policy, and compares the exact 8-decimal Offer price against `economicLimits.singleContract`.

Only after those live checks succeed is a new AuthoritySnapshot persisted and attached to the OfferRevision.

The snapshot records both transport credential evidence and signing-command evidence (`commandHash`, `payloadHash`, nonce, signing credential/key, required capabilities).

## Concurrency / stale protection

The signed path preserves the M3 lock order:

```text
Task → Offer
```

The Task row is locked before computing the Offer hash. Therefore a Task revision racing a pre-signed Offer cannot silently bind the old signature to new Task state: the server recomputes the current Offer hash and signature verification fails closed.

Offer revisions lock the Offer row before allocating the next revision number.

## Scope boundary

M3-04 secures the current protocol operation that creates/changes Supplier economic commitment: Firm Offer issue and revision.

It does not yet add:

- Contract
- ACCEPT_OFFER
- Buyer acceptance signature
- Escrow reservation during acceptance
- Supplier Stake
- reputation / integrity policy execution
- production route cutover
- signed withdrawal receipt model

Offer withdrawal currently removes future formability rather than creating a new commitment. Its production signed-command receipt/cutover remains part of the M3 integrity closure before external write paths are enabled.
