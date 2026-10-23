import { validateIncentiveTriggerBindingDraft } from './incentive-trigger-binding-draft.mjs';

// R8-B2 前置只读门禁：只证明候选收据与数据库中的奖励/结算事实一致。
// 冻结政策、授权真伪、奖励触发因果及不可变收据持久化均尚未验证，不得据此生成 R8 信号。
export class IncentiveTriggerSourceInspectionError extends Error {
  constructor(reason) {
    super(reason);
    this.name = 'IncentiveTriggerSourceInspectionError';
    this.code = 'INCENTIVE_TRIGGER_SOURCE_INSPECTION_FAILED';
  }
}

function deny(reason) {
  throw new IncentiveTriggerSourceInspectionError(reason);
}

export async function inspectIncentiveTriggerSourceFacts(prisma, draft) {
  const { evidence, receiptHash } = validateIncentiveTriggerBindingDraft(draft);
  if (!prisma || typeof prisma.$queryRaw !== 'function') {
    deny('a read-only Prisma query client is required');
  }

  // 使用 Prisma 标签模板参数绑定，禁止把主体验证值拼接进 SQL 字符串。
  // 精确匹配两条标准分录，避免只找到部分账本事实时错误接受候选绑定。
  const rows = await prisma.$queryRaw`
    SELECT t."id" AS "ledgerTransactionId",
      t."transactionHash" AS "awardTransactionHash",
      t."postedAt" AS "awardPostedAt",
      s."id" AS "settlementId",
      s."settlementHash" AS "settlementHash",
      s."createdAt" AS "settlementCreatedAt",
      e."amount"::text AS "amountIwc"
    FROM "ledger_transactions" t
    JOIN "ledger_entries" e ON e."transactionId" = t."id" AND e."entryIndex" = 1
    JOIN "ledger_accounts" beneficiary ON beneficiary."id" = e."accountId"
    JOIN "ledger_entries" d ON d."transactionId" = t."id" AND d."entryIndex" = 0
    JOIN "ledger_accounts" pool ON pool."id" = d."accountId"
    JOIN "settlements" s ON s."id" = ${evidence.settlementId}
    WHERE t."id" = ${evidence.awardLedgerTransactionId}
      AND t."type" = 'incentive'
      AND t."status" = 'posted'
      AND t."referenceType" = 'protocol_incentive_award'
      AND t."referenceId" = ${`${evidence.programId}:${evidence.awardId}`}
      AND t."idempotencyKey" = ${`credit:incentive-award:${evidence.programId}:${evidence.awardId}`}
      AND t."transactionHash" = ${evidence.awardTransactionHash}
      AND t."metadata" ->> 'programId' = ${evidence.programId}
      AND t."metadata" ->> 'awardId' = ${evidence.awardId}
      AND t."metadata" ->> 'beneficiaryPrincipalId' = ${evidence.beneficiaryPrincipalId}
      AND t."postedAt" IS NOT NULL
      AND s."settlementHash" = ${evidence.settlementHash}
      AND s."type" IN ('full_settlement', 'full_refund', 'mutual_split')
      AND s."createdAt" <= t."postedAt"
      AND e."side" = 'credit' AND d."side" = 'debit'
      AND e."amount" = d."amount"
      AND e."amount" = CAST(${evidence.amountIwc} AS numeric(36,8))
      AND beneficiary."type" = 'principal_available'
      AND beneficiary."principalId" = ${evidence.beneficiaryPrincipalId}
      AND beneficiary."currency" = 'IWC'
      AND pool."type" = 'system_incentive'
      AND pool."principalId" IS NULL
      AND pool."currency" = 'IWC'
      AND e."provenance" ->> 'schemaVersion' = 'iwantu-credit-provenance/0.1'
      AND e."provenance" ->> 'kind' = 'incentive'
      AND e."provenance" ->> 'beneficiaryPrincipalId' = ${evidence.beneficiaryPrincipalId}
      AND e."provenance" ->> 'sourceReferenceType' = t."referenceType"
      AND e."provenance" ->> 'sourceReferenceId' = t."referenceId"
      AND e."provenance" ->> 'programId' = ${evidence.programId}
      AND e."provenance" ->> 'awardId' = ${evidence.awardId}
      AND (SELECT COUNT(*) FROM "ledger_entries" all_entries
           WHERE all_entries."transactionId" = t."id") = 2
    LIMIT 2
  `;

  if (!Array.isArray(rows) || rows.length !== 1) {
    deny('award and terminal settlement immutable source facts do not match');
  }
  const row = rows[0];
  if (row?.ledgerTransactionId !== evidence.awardLedgerTransactionId ||
      row?.awardTransactionHash !== evidence.awardTransactionHash ||
      row?.settlementId !== evidence.settlementId ||
      row?.settlementHash !== evidence.settlementHash ||
      row?.amountIwc !== evidence.amountIwc ||
      !(row?.awardPostedAt instanceof Date) ||
      !(row?.settlementCreatedAt instanceof Date) ||
      !Number.isFinite(row.awardPostedAt.getTime()) ||
      !Number.isFinite(row.settlementCreatedAt.getTime()) ||
      row.settlementCreatedAt > row.awardPostedAt) {
    deny('query returned malformed, inconsistent or temporally invalid source facts');
  }

  return {
    receiptHash,
    sourceFactConsistency: 'matched',
    ledgerTransactionId: evidence.awardLedgerTransactionId,
    settlementId: evidence.settlementId,
    // 政策快照和授权收据尚未被不可变数据源验证，绝不提升为 verified。
    attributionStatus: 'unavailable',
    policyAuthorizationVerified: false,
    bindingReceiptPersisted: false,
    r8RiskEvaluationEligible: false,
    automaticPunishmentApplied: false,
  };
}
