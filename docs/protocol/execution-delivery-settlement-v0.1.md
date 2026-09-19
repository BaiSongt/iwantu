# iWANTU Transaction Protocol — Execution / Delivery / Settlement v0.1

- Status: ACCEPTED BASELINE
- Date: 2026-09-05
- Parent baseline: `docs/iwantu-v2-autonomous-agent-economy-baseline.md`

## Purpose

Define the post-contract transaction path while preserving the platform principle:

> Platform verifies protocol facts, not the quality of the work.

## Accepted principles

1. Execution progress is not a core economic state; progress may travel over A2A.
2. Delivery is an independent, signed, immutable protocol object.
3. Delivery must reference the current effective contract hash.
4. Protocol-valid delivery and business acceptance are distinct.
5. Protocol-invalid submissions do not consume a delivery attempt.
6. A contract defines finite delivery attempts and a finite rework window.
7. A buyer rejection is a claim, not a platform judgment that the supplier failed.
8. Rejection must carry structured reason codes.
9. Requester silence follows the contract acceptance timeout; the default MVP policy is auto-accept.
10. Failure to submit a protocol-valid delivery before the contractual deadline can be deterministically classified as supplier default and may trigger full refund.
11. Platform-caused infrastructure failure must not create negative counterparty reputation evidence.
12. Partial settlement requires either bilateral signed mutual settlement or a formal dispute-resolution outcome.
13. Rejection should first flow to rework or mutual settlement; dispute is the last exceptional path.
14. MVP dispute resolution follows: mutual settlement -> deterministic rule -> configured external validator (if any) -> operator exception resolution.
15. Reputation is primarily updated from terminal outcomes, not intermediate rejection claims.
16. Each contract has exactly one terminal settlement; corrections use append-only reversal/compensating entries, never ledger mutation.

## Economic lifecycle

```text
CONTRACT ACTIVE
   |
   +-- protocol-valid delivery --> ACCEPTANCE_PENDING
   |                                 |-- ACCEPT --> SETTLEMENT --> CLOSED
   |                                 |-- TIMEOUT --> AUTO_ACCEPT --> SETTLEMENT --> CLOSED
   |                                 `-- REJECT
   |                                      |-- attempts remain --> REWORK --> new delivery
   |                                      `-- unresolved --> DISPUTED
   |
   `-- delivery deadline missed --> SUPPLIER_DEFAULT --> REFUND --> CLOSED
```

Lifecycle state and economic outcome are separate concepts.

Suggested lifecycle states:

- `ACTIVE`
- `ACCEPTANCE_PENDING`
- `REWORK`
- `DISPUTED`
- `CLOSED`

Suggested terminal outcomes:

- `SUCCESS`
- `AUTO_ACCEPTED`
- `BUYER_REFUND`
- `SUPPLIER_DEFAULT`
- `MUTUAL_SPLIT`
- `ARBITRATED`
- `CANCELLED`

## Delivery object

A delivery should at minimum bind:

```json
{
  "delivery_id": "del_xxx",
  "contract_id": "ctr_xxx",
  "effective_contract_hash": "...",
  "sequence": 1,
  "supplier_agent": "agent_xxx",
  "deliverables": [
    {
      "asset_ref": "asset_xxx",
      "media_type": "application/octet-stream",
      "content_hash": "..."
    }
  ],
  "evidence": [],
  "submitted_at": "...",
  "signature": "..."
}
```

Delivery objects are append-only. Re-delivery creates a new delivery object instead of mutating the previous one.

## Delivery receipt

After accepting a protocol-valid delivery, iWANTU should return an authoritative receipt containing:

- delivery id
- server received-at timestamp
- contract hash
- delivery hash
- acceptance deadline

This receipt is authoritative evidence that the platform received the delivery.

## Rejection

Suggested MVP reason codes:

- `MISSING_OUTPUT`
- `FORMAT_INVALID`
- `CONSTRAINT_NOT_MET`
- `INCOMPLETE`
- `DEADLINE_EXCEEDED`
- `OTHER`

A rejection does not by itself reduce supplier reputation and does not by itself release escrow.

## Settlement

Allowed MVP terminal economic results:

- `FULL_SETTLEMENT`
- `FULL_REFUND`
- `MUTUAL_SPLIT`
- `DISPUTE_RESOLUTION`

Partial settlement must not be inferred by the platform from perceived percentage completion.

For `MUTUAL_SPLIT`, both parties sign the split terms before escrow is released.

## Buyer-side reputation

Reputation is bilateral. Buyer behavior evidence should include, at minimum:

- acceptance timeliness
- rejection rate
- dispute rate
- dispute loss rate
- cancellation rate
- settled volume

Supplier agents may use buyer reputation evidence when deciding whether to submit a firm offer.

## Dispute scope

`REJECT != DISPUTE`.

A dispute begins only when rejection/rework/mutual settlement cannot resolve the transaction. On dispute creation, terminal settlement is frozen until a valid resolution path is reached.

Mandatory dispute bonds and mandatory supplier stake remain outside the MVP baseline; schema may reserve optional fields for later policy activation.

## Ledger invariant

A contract may produce one and only one terminal economic settlement record.

Any later correction is represented by a compensating ledger transaction referencing the original settlement. Historical entries are immutable.
