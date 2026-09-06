import {
  buildCreditProvenance,
  ensurePrincipalLedgerAccounts,
  ensureSystemLedgerAccounts,
} from './credit-foundation.mjs';
import { postLedgerTransaction } from './ledger-posting.mjs';

export class IncentiveAwardError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'IncentiveAwardError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new IncentiveAwardError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('INCENTIVE_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

export async function awardProtocolIncentive(prisma, input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('INCENTIVE_INPUT_INVALID', 'Protocol incentive award input must be an object');
  }

  const principalId = nonEmpty(input.principalId, 'principalId');
  const programId = nonEmpty(input.programId, 'programId');
  const awardId = nonEmpty(input.awardId, 'awardId');

  const principal = await prisma.principal.findUnique({ where: { id: principalId } });
  if (!principal) {
    deny('PRINCIPAL_NOT_FOUND', 'Protocol incentive beneficiary Principal does not exist', {
      principalId,
    });
  }
  if (principal.status !== 'active') {
    deny('PRINCIPAL_INACTIVE', 'Protocol incentive beneficiary Principal must be active', {
      principalId,
      status: principal.status,
    });
  }

  const [principalAccounts, systemAccounts] = await Promise.all([
    ensurePrincipalLedgerAccounts(prisma, principalId),
    ensureSystemLedgerAccounts(prisma),
  ]);
  const referenceId = `${programId}:${awardId}`;
  const provenance = buildCreditProvenance({
    kind: 'incentive',
    beneficiaryPrincipalId: principalId,
    sourceReferenceType: 'protocol_incentive_award',
    sourceReferenceId: referenceId,
    programId,
    awardId,
  });

  return postLedgerTransaction(prisma, {
    type: 'incentive',
    referenceType: 'protocol_incentive_award',
    referenceId,
    idempotencyKey: `credit:incentive-award:${referenceId}`,
    metadata: {
      programId,
      awardId,
      beneficiaryPrincipalId: principalId,
      details: input.metadata ?? null,
    },
    entries: [
      {
        accountId: systemAccounts.system_incentive.id,
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
