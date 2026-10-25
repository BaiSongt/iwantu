// R8-P1n 只读历史激励覆盖：扫描 POSTED 奖励、奖池借方、Credit provenance 及显式来源元数据。
// 不依赖 R8 的 500 条观察样本，亦不把可归类账本事实等同于治理、签名或预算授权。
export const INCENTIVE_POSTED_BUDGET_COVERAGE_DRAFT_VERSION =
  'iwantu.incentive-posted-budget-coverage/0.4';

export class IncentivePostedBudgetCoverageDraftError extends Error {
  constructor(field, reason) {
    super(`${field}: ${reason}`);
    this.name = 'IncentivePostedBudgetCoverageDraftError';
    this.code = 'INCENTIVE_POSTED_BUDGET_COVERAGE_DRAFT_FAILED';
    this.field = field;
  }
}

const deny = (field, reason) => {
  throw new IncentivePostedBudgetCoverageDraftError(field, reason);
};

const SCALE = 100_000_000n;
const DECIMAL = /^(0|[1-9][0-9]{0,27})(?:\.([0-9]{1,8}))?$/;

function parseAmount(value, field) {
  if (typeof value !== 'string') deny(field, 'requires a PostgreSQL numeric string');
  const match = DECIMAL.exec(value);
  if (!match) deny(field, 'requires non-negative Decimal(36,8) without exponent or rounding');
  return BigInt(match[1]) * SCALE + BigInt((match[2] ?? '').padEnd(8, '0'));
}

function formatAmount(units) {
  return `${units / SCALE}.${(units % SCALE).toString().padStart(8, '0')}`;
}

function parseCount(value, field) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    deny(field, 'requires an exact non-negative SQL COUNT text value');
  }
  return BigInt(value);
}

function programIdFrom(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).length !== 1 || !Object.hasOwn(input, 'programId')) {
    deny('input', 'requires a plain object containing only programId');
  }
  if (typeof input.programId !== 'string' ||
      !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.programId)) {
    deny('programId', 'requires the canonical Program identifier');
  }
  return input.programId;
}

// 这是一条 SQL 语句内的全量聚合，不依赖时间窗、Principal 过滤或 LIMIT。
// 一旦发现无法归属的 POSTED incentive 或任意已记账的奖池借方异常，整个预算预检拒绝。
// 禁止将结果作为金额写入时的可重复读保证；正式发奖仍须取得 M2 全局 Ledger 锁。
export async function inspectPostedIncentiveBudgetCoverageDraft(prisma, input) {
  const programId = programIdFrom(input);
  if (!prisma || typeof prisma.$queryRaw !== 'function') {
    deny('prisma', 'requires an available read-only Prisma query client');
  }

  const rows = await prisma.$queryRaw`
    WITH candidates AS (
      SELECT t."id", t."type", t."referenceType", t."referenceId",
        t."idempotencyKey", t."transactionHash", t."postedAt", t."metadata",
        t."metadata" ->> 'programId' AS "programId",
        t."metadata" ->> 'awardId' AS "awardId",
        t."metadata" ->> 'beneficiaryPrincipalId' AS "beneficiaryPrincipalId",
        p."entryCount", p."poolDebitCount", p."poolValidCount",
        p."incentiveProvenanceCreditCount",
        p."poolDebitAmount", p."matchedCreditCount", p."matchedCreditAmount"
      FROM "ledger_transactions" t
      CROSS JOIN LATERAL (
        SELECT COUNT(e."id") AS "entryCount",
          COUNT(e."id") FILTER (
            WHERE e."side" = 'debit' AND a."type" = 'system_incentive'
          ) AS "poolDebitCount",
          -- 非 incentive 类型也可能冒用奖励来源；不可把这类已记账信用排除在审计范围外。
          COUNT(e."id") FILTER (
            WHERE e."side" = 'credit' AND (
              e."provenance" ->> 'kind' = 'incentive' OR
              e."provenance" ->> 'sourceReferenceType' = 'protocol_incentive_award'
            )
          ) AS "incentiveProvenanceCreditCount",
          COUNT(e."id") FILTER (
            WHERE e."entryIndex" = 0 AND e."side" = 'debit'
              AND a."type" = 'system_incentive' AND a."principalId" IS NULL
              AND a."currency" = 'IWC'
          ) AS "poolValidCount",
          COALESCE(SUM(e."amount") FILTER (
            WHERE e."side" = 'debit' AND a."type" = 'system_incentive'
          ), 0) AS "poolDebitAmount",
          COUNT(e."id") FILTER (
            WHERE e."entryIndex" = 1 AND e."side" = 'credit'
              AND a."type" = 'principal_available' AND a."currency" = 'IWC'
              AND a."principalId" = t."metadata" ->> 'beneficiaryPrincipalId'
              AND e."provenance" ->> 'schemaVersion' = 'iwantu-credit-provenance/0.1'
              AND e."provenance" ->> 'kind' = 'incentive'
              AND e."provenance" ->> 'beneficiaryPrincipalId' = a."principalId"
              AND e."provenance" ->> 'sourceReferenceType' = t."referenceType"
              AND e."provenance" ->> 'sourceReferenceId' = t."referenceId"
              AND e."provenance" ->> 'programId' = t."metadata" ->> 'programId'
              AND e."provenance" ->> 'awardId' = t."metadata" ->> 'awardId'
              -- Credit provenance v0.1 必须严格匹配固定字段集，拒绝夹带的伪造授权字段。
              AND e."provenance" = jsonb_build_object(
                'schemaVersion', 'iwantu-credit-provenance/0.1',
                'kind', 'incentive',
                'beneficiaryPrincipalId', a."principalId",
                'sourceReferenceType', t."referenceType",
                'sourceReferenceId', t."referenceId",
                'programId', t."metadata" ->> 'programId',
                'awardId', t."metadata" ->> 'awardId'
              )
          ) AS "matchedCreditCount",
          COALESCE(SUM(e."amount") FILTER (
            WHERE e."entryIndex" = 1 AND e."side" = 'credit'
              AND a."type" = 'principal_available' AND a."currency" = 'IWC'
              AND a."principalId" = t."metadata" ->> 'beneficiaryPrincipalId'
              AND e."provenance" ->> 'schemaVersion' = 'iwantu-credit-provenance/0.1'
              AND e."provenance" ->> 'kind' = 'incentive'
              AND e."provenance" ->> 'beneficiaryPrincipalId' = a."principalId"
              AND e."provenance" ->> 'sourceReferenceType' = t."referenceType"
              AND e."provenance" ->> 'sourceReferenceId' = t."referenceId"
              AND e."provenance" ->> 'programId' = t."metadata" ->> 'programId'
              AND e."provenance" ->> 'awardId' = t."metadata" ->> 'awardId'
              -- Credit provenance v0.1 必须严格匹配固定字段集，拒绝夹带的伪造授权字段。
              AND e."provenance" = jsonb_build_object(
                'schemaVersion', 'iwantu-credit-provenance/0.1',
                'kind', 'incentive',
                'beneficiaryPrincipalId', a."principalId",
                'sourceReferenceType', t."referenceType",
                'sourceReferenceId', t."referenceId",
                'programId', t."metadata" ->> 'programId',
                'awardId', t."metadata" ->> 'awardId'
              )
          ), 0) AS "matchedCreditAmount"
        FROM "ledger_entries" e
        JOIN "ledger_accounts" a ON a."id" = e."accountId"
        WHERE e."transactionId" = t."id"
      ) p
      WHERE t."status" = 'posted'
        AND (t."type" = 'incentive' OR t."referenceType" = 'protocol_incentive_award'
          -- 元数据自称激励来源却未使用标准奖励分录，也必须进入未分类审计。
          OR t."metadata" ->> 'creditSource' = 'incentive'
          OR p."poolDebitCount" > 0 OR p."incentiveProvenanceCreditCount" > 0)
    ), classified AS (
      SELECT c.*,
        (
          c."type" = 'incentive'
          AND c."referenceType" = 'protocol_incentive_award'
          AND c."transactionHash" ~ '^[0-9a-f]{64}$'
          AND c."postedAt" IS NOT NULL
          AND jsonb_typeof(c."metadata" -> 'programId') = 'string'
          AND jsonb_typeof(c."metadata" -> 'awardId') = 'string'
          AND jsonb_typeof(c."metadata" -> 'beneficiaryPrincipalId') = 'string'
          -- 拒绝旧 M2 未限制的分隔符：a:b:c 不可反推出唯一 Program/Award 二元组。
          AND c."programId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
          AND c."awardId" ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'
          AND c."beneficiaryPrincipalId" <> ''
          AND c."beneficiaryPrincipalId" = BTRIM(c."beneficiaryPrincipalId")
          AND c."referenceId" = c."programId" || ':' || c."awardId"
          AND c."idempotencyKey" = 'credit:incentive-award:' || c."referenceId"
          AND c."entryCount" = 2
          AND c."poolDebitCount" = 1 AND c."poolValidCount" = 1
          AND c."matchedCreditCount" = 1
          AND c."incentiveProvenanceCreditCount" = 1
          AND c."poolDebitAmount" > 0
          AND c."matchedCreditAmount" = c."poolDebitAmount"
        ) AS "recognized"
      FROM candidates c
    )
    SELECT COUNT(*)::text AS "postedCandidateCount",
      COUNT(*) FILTER (WHERE "recognized")::text AS "recognizedAwardCount",
      COUNT(*) FILTER (WHERE NOT COALESCE("recognized", FALSE))::text AS "unclassifiedCandidateCount",
      COALESCE(SUM("poolDebitAmount"), 0)::text AS "allPoolDebitIwc",
      COALESCE(SUM("poolDebitAmount") FILTER (
        WHERE "recognized" AND "programId" = ${programId}
      ), 0)::text AS "programPostedSpendIwc"
    FROM classified
  `;

  if (!Array.isArray(rows) || rows.length !== 1 || !rows[0] ||
      Object.getPrototypeOf(rows[0]) !== Object.prototype) {
    deny('rows', 'requires exactly one complete aggregate result');
  }
  const row = rows[0];
  const posted = parseCount(row.postedCandidateCount, 'postedCandidateCount');
  const recognized = parseCount(row.recognizedAwardCount, 'recognizedAwardCount');
  const unclassified = parseCount(row.unclassifiedCandidateCount, 'unclassifiedCandidateCount');
  const allPool = parseAmount(row.allPoolDebitIwc, 'allPoolDebitIwc');
  const programSpend = parseAmount(row.programPostedSpendIwc, 'programPostedSpendIwc');
  if (recognized > posted || unclassified > posted || recognized + unclassified !== posted ||
      programSpend > allPool) {
    deny('rows', 'inconsistent aggregate counts or monetary coverage');
  }
  if (unclassified > 0n) {
    deny('unclassifiedCandidateCount',
      'posted incentive or pool outflow lacks trustworthy structural attribution; audit required');
  }

  // 即使分类全部吻合，也无法证明历史触发因果关系或当前 Program 的正式授权预算。
  return {
    protocol: INCENTIVE_POSTED_BUDGET_COVERAGE_DRAFT_VERSION,
    programId,
    postedCandidateCount: posted.toString(),
    recognizedAwardCount: recognized.toString(),
    unclassifiedCandidateCount: '0',
    allPoolDebitIwc: formatAmount(allPool),
    programPostedSpendIwc: formatAmount(programSpend),
    auditStatus: 'no_unclassified_posted_candidates_in_query_snapshot',
    budgetAuthorityStatus: 'not_checked',
    programGovernanceStatus: 'not_checked',
    immutableTriggerAttributionStatus: 'unavailable',
    queryFreshnessStatus: 'single_read_only_statement_not_ledger_locked',
    economicWritePermitted: false,
    r8RiskEvaluationEligible: false,
    automaticPunishmentApplied: false,
  };
}
