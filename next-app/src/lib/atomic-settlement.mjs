import { createHash, randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { buildCreditProvenance, ensurePrincipalLedgerAccounts } from './ledger/credit-foundation.mjs';
import { LedgerPostingError, postLedgerTransactionInTransaction } from './ledger/ledger-posting.mjs';

export class AtomicSettlementError extends Error {
  constructor(code, message, details = undefined) {
    super(message); this.name = 'AtomicSettlementError'; this.code = code; this.details = details;
  }
}
function deny(code, message, details) { throw new AtomicSettlementError(code, message, details); }
function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) deny('SETTLEMENT_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  return value.trim();
}
function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.keys(value).sort().reduce((out, key) => { out[key] = canonicalize(value[key]); return out; }, {});
  return value;
}
export function buildSettlementEvidence(input) {
  return canonicalize({
    protocol: 'iwantu.settlement.v0.1', type: 'full_settlement',
    contractId: nonEmpty(input.contractId, 'contractId'), effectiveContractHash: nonEmpty(input.effectiveContractHash, 'effectiveContractHash'),
    deliveryId: nonEmpty(input.deliveryId, 'deliveryId'), deliveryHash: nonEmpty(input.deliveryHash, 'deliveryHash'),
    acceptanceDecisionId: nonEmpty(input.acceptanceDecisionId, 'acceptanceDecisionId'), acceptanceDecisionHash: nonEmpty(input.acceptanceDecisionHash, 'acceptanceDecisionHash'),
    acceptanceSource: nonEmpty(input.acceptanceSource, 'acceptanceSource'), supplierPrincipalId: nonEmpty(input.supplierPrincipalId, 'supplierPrincipalId'),
    supplierAgentIdentityId: nonEmpty(input.supplierAgentIdentityId, 'supplierAgentIdentityId'), escrowId: nonEmpty(input.escrowId, 'escrowId'),
    amount: nonEmpty(String(input.amount), 'amount'), currency: nonEmpty(input.currency, 'currency'),
    ledgerTransactionId: nonEmpty(input.ledgerTransactionId, 'ledgerTransactionId'), ledgerTransactionHash: nonEmpty(input.ledgerTransactionHash, 'ledgerTransactionHash'),
  });
}
export function hashSettlementEvidence(evidence) { return createHash('sha256').update(JSON.stringify(canonicalize(evidence)), 'utf8').digest('hex'); }
function isPrismaCode(error, code) { return Boolean(error && typeof error === 'object' && error.code === code); }
function isSerializationFailure(error) {
  if (isPrismaCode(error, 'P2034')) return true;
  if (!isPrismaCode(error, 'P2010')) return false;
  return /serialization|could not serialize|sqlstate.?40001|\b40001\b|concurrent update/i.test(`${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`);
}
async function one(tx, query) { const rows = await tx.$queryRaw(query); return rows[0] ?? null; }
async function loadContractForUpdate(tx, id) { return one(tx, Prisma.sql`SELECT * FROM "contracts" WHERE "id" = ${id} FOR UPDATE`); }
async function loadExistingSettlement(tx, id) { return one(tx, Prisma.sql`SELECT * FROM "settlements" WHERE "contractId" = ${id}`); }
async function loadLatestDelivery(tx, id) { return one(tx, Prisma.sql`SELECT * FROM "deliveries" WHERE "contractId" = ${id} ORDER BY "sequence" DESC LIMIT 1`); }
async function loadAcceptanceDecision(tx, contractId, deliveryId) { return one(tx, Prisma.sql`SELECT * FROM "delivery_acceptance_decisions" WHERE "contractId" = ${contractId} AND "deliveryId" = ${deliveryId} LIMIT 1`); }
async function loadEscrowForUpdate(tx, escrowId, contractId) {
  return one(tx, Prisma.sql`SELECT e.*, e."amount"::text AS "amountText", a."principalId" AS "buyerPrincipalId" FROM "escrows" e JOIN "ledger_accounts" a ON a."id" = e."buyerAccountId" WHERE e."id" = ${escrowId} AND e."contractId" = ${contractId} FOR UPDATE OF e`);
}
async function loadBuyerLockedAccount(tx, principalId) {
  return one(tx, Prisma.sql`SELECT * FROM "ledger_accounts" WHERE "principalId" = ${principalId} AND "type" = 'principal_locked'::"LedgerAccountType" AND "currency" = 'IWC' LIMIT 1`);
}
function assertExistingSettlement(existing, input) {
  if (existing.idempotencyKey !== input.idempotencyKey) deny('SETTLEMENT_IDEMPOTENCY_CONFLICT', 'Contract already has a different terminal Settlement', { contractId: input.contractId, settlementId: existing.id });
}
function releasePostingInput({ contract, escrow, lockedAccount, supplierAvailableAccount, acceptance }) {
  const provenance = buildCreditProvenance({ kind: 'earned', beneficiaryPrincipalId: contract.supplierPrincipalId, sourceReferenceType: 'escrow_release', sourceReferenceId: contract.id, contractId: contract.id, earnedByAgentIdentityId: contract.supplierAgentIdentityId });
  return {
    type: 'settlement', referenceType: 'escrow_release', referenceId: contract.id, idempotencyKey: `escrow:release:${contract.id}`,
    metadata: { escrowAction: 'release', contractId: contract.id, deliveryId: acceptance.deliveryId, acceptanceDecisionId: acceptance.id, acceptanceSource: acceptance.source, settlementProtocol: 'iwantu.settlement.v0.1' },
    entries: [
      { accountId: lockedAccount.id, side: 'debit', amount: escrow.amountText },
      { accountId: supplierAvailableAccount.id, side: 'credit', amount: escrow.amountText, provenance },
    ],
  };
}
async function performSettlement(tx, input, supplierAvailableAccount) {
  const contract = await loadContractForUpdate(tx, input.contractId);
  if (!contract) deny('SETTLEMENT_CONTRACT_NOT_FOUND', 'Contract does not exist', { contractId: input.contractId });
  const existing = await loadExistingSettlement(tx, input.contractId);
  if (existing) { assertExistingSettlement(existing, input); return { settlement: existing, replayed: true }; }
  if (contract.lifecycleState !== 'acceptance_pending') deny('SETTLEMENT_REQUIRES_ACCEPTANCE_PENDING', 'Settlement requires ACCEPTANCE_PENDING Contract', { contractId: contract.id, lifecycleState: contract.lifecycleState });
  if (!contract.escrowId) deny('SETTLEMENT_ESCROW_NOT_BOUND', 'Contract does not have bound Escrow', { contractId: contract.id });

  const delivery = await loadLatestDelivery(tx, contract.id);
  if (!delivery || delivery.effectiveContractHash !== contract.effectiveContractHash) deny('SETTLEMENT_DELIVERY_BINDING_INVALID', 'Latest Delivery does not bind current Contract hash', { contractId: contract.id });
  const acceptance = await loadAcceptanceDecision(tx, contract.id, delivery.id);
  if (!acceptance || acceptance.decision !== 'accept') deny('SETTLEMENT_ACCEPTANCE_REQUIRED', 'Terminal Settlement requires ACCEPT or AUTO_ACCEPT evidence', { contractId: contract.id, deliveryId: delivery.id });
  if (acceptance.effectiveContractHash !== contract.effectiveContractHash || acceptance.deliveryHash !== delivery.deliveryHash) deny('SETTLEMENT_ACCEPTANCE_BINDING_INVALID', 'Acceptance evidence does not bind latest Delivery', { contractId: contract.id, deliveryId: delivery.id, acceptanceDecisionId: acceptance.id });

  const escrow = await loadEscrowForUpdate(tx, contract.escrowId, contract.id);
  if (!escrow || escrow.status !== 'locked') deny('SETTLEMENT_REQUIRES_LOCKED_ESCROW', 'Settlement requires Contract Escrow to be locked', { contractId: contract.id, escrowId: contract.escrowId, escrowStatus: escrow?.status });
  // Settlement resolves an obligation already formed by the Contract. Revocation or suspension
  // blocks new commitments, but must not erase or strand an accepted contractual obligation.
  const lockedAccount = await loadBuyerLockedAccount(tx, escrow.buyerPrincipalId);
  if (!lockedAccount) deny('SETTLEMENT_LOCKED_ACCOUNT_MISSING', 'Buyer locked account is missing', { buyerPrincipalId: escrow.buyerPrincipalId });

  let ledgerTransaction;
  try {
    ledgerTransaction = await postLedgerTransactionInTransaction(tx, releasePostingInput({ contract, escrow, lockedAccount, supplierAvailableAccount, acceptance }));
  } catch (error) {
    if (error instanceof LedgerPostingError) deny('SETTLEMENT_LEDGER_POST_FAILED', 'Settlement ledger posting failed', { ledgerCode: error.code, ledgerDetails: error.details });
    throw error;
  }
  if (!ledgerTransaction.transactionHash) deny('SETTLEMENT_LEDGER_HASH_MISSING', 'Posted settlement ledger transaction has no hash');

  const evidence = buildSettlementEvidence({ contractId: contract.id, effectiveContractHash: contract.effectiveContractHash, deliveryId: delivery.id, deliveryHash: delivery.deliveryHash, acceptanceDecisionId: acceptance.id, acceptanceDecisionHash: acceptance.decisionHash, acceptanceSource: acceptance.source, supplierPrincipalId: contract.supplierPrincipalId, supplierAgentIdentityId: contract.supplierAgentIdentityId, escrowId: escrow.id, amount: escrow.amountText, currency: escrow.currency, ledgerTransactionId: ledgerTransaction.id, ledgerTransactionHash: ledgerTransaction.transactionHash });
  const settlementHash = hashSettlementEvidence(evidence);
  const settlementId = `settlement_${randomUUID()}`;
  const allocation = { currency: escrow.currency, grossAmount: escrow.amountText, supplierAmount: escrow.amountText, buyerRefundAmount: '0' };
  await tx.$executeRaw(Prisma.sql`INSERT INTO "settlements" ("id", "idempotencyKey", "contractId", "deliveryId", "acceptanceDecisionId", "effectiveContractHash", "supplierPrincipalId", "supplierAgentIdentityId", "escrowId", "type", "ledgerTransactionId", "allocation", "settlementHash") VALUES (${settlementId}, ${input.idempotencyKey}, ${contract.id}, ${delivery.id}, ${acceptance.id}, ${contract.effectiveContractHash}, ${contract.supplierPrincipalId}, ${contract.supplierAgentIdentityId}, ${escrow.id}, 'full_settlement', ${ledgerTransaction.id}, ${JSON.stringify(allocation)}::jsonb, ${settlementHash})`);
  const settledAt = new Date();
  await tx.$executeRaw(Prisma.sql`UPDATE "escrows" SET "status" = 'released'::"EscrowStatus", "releaseLedgerTransactionId" = ${ledgerTransaction.id}, "releasedAt" = ${settledAt} WHERE "id" = ${escrow.id}`);
  await tx.$executeRaw(Prisma.sql`UPDATE "contracts" SET "lifecycleState" = 'closed'::"ContractLifecycleState", "closedAt" = ${settledAt} WHERE "id" = ${contract.id}`);
  return { settlement: await loadExistingSettlement(tx, contract.id), ledgerTransaction, replayed: false };
}
export async function settleAcceptedDelivery(prisma, input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) deny('SETTLEMENT_INPUT_INVALID', 'Settlement input must be an object');
  const normalized = { contractId: nonEmpty(input.contractId, 'contractId'), idempotencyKey: nonEmpty(input.idempotencyKey, 'idempotencyKey') };
  const contractRows = await prisma.$queryRaw(Prisma.sql`SELECT "supplierPrincipalId" FROM "contracts" WHERE "id" = ${normalized.contractId}`);
  const supplierPrincipalId = contractRows[0]?.supplierPrincipalId;
  if (!supplierPrincipalId) deny('SETTLEMENT_CONTRACT_NOT_FOUND', 'Contract does not exist', { contractId: normalized.contractId });
  // Accounts belong to the Principal, which remains the contractual responsibility and asset root
  // even when the acting Agent or its Mandate is later suspended/revoked.
  const supplierAccounts = await ensurePrincipalLedgerAccounts(prisma, supplierPrincipalId);
  const supplierAvailableAccount = supplierAccounts.principal_available;
  const maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0 ? options.maxRetries : 3;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await prisma.$transaction((tx) => performSettlement(tx, normalized, supplierAvailableAccount), { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof AtomicSettlementError) throw error;
      if (isSerializationFailure(error) && attempt < maxRetries) continue;
      if (isSerializationFailure(error)) deny('SETTLEMENT_CONCURRENCY_RETRY_EXHAUSTED', 'Settlement concurrency retries exhausted', { contractId: normalized.contractId });
      throw error;
    }
  }
  deny('SETTLEMENT_FAILED', 'Settlement failed unexpectedly', { contractId: normalized.contractId });
}
