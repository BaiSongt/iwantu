import { Prisma } from '@prisma/client';
import { IntegritySignalError } from './integrity-signal.mjs';

export const GENESIS_ISSUANCE_PROVENANCE_VERSION = 'iwantu-credit-provenance/0.1';

function fail(field, reason) {
  throw new IntegritySignalError('INTEGRITY_GENESIS_FACT_INPUT_INVALID', field + ': ' + reason, { field });
}

function normalizeInput(input) {
  if (!input || !Array.isArray(input.principalIds) || input.principalIds.length !== 3) {
    fail('principalIds', 'must contain exactly three Principals');
  }
  const principalIds = input.principalIds.map((value, i) => {
    if (typeof value !== 'string' || value.trim().length === 0) fail('principalIds[' + i + ']', 'must be non-empty');
    return value.trim();
  });
  if (new Set(principalIds).size !== 3) fail('principalIds', 'must be distinct');
  const before = input.before;
  if (!(before instanceof Date) || !Number.isFinite(before.getTime())) fail('before', 'must be a valid Date');
  return { principalIds: principalIds.sort(), before };
}

/**
 * 读取真实、已入账的 Genesis 发行事实。
 * 只证明 Principal 在指定时点前收到过 Genesis IWC；不证明某笔 Settlement 使用了这些 IWC。
 */
export async function readGenesisIssuanceFacts(prisma, input) {
  const { principalIds, before } = normalizeInput(input);
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT a."principalId",
      count(*)::integer AS "issuanceCount",
      COALESCE(sum(e."amount"), 0)::text AS "issuedAmount",
      array_agg(t."transactionHash" ORDER BY t."transactionHash") AS "transactionHashes"
    FROM "ledger_entries" e
    JOIN "ledger_transactions" t ON t."id" = e."transactionId"
    JOIN "ledger_accounts" a ON a."id" = e."accountId"
    WHERE t."type" = 'genesis'
      AND t."status" = 'posted'
      AND t."referenceType" = 'principal_genesis_allocation'
      AND t."transactionHash" IS NOT NULL
      AND t."postedAt" < CAST(${before} AS timestamp(3))
      AND e."side" = 'credit'
      AND a."type" = 'principal_available'
      AND a."currency" = 'IWC'
      AND a."principalId" IN (${Prisma.join(principalIds)})
      AND e."provenance" ->> 'schemaVersion' = ${GENESIS_ISSUANCE_PROVENANCE_VERSION}
      AND e."provenance" ->> 'kind' = 'genesis'
      AND NULLIF(e."provenance" ->> 'allocationVersion', '') IS NOT NULL
      AND e."provenance" ->> 'beneficiaryPrincipalId' = a."principalId"
      AND e."provenance" ->> 'sourceReferenceType' = t."referenceType"
      AND e."provenance" ->> 'sourceReferenceId' = t."referenceId"
      -- M2 Genesis 的双方凭证必须相互绑定：发行事务元数据、主体及分配版本一致。
      AND t."metadata" ->> 'creditSource' = 'genesis'
      AND t."metadata" ->> 'beneficiaryPrincipalId' = a."principalId"
      AND t."metadata" ->> 'sourceReference' = t."referenceId"
      AND t."referenceId" = a."principalId" || ':' || (e."provenance" ->> 'allocationVersion')
    GROUP BY a."principalId"
    ORDER BY a."principalId"
  `);
  const byPrincipal = new Map();
  for (const row of rows) {
    if (!principalIds.includes(row.principalId) || byPrincipal.has(row.principalId)) {
      throw new IntegritySignalError('INTEGRITY_GENESIS_FACT_INVALID', 'Unexpected Genesis issuance subject');
    }
    if (!Number.isSafeInteger(row.issuanceCount) || row.issuanceCount < 1) {
      throw new IntegritySignalError('INTEGRITY_GENESIS_FACT_INVALID', 'Invalid Genesis issuance count');
    }
    const amount = String(row.issuedAmount);
    if (!/^\d+(?:\.\d{1,8})?$/.test(amount) || /^0+(?:\.0+)?$/.test(amount)) {
      throw new IntegritySignalError('INTEGRITY_GENESIS_FACT_INVALID', 'Invalid Genesis issued amount');
    }
    // 绑定已入账交易哈希，避免仅凭相同合计数额复用无法追溯的发行证据。
    const transactionHashes = row.transactionHashes;
    if (!Array.isArray(transactionHashes) || transactionHashes.length !== row.issuanceCount ||
        transactionHashes.some((hash, index) => typeof hash !== 'string' ||
          !/^[0-9a-f]{64}$/.test(hash) ||
          (index > 0 && transactionHashes[index - 1] >= hash))) {
      throw new IntegritySignalError('INTEGRITY_GENESIS_FACT_INVALID', 'Genesis transaction hashes are invalid or not canonical');
    }
    byPrincipal.set(row.principalId, {
      principalId: row.principalId, issuanceCount: row.issuanceCount,
      issuedAmount: amount, transactionHashes: [...transactionHashes],
    });
  }
  return {
    sourceFactLayer: ['ledger_transactions', 'ledger_entries', 'ledger_accounts'],
    provenanceVersion: GENESIS_ISSUANCE_PROVENANCE_VERSION,
    capitalLineageTraced: false,
    before,
    principals: principalIds.map((id) => byPrincipal.get(id) ?? {
      principalId: id, issuanceCount: 0, issuedAmount: '0.00000000', transactionHashes: [],
    }),
  };
}
