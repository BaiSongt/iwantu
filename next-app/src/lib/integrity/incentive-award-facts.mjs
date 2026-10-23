import { Prisma } from '@prisma/client';
import { IntegritySignalError } from './integrity-signal.mjs';

export const INCENTIVE_AWARD_PROVENANCE_VERSION = 'iwantu-credit-provenance/0.1';
export const INCENTIVE_AWARD_FACTS_VERSION = 'iwantu.integrity-r8-award-facts/0.1';
export const MAX_INCENTIVE_AWARD_FACTS = 500;

function invalid(field, reason) {
  throw new IntegritySignalError('INTEGRITY_INCENTIVE_FACT_INVALID', `${field}: ${reason}`, { field });
}

function normalizeInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('input', 'must be an object');
  if (!Array.isArray(input.principalIds) || input.principalIds.length < 1 || input.principalIds.length > 20) {
    invalid('principalIds', 'must contain 1 to 20 Principal IDs');
  }
  const principalIds = input.principalIds.map((id, index) => {
    if (typeof id !== 'string' || id.trim().length === 0 || id !== id.trim()) {
      invalid(`principalIds[${index}]`, 'must be a canonical non-empty string');
    }
    return id;
  });
  if (new Set(principalIds).size !== principalIds.length) invalid('principalIds', 'must be distinct');
  const { windowStart, windowEnd } = input;
  if (!(windowStart instanceof Date) || !Number.isFinite(windowStart.getTime()) ||
      !(windowEnd instanceof Date) || !Number.isFinite(windowEnd.getTime()) ||
      windowStart >= windowEnd) {
    invalid('window', 'must contain ordered valid Dates');
  }
  const limit = input.limit ?? MAX_INCENTIVE_AWARD_FACTS;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INCENTIVE_AWARD_FACTS) {
    invalid('limit', `must be 1 to ${MAX_INCENTIVE_AWARD_FACTS}`);
  }
  return { principalIds: [...principalIds].sort(), windowStart, windowEnd, limit };
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim()) {
    invalid(field, 'must be a canonical non-empty string');
  }
  return value;
}

function requireAmount(value) {
  const amount = String(value ?? '');
  if (!/^\d+(?:\.\d{1,8})?$/.test(amount) || /^0+(?:\.0+)?$/.test(amount)) {
    invalid('amount', 'must be a positive IWC decimal with at most 8 fractional digits');
  }
  return amount;
}

// R8 第一阶段只读协议激励事实：不对激励领取行为作舞弊判断。
// 区间采用 [windowStart, windowEnd)；超过上限拒绝不完整结果，避免部分样本产生风险信号。
export async function readIncentiveAwardFacts(prisma, input) {
  const { principalIds, windowStart, windowEnd, limit } = normalizeInput(input);
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT a."principalId" AS "principalId",
      t."metadata" ->> 'programId' AS "programId",
      t."metadata" ->> 'awardId' AS "awardId",
      t."referenceId" AS "referenceId",
      t."transactionHash" AS "transactionHash",
      t."postedAt" AS "postedAt",
      e."amount"::text AS "amount"
    FROM "ledger_transactions" t
    JOIN "ledger_entries" e ON e."transactionId" = t."id"
    JOIN "ledger_accounts" a ON a."id" = e."accountId"
    WHERE t."type" = 'incentive'
      AND t."status" = 'posted'
      AND t."referenceType" = 'protocol_incentive_award'
      AND t."transactionHash" IS NOT NULL
      AND t."postedAt" >= CAST(${windowStart} AS timestamp(3))
      AND t."postedAt" < CAST(${windowEnd} AS timestamp(3))
      AND e."side" = 'credit'
      AND a."type" = 'principal_available'
      AND a."currency" = 'IWC'
      AND a."principalId" IN (${Prisma.join(principalIds)})
      AND e."provenance" ->> 'schemaVersion' = ${INCENTIVE_AWARD_PROVENANCE_VERSION}
      AND e."provenance" ->> 'kind' = 'incentive'
      AND e."provenance" ->> 'beneficiaryPrincipalId' = a."principalId"
      AND e."provenance" ->> 'sourceReferenceType' = t."referenceType"
      AND e."provenance" ->> 'sourceReferenceId' = t."referenceId"
      AND e."provenance" ->> 'programId' = t."metadata" ->> 'programId'
      AND e."provenance" ->> 'awardId' = t."metadata" ->> 'awardId'
      AND t."metadata" ->> 'beneficiaryPrincipalId' = a."principalId"
      AND t."referenceId" = (t."metadata" ->> 'programId') || ':' || (t."metadata" ->> 'awardId')
      AND EXISTS (
        SELECT 1 FROM "ledger_entries" d
        JOIN "ledger_accounts" pool ON pool."id" = d."accountId"
        WHERE d."transactionId" = t."id"
          AND d."side" = 'debit'
          AND d."amount" = e."amount"
          AND pool."type" = 'system_incentive'
          AND pool."currency" = 'IWC'
          AND pool."principalId" IS NULL
      )
    ORDER BY t."postedAt" ASC, t."transactionHash" ASC, a."principalId" ASC
    LIMIT ${limit + 1}
  `);
  if (!Array.isArray(rows) || rows.length > limit) {
    invalid('rows', 'result exceeds bounded evidence window');
  }
  const seenHashes = new Set();
  const records = rows.map((row) => {
    const principalId = requireText(row?.principalId, 'principalId');
    if (!principalIds.includes(principalId)) invalid('principalId', 'out of requested scope');
    const programId = requireText(row?.programId, 'programId');
    const awardId = requireText(row?.awardId, 'awardId');
    const referenceId = requireText(row?.referenceId, 'referenceId');
    if (referenceId !== `${programId}:${awardId}`) invalid('referenceId', 'does not bind program and award');
    const transactionHash = requireText(row?.transactionHash, 'transactionHash');
    if (!/^[0-9a-f]{64}$/.test(transactionHash) || seenHashes.has(transactionHash)) {
      invalid('transactionHash', 'must be unique lowercase SHA-256');
    }
    seenHashes.add(transactionHash);
    const postedAt = row?.postedAt;
    if (!(postedAt instanceof Date) || !Number.isFinite(postedAt.getTime()) ||
        postedAt < windowStart || postedAt >= windowEnd) invalid('postedAt', 'outside observation window');
    return { principalId, programId, awardId, referenceId, transactionHash,
      postedAt, amount: requireAmount(row.amount) };
  });
  records.sort((a, b) => a.postedAt - b.postedAt ||
    a.transactionHash.localeCompare(b.transactionHash) || a.principalId.localeCompare(b.principalId));
  return {
    factsVersion: INCENTIVE_AWARD_FACTS_VERSION,
    provenanceVersion: INCENTIVE_AWARD_PROVENANCE_VERSION,
    sourceFactLayers: ['ledger_transactions', 'ledger_entries', 'ledger_accounts'],
    observationWindow: { start: windowStart, endExclusive: windowEnd },
    principalIds,
    records,
    automaticPunishmentApplied: false,
    capitalLineageTraced: false,
  };
}
