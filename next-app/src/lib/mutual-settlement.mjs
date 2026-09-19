import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as verifyDigitalSignature,
} from 'node:crypto';
import { Prisma } from '@prisma/client';
import { bindAuthorityToAuthentication } from './agent-auth-context-core.mjs';
import { resolveAuthority } from './authority/authority.mjs';
import { captureAuthoritySnapshot } from './authority/authority-snapshot.mjs';
import { buildCreditProvenance, ensurePrincipalLedgerAccounts } from './ledger/credit-foundation.mjs';
import {
  LedgerPostingError,
  postLedgerTransactionInTransaction,
} from './ledger/ledger-posting.mjs';
import {
  buildEconomicCommandEvidence,
  canonicalEconomicCommandJson,
  hashEconomicCommandEvidence,
} from './signed-economic-command.mjs';

const ACTION = 'settlement.mutual';
const MAX_COMMAND_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const SCALE = 100_000_000n;
const DECIMAL_RE = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/;

export class MutualSettlementError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'MutualSettlementError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new MutualSettlementError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('MUTUAL_SETTLEMENT_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function asDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    deny('MUTUAL_SETTLEMENT_INPUT_INVALID', `${field} must be a valid timestamp`, { field });
  }
  return date;
}

function amount(value, field) {
  const raw = typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  const match = raw.match(DECIMAL_RE);
  if (!match) {
    deny(
      'MUTUAL_SETTLEMENT_AMOUNT_INVALID',
      `${field} must be a non-negative decimal with at most 8 decimal places`,
      { field, value: raw },
    );
  }
  const units = BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(8, '0'));
  return {
    units,
    decimal: `${match[1]}.${(match[2] ?? '').padEnd(8, '0')}`,
  };
}

function canonicalHash(value) {
  return createHash('sha256')
    .update(canonicalEconomicCommandJson(value), 'utf8')
    .digest('hex');
}

export function buildMutualSettlementAgreementEvidence(input) {
  return {
    protocolVersion: 'iwantu.mutual-settlement-agreement.v0.1',
    contractId: nonEmpty(input?.contractId, 'contractId'),
    effectiveContractHash: nonEmpty(input?.effectiveContractHash, 'effectiveContractHash'),
    disputeId: nonEmpty(input?.disputeId, 'disputeId'),
    disputeHash: nonEmpty(input?.disputeHash, 'disputeHash'),
    buyerPrincipalId: nonEmpty(input?.buyerPrincipalId, 'buyerPrincipalId'),
    buyerAgentIdentityId: nonEmpty(input?.buyerAgentIdentityId, 'buyerAgentIdentityId'),
    supplierPrincipalId: nonEmpty(input?.supplierPrincipalId, 'supplierPrincipalId'),
    supplierAgentIdentityId: nonEmpty(input?.supplierAgentIdentityId, 'supplierAgentIdentityId'),
    grossAmount: amount(input?.grossAmount, 'grossAmount').decimal,
    supplierAmount: amount(input?.supplierAmount, 'supplierAmount').decimal,
    buyerRefundAmount: amount(input?.buyerRefundAmount, 'buyerRefundAmount').decimal,
    currency: nonEmpty(input?.currency, 'currency'),
  };
}

export function hashMutualSettlementAgreementEvidence(evidence) {
  return canonicalHash(buildMutualSettlementAgreementEvidence(evidence));
}

export function buildMutualSplitSettlementEvidence(input) {
  return {
    protocolVersion: 'iwantu.settlement.v0.1',
    type: 'mutual_split',
    contractId: nonEmpty(input?.contractId, 'contractId'),
    effectiveContractHash: nonEmpty(input?.effectiveContractHash, 'effectiveContractHash'),
    disputeId: nonEmpty(input?.disputeId, 'disputeId'),
    disputeHash: nonEmpty(input?.disputeHash, 'disputeHash'),
    mutualSettlementAgreementId: nonEmpty(
      input?.mutualSettlementAgreementId,
      'mutualSettlementAgreementId',
    ),
    agreementHash: nonEmpty(input?.agreementHash, 'agreementHash'),
    supplierPrincipalId: nonEmpty(input?.supplierPrincipalId, 'supplierPrincipalId'),
    supplierAgentIdentityId: nonEmpty(input?.supplierAgentIdentityId, 'supplierAgentIdentityId'),
    escrowId: nonEmpty(input?.escrowId, 'escrowId'),
    grossAmount: amount(input?.grossAmount, 'grossAmount').decimal,
    supplierAmount: amount(input?.supplierAmount, 'supplierAmount').decimal,
    buyerRefundAmount: amount(input?.buyerRefundAmount, 'buyerRefundAmount').decimal,
    currency: nonEmpty(input?.currency, 'currency'),
    ledgerTransactionId: nonEmpty(input?.ledgerTransactionId, 'ledgerTransactionId'),
    ledgerTransactionHash: nonEmpty(input?.ledgerTransactionHash, 'ledgerTransactionHash'),
  };
}

export function hashMutualSplitSettlementEvidence(evidence) {
  return canonicalHash(buildMutualSplitSettlementEvidence(evidence));
}

function assertAllocation(grossValue, supplierValue, refundValue) {
  const gross = amount(grossValue, 'grossAmount');
  const supplier = amount(supplierValue, 'supplierAmount');
  const refund = amount(refundValue, 'buyerRefundAmount');
  if (gross.units <= 0n || supplier.units <= 0n || refund.units <= 0n) {
    deny(
      'MUTUAL_SETTLEMENT_PARTIAL_SPLIT_REQUIRED',
      'MUTUAL_SPLIT requires positive Supplier and Buyer portions',
    );
  }
  if (supplier.units + refund.units !== gross.units) {
    deny('MUTUAL_SETTLEMENT_ALLOCATION_UNBALANCED', 'Supplier and Buyer portions must equal Escrow gross amount', {
      grossAmount: gross.decimal,
      supplierAmount: supplier.decimal,
      buyerRefundAmount: refund.decimal,
    });
  }
  return { gross, supplier, refund };
}

function assertCommandWindow(evidence, now) {
  const issuedAt = asDate(evidence.issuedAt, 'issuedAt');
  const expiresAt = asDate(evidence.expiresAt, 'expiresAt');
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    deny('MUTUAL_SETTLEMENT_COMMAND_WINDOW_INVALID', 'Command expiresAt must be after issuedAt');
  }
  if (expiresAt.getTime() - issuedAt.getTime() > MAX_COMMAND_TTL_MS) {
    deny('MUTUAL_SETTLEMENT_COMMAND_WINDOW_INVALID', 'Command TTL exceeds the MVP maximum');
  }
  if (issuedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    deny('MUTUAL_SETTLEMENT_COMMAND_NOT_YET_VALID', 'Command issuedAt is too far in the future');
  }
  if (expiresAt.getTime() <= now.getTime()) {
    deny('MUTUAL_SETTLEMENT_COMMAND_EXPIRED', 'Command has expired');
  }
}

async function assertLiveIdentity(tx, authentication, expectedPrincipalId, expectedAgentId, now, role) {
  if (authentication?.kind !== 'v2_agent_credential') {
    deny('MUTUAL_SETTLEMENT_V2_AUTH_REQUIRED', `${role} requires v2 AgentCredential authentication`);
  }
  if (
    authentication.principal?.id !== expectedPrincipalId
    || authentication.agent?.id !== expectedAgentId
  ) {
    deny('MUTUAL_SETTLEMENT_PARTY_MISMATCH', `${role} authentication does not match Contract party`);
  }
  const [credential, principal, agent] = await Promise.all([
    tx.agentCredential.findUnique({
      where: { id: authentication.credential?.id ?? '' },
      select: {
        id: true,
        agentIdentityId: true,
        kind: true,
        status: true,
        keyId: true,
        validFrom: true,
        expiresAt: true,
      },
    }),
    tx.principal.findUnique({
      where: { id: expectedPrincipalId },
      select: { id: true, status: true },
    }),
    tx.agentIdentity.findUnique({
      where: { id: expectedAgentId },
      select: { id: true, principalId: true, status: true },
    }),
  ]);
  if (
    !credential
    || credential.kind !== 'api'
    || credential.status !== 'active'
    || credential.keyId !== authentication.credential.keyId
    || credential.agentIdentityId !== expectedAgentId
    || credential.validFrom.getTime() > now.getTime()
    || (credential.expiresAt && credential.expiresAt.getTime() <= now.getTime())
  ) {
    deny('MUTUAL_SETTLEMENT_ACCESS_CREDENTIAL_NOT_LIVE', `${role} access credential is not live`);
  }
  if (!principal || principal.status !== 'active') {
    deny('MUTUAL_SETTLEMENT_PRINCIPAL_NOT_ACTIVE', `${role} Principal is not active`);
  }
  if (!agent || agent.status !== 'active' || agent.principalId !== expectedPrincipalId) {
    deny('MUTUAL_SETTLEMENT_AGENT_NOT_ACTIVE', `${role} AgentIdentity is not active`);
  }
}

async function loadSigningCredential(tx, authentication, command, now, role) {
  const credential = await tx.agentCredential.findUnique({
    where: { keyId: command.signingKeyId },
    select: {
      id: true,
      agentIdentityId: true,
      kind: true,
      status: true,
      keyId: true,
      publicKeyJwk: true,
      algorithm: true,
      validFrom: true,
      expiresAt: true,
    },
  });
  if (!credential) deny('MUTUAL_SETTLEMENT_SIGNING_KEY_NOT_FOUND', `${role} signing credential does not exist`);
  if (credential.kind !== 'signing' || credential.agentIdentityId !== authentication.agent.id) {
    deny('MUTUAL_SETTLEMENT_SIGNING_KEY_INVALID', `${role} signing credential is not owned by authenticated Agent`);
  }
  if (
    credential.status !== 'active'
    || credential.validFrom.getTime() > now.getTime()
    || (credential.expiresAt && credential.expiresAt.getTime() <= now.getTime())
  ) {
    deny('MUTUAL_SETTLEMENT_SIGNING_KEY_INACTIVE', `${role} signing credential is not live`);
  }
  if (command.signatureAlgorithm !== 'EdDSA' || credential.algorithm !== 'EdDSA') {
    deny('MUTUAL_SETTLEMENT_SIGNATURE_ALGORITHM_UNSUPPORTED', 'Mutual settlement supports EdDSA only');
  }
  if (!credential.publicKeyJwk || typeof credential.publicKeyJwk !== 'object') {
    deny('MUTUAL_SETTLEMENT_PUBLIC_KEY_MISSING', `${role} signing credential has no verification key`);
  }
  return credential;
}

function verifySignature(commandHash, credential, signature, role) {
  const value = nonEmpty(signature, `${role}Signature`);
  let publicKey;
  let bytes;
  try {
    publicKey = createPublicKey({ key: credential.publicKeyJwk, format: 'jwk' });
    bytes = Buffer.from(value, 'base64url');
  } catch (error) {
    deny('MUTUAL_SETTLEMENT_SIGNATURE_MALFORMED', `${role} signature material is malformed`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!bytes.length || !verifyDigitalSignature(null, Buffer.from(commandHash, 'hex'), publicKey, bytes)) {
    deny('MUTUAL_SETTLEMENT_SIGNATURE_INVALID', `${role} economic signature verification failed`);
  }
}

async function authorizeParty(
  tx,
  authentication,
  partyInput,
  agreementHash,
  expectedPrincipalId,
  expectedAgentId,
  counterpartyPrincipalId,
  now,
  role,
) {
  await assertLiveIdentity(tx, authentication, expectedPrincipalId, expectedAgentId, now, role);
  const command = buildEconomicCommandEvidence({
    action: ACTION,
    principalId: expectedPrincipalId,
    agentIdentityId: expectedAgentId,
    mandateId: partyInput?.mandateId,
    payloadHash: agreementHash,
    nonce: partyInput?.nonce,
    issuedAt: partyInput?.commandIssuedAt,
    expiresAt: partyInput?.commandExpiresAt,
    signingKeyId: partyInput?.signingKeyId,
    signatureAlgorithm: partyInput?.signatureAlgorithm,
  });
  assertCommandWindow(command, now);
  const commandHash = hashEconomicCommandEvidence(command);
  const signingCredential = await loadSigningCredential(tx, authentication, command, now, role);
  verifySignature(commandHash, signingCredential, partyInput?.signature, role);

  const authority = await resolveAuthority(tx, {
    mandateId: command.mandateId,
    subjectAgentIdentityId: expectedAgentId,
    action: ACTION,
    at: now,
    counterpartyPrincipalId,
  });
  const bound = bindAuthorityToAuthentication(authentication, authority);
  const snapshot = await captureAuthoritySnapshot(
    tx,
    bound,
    {
      action: ACTION,
      counterpartyPrincipalId,
      commandHash,
      payloadHash: agreementHash,
      nonce: command.nonce,
      signingCredentialId: signingCredential.id,
      signingKeyId: signingCredential.keyId,
      signatureAlgorithm: command.signatureAlgorithm,
    },
    now,
  );

  return { command, commandHash, signingCredential, snapshot };
}

function isUniqueConflict(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'P2002');
}

function isSerializationFailure(error) {
  if (error && typeof error === 'object' && error.code === 'P2034') return true;
  const diagnostic = `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`;
  return /could not serialize access|serialization|sqlstate.?40001|\b40001\b|concurrent update/i.test(diagnostic);
}

async function one(tx, query) {
  const rows = await tx.$queryRaw(query);
  return rows[0] ?? null;
}

async function performMutualSplit(
  tx,
  buyerAuthentication,
  supplierAuthentication,
  input,
  accounts,
  now,
) {
  const contract = await one(
    tx,
    Prisma.sql`SELECT * FROM "contracts" WHERE "id" = ${input.contractId} FOR UPDATE`,
  );
  if (!contract) deny('MUTUAL_SETTLEMENT_CONTRACT_NOT_FOUND', 'Contract does not exist');

  const existingSettlement = await one(
    tx,
    Prisma.sql`SELECT * FROM "settlements" WHERE "contractId" = ${contract.id}`,
  );
  if (existingSettlement) {
    if (existingSettlement.idempotencyKey !== input.idempotencyKey) {
      deny('MUTUAL_SETTLEMENT_TERMINAL_CONFLICT', 'Contract already has a different terminal Settlement');
    }
    const agreement = await one(
      tx,
      Prisma.sql`
        SELECT * FROM "mutual_settlement_agreements"
        WHERE "id" = ${existingSettlement.mutualSettlementAgreementId}
      `,
    );
    return { agreement, settlement: existingSettlement, replayed: true };
  }

  if (contract.lifecycleState !== 'disputed') {
    deny('MUTUAL_SETTLEMENT_REQUIRES_DISPUTED_CONTRACT', 'Mutual settlement requires DISPUTED Contract', {
      lifecycleState: contract.lifecycleState,
    });
  }

  const dispute = await one(
    tx,
    Prisma.sql`SELECT * FROM "disputes" WHERE "contractId" = ${contract.id}`,
  );
  if (!dispute) deny('MUTUAL_SETTLEMENT_DISPUTE_REQUIRED', 'Contract has no immutable Dispute fact');

  const escrow = await one(
    tx,
    Prisma.sql`
      SELECT e.*, e."amount"::text AS "amountText"
      FROM "escrows" e
      WHERE e."id" = ${contract.escrowId} AND e."contractId" = ${contract.id}
      FOR UPDATE
    `,
  );
  if (!escrow || escrow.status !== 'locked') {
    deny('MUTUAL_SETTLEMENT_REQUIRES_LOCKED_ESCROW', 'Mutual settlement requires locked Contract Escrow');
  }

  const allocation = assertAllocation(
    escrow.amountText,
    input.supplierAmount,
    input.buyerRefundAmount,
  );
  if (escrow.currency !== 'IWC') {
    deny('MUTUAL_SETTLEMENT_CURRENCY_INVALID', 'MVP mutual settlement supports IWC only');
  }

  const agreementEvidence = buildMutualSettlementAgreementEvidence({
    contractId: contract.id,
    effectiveContractHash: contract.effectiveContractHash,
    disputeId: dispute.id,
    disputeHash: dispute.disputeHash,
    buyerPrincipalId: contract.buyerPrincipalId,
    buyerAgentIdentityId: contract.buyerAgentIdentityId,
    supplierPrincipalId: contract.supplierPrincipalId,
    supplierAgentIdentityId: contract.supplierAgentIdentityId,
    grossAmount: allocation.gross.decimal,
    supplierAmount: allocation.supplier.decimal,
    buyerRefundAmount: allocation.refund.decimal,
    currency: escrow.currency,
  });
  const agreementHash = hashMutualSettlementAgreementEvidence(agreementEvidence);

  const buyerAuthz = await authorizeParty(
    tx,
    buyerAuthentication,
    input.buyer,
    agreementHash,
    contract.buyerPrincipalId,
    contract.buyerAgentIdentityId,
    contract.supplierPrincipalId,
    now,
    'buyer',
  );
  const supplierAuthz = await authorizeParty(
    tx,
    supplierAuthentication,
    input.supplier,
    agreementHash,
    contract.supplierPrincipalId,
    contract.supplierAgentIdentityId,
    contract.buyerPrincipalId,
    now,
    'supplier',
  );

  const agreementId = `mutual_agreement_${randomUUID()}`;
  const agreementRows = await tx.$queryRaw(
    Prisma.sql`
      INSERT INTO "mutual_settlement_agreements" (
        "id", "idempotencyKey", "contractId", "effectiveContractHash",
        "disputeId", "disputeHash", "buyerPrincipalId", "buyerAgentIdentityId",
        "supplierPrincipalId", "supplierAgentIdentityId", "grossAmount",
        "supplierAmount", "buyerRefundAmount", "currency", "agreementHash",
        "buyerAuthoritySnapshotId", "supplierAuthoritySnapshotId",
        "buyerCommandHash", "supplierCommandHash", "buyerNonce", "supplierNonce",
        "buyerSigningKeyId", "supplierSigningKeyId", "buyerSignature",
        "supplierSignature", "agreedAt"
      ) VALUES (
        ${agreementId}, ${input.idempotencyKey}, ${contract.id},
        ${contract.effectiveContractHash}, ${dispute.id}, ${dispute.disputeHash},
        ${contract.buyerPrincipalId}, ${contract.buyerAgentIdentityId},
        ${contract.supplierPrincipalId}, ${contract.supplierAgentIdentityId},
        ${allocation.gross.decimal}::DECIMAL(36,8),
        ${allocation.supplier.decimal}::DECIMAL(36,8),
        ${allocation.refund.decimal}::DECIMAL(36,8), ${escrow.currency},
        ${agreementHash}, ${buyerAuthz.snapshot.id}, ${supplierAuthz.snapshot.id},
        ${buyerAuthz.commandHash}, ${supplierAuthz.commandHash},
        ${buyerAuthz.command.nonce}, ${supplierAuthz.command.nonce},
        ${buyerAuthz.signingCredential.keyId}, ${supplierAuthz.signingCredential.keyId},
        ${nonEmpty(input.buyer?.signature, 'buyer.signature')},
        ${nonEmpty(input.supplier?.signature, 'supplier.signature')}, ${now}
      )
      RETURNING *
    `,
  );
  const agreement = agreementRows[0];

  const supplierProvenance = buildCreditProvenance({
    kind: 'earned',
    beneficiaryPrincipalId: contract.supplierPrincipalId,
    sourceReferenceType: 'escrow_mutual_split',
    sourceReferenceId: contract.id,
    contractId: contract.id,
    earnedByAgentIdentityId: contract.supplierAgentIdentityId,
  });
  const buyerRefundProvenance = buildCreditProvenance({
    kind: 'refund',
    beneficiaryPrincipalId: contract.buyerPrincipalId,
    sourceReferenceType: 'escrow_mutual_split',
    sourceReferenceId: contract.id,
    originalLedgerTransactionId: escrow.lockLedgerTransactionId,
    contractId: contract.id,
  });

  let ledgerTransaction;
  try {
    ledgerTransaction = await postLedgerTransactionInTransaction(tx, {
      type: 'settlement',
      referenceType: 'escrow_mutual_split',
      referenceId: contract.id,
      idempotencyKey: `escrow:mutual_split:${contract.id}`,
      metadata: {
        escrowAction: 'mutual_split',
        contractId: contract.id,
        disputeId: dispute.id,
        mutualSettlementAgreementId: agreement.id,
        agreementHash,
        settlementProtocol: 'iwantu.settlement.v0.1',
      },
      entries: [
        {
          accountId: accounts.buyer.principal_locked.id,
          side: 'debit',
          amount: allocation.gross.decimal,
        },
        {
          accountId: accounts.supplier.principal_available.id,
          side: 'credit',
          amount: allocation.supplier.decimal,
          provenance: supplierProvenance,
        },
        {
          accountId: accounts.buyer.principal_available.id,
          side: 'credit',
          amount: allocation.refund.decimal,
          provenance: buyerRefundProvenance,
        },
      ],
    });
  } catch (error) {
    if (error instanceof LedgerPostingError) {
      deny('MUTUAL_SETTLEMENT_LEDGER_FAILED', 'Mutual split Ledger posting failed', {
        ledgerCode: error.code,
        ledgerDetails: error.details,
      });
    }
    throw error;
  }
  if (!ledgerTransaction.transactionHash) {
    deny('MUTUAL_SETTLEMENT_LEDGER_HASH_MISSING', 'Posted mutual split transaction has no hash');
  }

  const settlementEvidence = buildMutualSplitSettlementEvidence({
    contractId: contract.id,
    effectiveContractHash: contract.effectiveContractHash,
    disputeId: dispute.id,
    disputeHash: dispute.disputeHash,
    mutualSettlementAgreementId: agreement.id,
    agreementHash,
    supplierPrincipalId: contract.supplierPrincipalId,
    supplierAgentIdentityId: contract.supplierAgentIdentityId,
    escrowId: escrow.id,
    grossAmount: allocation.gross.decimal,
    supplierAmount: allocation.supplier.decimal,
    buyerRefundAmount: allocation.refund.decimal,
    currency: escrow.currency,
    ledgerTransactionId: ledgerTransaction.id,
    ledgerTransactionHash: ledgerTransaction.transactionHash,
  });
  const settlementHash = hashMutualSplitSettlementEvidence(settlementEvidence);
  const settlementId = `settlement_${randomUUID()}`;
  const allocationJson = {
    currency: escrow.currency,
    grossAmount: allocation.gross.decimal,
    supplierAmount: allocation.supplier.decimal,
    buyerRefundAmount: allocation.refund.decimal,
  };

  await tx.$executeRaw(
    Prisma.sql`
      INSERT INTO "settlements" (
        "id", "idempotencyKey", "contractId", "effectiveContractHash",
        "supplierPrincipalId", "supplierAgentIdentityId", "escrowId", "type",
        "ledgerTransactionId", "allocation", "settlementHash",
        "disputeId", "mutualSettlementAgreementId"
      ) VALUES (
        ${settlementId}, ${input.idempotencyKey}, ${contract.id},
        ${contract.effectiveContractHash}, ${contract.supplierPrincipalId},
        ${contract.supplierAgentIdentityId}, ${escrow.id}, 'mutual_split',
        ${ledgerTransaction.id}, ${JSON.stringify(allocationJson)}::jsonb,
        ${settlementHash}, ${dispute.id}, ${agreement.id}
      )
    `,
  );

  const settledAt = new Date();
  await tx.$executeRaw(
    Prisma.sql`
      UPDATE "escrows"
      SET "status" = 'released'::"EscrowStatus",
          "releaseLedgerTransactionId" = ${ledgerTransaction.id},
          "releasedAt" = ${settledAt}
      WHERE "id" = ${escrow.id}
    `,
  );
  await tx.$executeRaw(
    Prisma.sql`
      UPDATE "contracts"
      SET "lifecycleState" = 'closed'::"ContractLifecycleState",
          "closedAt" = ${settledAt}
      WHERE "id" = ${contract.id}
    `,
  );

  const settlement = await one(
    tx,
    Prisma.sql`SELECT * FROM "settlements" WHERE "id" = ${settlementId}`,
  );
  return {
    agreement,
    settlement,
    ledgerTransaction,
    dispute,
    replayed: false,
  };
}

export async function settleMutualSplit(
  prisma,
  buyerAuthentication,
  supplierAuthentication,
  input,
  options = {},
) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('MUTUAL_SETTLEMENT_CLIENT_INVALID', 'settleMutualSplit requires PrismaClient');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('MUTUAL_SETTLEMENT_INPUT_INVALID', 'Mutual settlement input must be an object');
  }

  const normalized = {
    ...input,
    contractId: nonEmpty(input.contractId, 'contractId'),
    idempotencyKey: nonEmpty(input.idempotencyKey, 'idempotencyKey'),
  };
  const now = asDate(options.now ?? new Date(), 'now');

  const contractRows = await prisma.$queryRaw(
    Prisma.sql`
      SELECT "buyerPrincipalId", "supplierPrincipalId"
      FROM "contracts"
      WHERE "id" = ${normalized.contractId}
    `,
  );
  const binding = contractRows[0];
  if (!binding) {
    deny('MUTUAL_SETTLEMENT_CONTRACT_NOT_FOUND', 'Contract does not exist');
  }

  const [buyerAccounts, supplierAccounts] = await Promise.all([
    ensurePrincipalLedgerAccounts(prisma, binding.buyerPrincipalId),
    ensurePrincipalLedgerAccounts(prisma, binding.supplierPrincipalId),
  ]);
  const accounts = { buyer: buyerAccounts, supplier: supplierAccounts };
  const maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0
    ? options.maxRetries
    : 3;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => performMutualSplit(
          tx,
          buyerAuthentication,
          supplierAuthentication,
          normalized,
          accounts,
          now,
        ),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof MutualSettlementError) throw error;
      if ((isSerializationFailure(error) || isUniqueConflict(error)) && attempt < maxRetries) {
        continue;
      }
      if (isSerializationFailure(error)) {
        deny(
          'MUTUAL_SETTLEMENT_CONCURRENCY_RETRY_EXHAUSTED',
          'Mutual settlement concurrency retries exhausted',
        );
      }
      if (isUniqueConflict(error)) {
        deny(
          'MUTUAL_SETTLEMENT_REPLAY_OR_CONFLICT',
          'Mutual settlement collided with existing immutable protocol evidence',
        );
      }
      throw error;
    }
  }

  deny('MUTUAL_SETTLEMENT_FAILED', 'Mutual settlement failed unexpectedly');
}
