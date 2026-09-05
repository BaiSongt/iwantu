# M2 Ledger Database Invariants

This note documents the database invariants introduced by V2-M2-01.

## Transaction finalization

`LedgerTransaction` has a deliberately narrow lifecycle:

```text
draft -> posted
```

A draft transaction may receive append-only `LedgerEntry` rows. The only allowed transaction update is the finalization update to `posted`.

The database rejects finalization unless:

- at least two entries exist;
- every entry amount is positive;
- debit total equals credit total;
- `transactionHash` is present and formatted as lowercase SHA-256 hex;
- `postedAt` is present.

Once posted, the transaction cannot be updated or deleted. Ledger entries cannot be updated or deleted at any stage and cannot be appended after posting.

## Account identity

Principal account types require `principalId`:

- `principal_available`
- `principal_locked`
- `principal_pending`

System account types require `principalId = NULL`:

- `system_reserve`
- `system_clearing`
- `system_fee`
- `system_incentive`

First-stage currency is `IWC` only. Account ownership/type/currency identity is immutable.

## Idempotency

`LedgerTransaction.idempotencyKey` is globally unique. Higher-level posting services must use this key to make retries return the existing economic result instead of posting a duplicate transaction.

## Escrow

M2 creates the escrow accounting primitive before M3 introduces Contract.

`Escrow.contractId` is therefore an opaque protocol reference in M2 and intentionally has no Contract foreign key yet. A Contract foreign key should be added when the protocol-native Contract table exists.

Escrow creation requires:

- a Principal-owned buyer account;
- a posted `contract_escrow` lock transaction;
- positive IWC amount.

Escrow lifecycle is one-way:

```text
locked -> released
       \-> refunded
```

A terminal transition requires a posted ledger transaction and cannot later switch terminal outcome.
