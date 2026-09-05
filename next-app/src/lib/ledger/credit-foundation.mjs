import { postLedgerTransaction } from './ledger-posting.mjs';

const CREDIT_PROVENANCE_VERSION = 'iwantu-credit-provenance/0.1';
const PRINCIPAL_ACCOUNT_TYPES = [
  'principal_available',
  'principal_locked',
  'principal_pending',
];
const SYSTEM_ACCOUNT_TYPES = [
  'system_reserve',
  'system_clearing',
  'system_fee',
  'system_incentive',
];
const CREDIT_PROVENANCE_KINDS = new Set([
  'genesis',
  'purchased',
  'earned',
  'incentive',
  'refund',
]);

export class CreditFoundationError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'CreditFoundationError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new CreditFoundationError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('CREDIT_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function isPrismaUniqueConflict(error) {
  return Boolean(error && typeof error === 'object' && error.code === 'P2002');
}

async function requirePrincipal(prisma, principalId, { active = false } = {}) {
  const id = nonEmpty(principalId, 'principalId');
  const principal = await prisma.principal.findUnique({ where: { id } });
  if (!principal) {
    deny('PRINCIPAL_NOT_FOUND', 'Principal does not exist', { principalId: id });
  }
  if (active && principal.status !== 'active') {
    deny('PRINCIPAL_INACTIVE', 'Credit issuance requires an active Principal', {
      principalId: id,
      status: principal.status,
    });
  }
  return principal;
}

async function ensureLedgerAccount(prisma, { principalId, type }) {
  const where = {
    principalId: principalId ?? null,
    type,
    currency: 'IWC',
  };
  const existing = await prisma.ledgerAccount.findFirst({ where });
  if (existing) return existing;

  try {
    return await prisma.ledgerAccount.create({
      data: {
        ...(principalId ? { principalId } : {}),
        type,
        currency: 'IWC',
      },
    });
  } catch (error) {
    if (!isPrismaUniqueConflict(error)) throw error;
    const raced = await prisma.ledgerAccount.findFirst({ where });
    if (raced) return raced;
    throw error;
  }
}

export async function ensurePrincipalLedgerAccounts(prisma, principalId) {
  const principal = await requirePrincipal(prisma, principalId);
  const accounts = [];
  for (const type of PRINCIPAL_ACCOUNT_TYPES) {
    accounts.push(await ensureLedgerAccount(prisma, { principalId: principal.id, type }));
  }
  return Object.fromEntries(accounts.map((account) => [account.type, account]));
}

export async function ensureSystemLedgerAccounts(prisma) {
  const accounts = [];
  for (const type of SYSTEM_ACCOUNT_TYPES) {
    accounts.push(await ensureLedgerAccount(prisma, { principalId: null, type }));
  }
  return Object.fromEntries(accounts.map((account) => [account.type, account]));
}

export async function bootstrapPrincipalEconomicAccounts(prisma, principalId) {
  const [principalAccounts, systemAccounts] = await Promise.all([
    ensurePrincipalLedgerAccounts(prisma, principalId),
    ensureSystemLedgerAccounts(prisma),
  ]);
  return { principalAccounts, systemAccounts };
}

function optionalString(value, field) {
  if (value === undefined || value === null) return undefined;
  return nonEmpty(value, field);
}

export function buildCreditProvenance(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('CREDIT_PROVENANCE_INVALID', 'Credit provenance input must be an object');
  }

  const kind = nonEmpty(input.kind, 'kind');
  if (!CREDIT_PROVENANCE_KINDS.has(kind)) {
    deny('CREDIT_PROVENANCE_KIND_INVALID', 'Unsupported Credit provenance kind', { kind });
  }

  const beneficiaryPrincipalId = nonEmpty(input.beneficiaryPrincipalId, 'beneficiaryPrincipalId');
  const sourceReferenceType = nonEmpty(input.sourceReferenceType, 'sourceReferenceType');
  const sourceReferenceId = nonEmpty(input.sourceReferenceId, 'sourceReferenceId');

  const provenance = {
    schemaVersion: CREDIT_PROVENANCE_VERSION,
    kind,
    beneficiaryPrincipalId,
    sourceReferenceType,
    sourceReferenceId,
  };

  if (kind === 'genesis') {
    provenance.allocationVersion = nonEmpty(input.allocationVersion, 'allocationVersion');
  } else if (kind === 'purchased') {
    provenance.purchaseRef = nonEmpty(input.purchaseRef, 'purchaseRef');
  } else if (kind === 'earned') {
    provenance.contractId = nonEmpty(input.contractId, 'contractId');
    const earnedByAgentIdentityId = optionalString(
      input.earnedByAgentIdentityId,
      'earnedByAgentIdentityId',
    );
    if (earnedByAgentIdentityId) provenance.earnedByAgentIdentityId = earnedByAgentIdentityId;
  } else if (kind === 'incentive') {
    provenance.programId = nonEmpty(input.programId, 'programId');
    provenance.awardId = nonEmpty(input.awardId, 'awardId');
  } else if (kind === 'refund') {
    provenance.originalLedgerTransactionId = nonEmpty(
      input.originalLedgerTransactionId,
      'originalLedgerTransactionId',
    );
    const contractId = optionalString(input.contractId, 'contractId');
    if (contractId) provenance.contractId = contractId;
  }

  return provenance;
}

function issuanceMetadata(kind, principalId, reference, details) {
  return {
    creditSource: kind,
    beneficiaryPrincipalId: principalId,
    sourceReference: reference,
    details: details ?? null,
  };
}

export async function issueGenesisCredit(prisma, input) {
  if (!input || typeof input !== 'object') {
    deny('CREDIT_INPUT_INVALID', 'Genesis issuance input must be an object');
  }
  const principal = await requirePrincipal(prisma, input.principalId, { active: true });
  const allocationVersion = nonEmpty(input.allocationVersion ?? 'v1', 'allocationVersion');
  const { principalAccounts, systemAccounts } = await bootstrapPrincipalEconomicAccounts(
    prisma,
    principal.id,
  );
  const referenceId = `${principal.id}:${allocationVersion}`;
  const provenance = buildCreditProvenance({
    kind: 'genesis',
    beneficiaryPrincipalId: principal.id,
    sourceReferenceType: 'principal_genesis_allocation',
    sourceReferenceId: referenceId,
    allocationVersion,
  });

  return postLedgerTransaction(prisma, {
    type: 'genesis',
    referenceType: 'principal_genesis_allocation',
    referenceId,
    idempotencyKey: `credit:genesis:${referenceId}`,
    metadata: issuanceMetadata('genesis', principal.id, referenceId, input.metadata),
    entries: [
      {
        accountId: systemAccounts.system_reserve.id,
        side: 'debit',
        amount: input.amount,
      },
      {
        accountId: principalAccounts.principal_available.id,
        side: 'credit',
        amount: input.amount,
        provenance,
      },
    ],
  });
}

export async function issuePurchasedCredit(prisma, input) {
  if (!input || typeof input !== 'object') {
    deny('CREDIT_INPUT_INVALID', 'Purchased Credit issuance input must be an object');
  }
  const principal = await requirePrincipal(prisma, input.principalId, { active: true });
  const purchaseRef = nonEmpty(input.purchaseRef, 'purchaseRef');
  const { principalAccounts, systemAccounts } = await bootstrapPrincipalEconomicAccounts(
    prisma,
    principal.id,
  );
  const provenance = buildCreditProvenance({
    kind: 'purchased',
    beneficiaryPrincipalId: principal.id,
    sourceReferenceType: 'purchased_service_credit',
    sourceReferenceId: purchaseRef,
    purchaseRef,
  });

  return postLedgerTransaction(prisma, {
    type: 'purchased_credit',
    referenceType: 'purchased_service_credit',
    referenceId: purchaseRef,
    idempotencyKey: `credit:purchased:${purchaseRef}`,
    metadata: issuanceMetadata('purchased', principal.id, purchaseRef, input.metadata),
    entries: [
      {
        accountId: systemAccounts.system_reserve.id,
        side: 'debit',
        amount: input.amount,
      },
      {
        accountId: principalAccounts.principal_available.id,
        side: 'credit',
        amount: input.amount,
        provenance,
      },
    ],
  });
}

/**
 * Reserve a finite protocol incentive budget in the dedicated system account.
 * This does not award Credit to a Principal. Actual incentive awards must debit
 * this pool with an atomic no-overdraft invariant, which is intentionally left
 * to the M2-05 concurrency/integrity gate.
 */
export async function fundProtocolIncentivePool(prisma, input) {
  if (!input || typeof input !== 'object') {
    deny('CREDIT_INPUT_INVALID', 'Incentive pool funding input must be an object');
  }
  const budgetRef = nonEmpty(input.budgetRef, 'budgetRef');
  const systemAccounts = await ensureSystemLedgerAccounts(prisma);

  return postLedgerTransaction(prisma, {
    type: 'reserve',
    referenceType: 'protocol_incentive_budget',
    referenceId: budgetRef,
    idempotencyKey: `credit:incentive-pool:${budgetRef}`,
    metadata: {
      creditSource: 'protocol_incentive_pool',
      budgetRef,
      details: input.metadata ?? null,
    },
    entries: [
      {
        accountId: systemAccounts.system_reserve.id,
        side: 'debit',
        amount: input.amount,
      },
      {
        accountId: systemAccounts.system_incentive.id,
        side: 'credit',
        amount: input.amount,
      },
    ],
  });
}
