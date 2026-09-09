# iWANTU Identity / Mandate / Delegation Protocol v0.1

- Status: **ACCEPTED BASELINE**
- Scope: Principal, Agent Identity, Credential, Mandate, Delegation, revocation and authority resolution

## Core model

```text
Principal
   │ owns / controls
   ▼
Agent Identity
   │
   ├── Credential   -> proves who is acting
   └── Mandate      -> defines what the agent may do
            │
            ▼
      Economic Command
            │
            ▼
      Authority Pipeline
```

## Accepted principles

1. **Principal is the trust root for assets, responsibility and authorization.**
2. **Agent Identity is a stable economic identity and is separate from runtime, model and credential.**
3. **Credential proves identity; it does not itself grant authority.**
4. **Economic signing credentials are separated from ordinary API/access credentials.**
5. **Agent private signing keys should not be stored by iWANTU.**
6. **Credentials support rotation and revocation; historical public keys remain available to verify historical commitments.**
7. **Mandate is signed, immutable, versioned and revocable.**
8. **Mandate constrains at least Action, Capability, Economic, Resource, Counterparty and Time scopes.**
9. **Data access authority is controlled independently and cannot be inferred from economic spending authority.**
10. **Delegation can only reduce authority; scope escalation is forbidden.**
11. **Effective Authority is the intersection of every active mandate in the authority chain.**
12. **MVP default maximum delegation depth is 1.**
13. **Every economic command must resolve an Authority Chain back to a Principal.**
14. **Contracts preserve buyer and supplier authority snapshots / mandate-chain hashes.**
15. **Mandate revocation blocks new commitments immediately but does not erase already-formed contractual obligations.**
16. **Agent Identity is not physically deleted; MVP prohibits cross-Principal ownership transfer of an Agent Identity.**
17. **Credential Revoke, Agent Suspend, Mandate Revoke and Principal Freeze are distinct kill switches with increasing blast radius.**
18. **Access authentication and signed economic commitment are separate security layers.**

## Principal

A Principal is the final owner of economic assets and responsibility. MVP supports:

- Individual Principal
- Organization Principal

Principal owns or controls:

- Agent identities
- Wallet / credit accounts
- Assets and data grants
- Mandates and organizational policy
- Contractual responsibility generated through authorized agents

An Agent does not become the final owner of the Principal's assets merely because it can act on them.

## Agent Identity

Agent Identity is a persistent protocol identity. It is not an API key, endpoint, process, model vendor or runtime instance.

Suggested lifecycle:

```text
ACTIVE -> SUSPENDED -> RETIRED
```

Historical identity records must remain resolvable because Offers, Contracts, Deliveries and Settlements reference them.

Agent runtime/version changes should be recorded independently so Reputation Evidence can distinguish overall historical performance from current-version behavior.

## Credentials

Credential categories should include at least:

- SIGNING: signs Firm Offer, Acceptance, Delivery, Amendment, Mutual Settlement, delegated mandate
- API: authenticates ordinary API access
- OAUTH/A2A: interoperability access credentials where applicable

Private economic signing keys remain with the Agent runtime / owner-controlled key system. iWANTU stores public verification material such as key id, public key/JWK, algorithm, status and validity periods.

API-style shared secrets must be stored as hashes (plus non-secret prefix/id for lookup), not raw secrets.

Credential lifecycle supports ACTIVE, RETIRED and REVOKED. Revocation does not delete the historical verification key.

## Mandate

A Mandate is a machine-verifiable authorization credential issued by a Principal or an authorized delegating Agent to a subject Agent.

Conceptual shape:

```json
{
  "mandate_id": "mdt_001",
  "version": 1,
  "issuer": "principal_company_x",
  "subject": "agent_procurement_01",
  "permissions": ["task.publish", "offer.accept", "contract.form"],
  "capability_scopes": ["manufacturing.cam.*"],
  "economic_limits": {
    "single_contract": 500,
    "daily": 2000,
    "monthly": 10000
  },
  "resource_policy": {},
  "counterparty_policy": {},
  "valid_from": "...",
  "valid_until": "...",
  "delegation": {"allowed": true, "max_depth": 1},
  "payload_hash": "...",
  "signature": "..."
}
```

A Mandate is never updated in place. A change creates a new version / mandate fact and retires or revokes the previous authority.

## Mandate scope dimensions

### Action scope
Examples: task.publish, offer.submit, offer.accept, contract.form, delivery.submit, contract.amend.

### Capability scope
Examples: manufacturing.cam.*, software.code.review.

### Economic scope
Examples: maximum per contract, day and month; maximum concurrent exposure.

### Resource / data scope
Defines which assets may be read or disclosed. Economic authority never implicitly grants access to all Principal data.

### Counterparty scope
Examples: verified organizations only, explicit allowlist/denylist, relationship constraints.

### Temporal scope
Defines valid_from and valid_until.

## Delegation

Delegation invariant:

> **Delegation may only reduce authority, never increase it.**

For an authority chain M0 -> M1 -> ... -> Mn:

```text
Effective Authority = M0 ∩ M1 ∩ ... ∩ Mn
```

If parent authority denies an action or caps a value, a child mandate cannot enable the denied action or raise the cap.

MVP default:

```text
Principal -> Primary Agent -> Sub-Agent
```

with maximum delegation depth 1 from the primary agent.

Every delegated economic action must remain attributable to the final Principal through a verifiable authority chain.

## Revocation semantics

- **Credential Revoke**: a particular credential can no longer authenticate/sign new commands.
- **Agent Suspend**: the Agent cannot create new protocol commitments while suspended.
- **Mandate Revoke**: the Agent loses the authority represented by that mandate for new commitments.
- **Principal Freeze**: stops new economic activity across the Principal's agents at the broadest level.

Critical invariant:

> **Revocation prevents new commitments; it does not erase existing obligations.**

An Offer whose required mandate has been revoked becomes non-formable. An already-active Contract remains an obligation and must be resolved through normal cancellation, amendment or settlement rules.

## Authority snapshots

Firm Offers, Acceptance commands and Contracts must preserve sufficient authority evidence to reconstruct why an Agent had authority at the time of commitment.

Suggested references:

- mandate id/version/hash
- authority chain hash
- principal id
- agent id
- credential/key id
- resolved effective authority snapshot

## Authorization pipeline

```text
Economic Command
      ↓
Access Credential Authentication
      ↓
Economic Payload Signature Verification
      ↓
Agent Identity Status
      ↓
Mandate Resolution
      ↓
Delegation Chain Validation
      ↓
Principal Resolution
      ↓
Policy / Integrity
      ↓
Economic and Resource Limits
      ↓
Current Protocol State
      ↓
EXECUTE / DENY
```

Mandate data is authoritative server-side state. Short-lived access tokens may reference agent/session/scopes, but long-lived revocable Mandate authority must not exist only as unqueryable JWT claims.

## MVP non-goals

- Cross-Principal sale/transfer of Agent Identity
- Unlimited delegation depth
- Mandatory DID/VC infrastructure
- Multi-party enterprise approval workflow for every transaction
- Storing Agent private signing keys in iWANTU

Future compatibility with standards such as Verifiable Credentials may be added without changing the core Principal/Agent/Mandate semantics.