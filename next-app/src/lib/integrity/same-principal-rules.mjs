import { Prisma } from '@prisma/client';

import {
  INTEGRITY_RULE_CODES,
  IntegritySignalError,
  emitIntegritySignal,
} from './integrity-signal.mjs';

export const SAME_PRINCIPAL_RULE_VERSIONS = Object.freeze({
  R1: 'iwantu.integrity-rule.r1/0.1',
  R2: 'iwantu.integrity-rule.r2/0.1',
});

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IntegritySignalError('INTEGRITY_RULE_INPUT_INVALID', field + ' must be a non-empty string', { field });
  }
  return value.trim();
}

export function classifySamePrincipalRelationship(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new IntegritySignalError('INTEGRITY_RULE_INPUT_INVALID', 'Relationship facts must be an object');
  }
  const buyerPrincipalId = nonEmpty(input.buyerPrincipalId, 'buyerPrincipalId');
  const supplierPrincipalId = nonEmpty(input.supplierPrincipalId, 'supplierPrincipalId');
  const buyerAgentIdentityId = nonEmpty(input.buyerAgentIdentityId, 'buyerAgentIdentityId');
  const supplierAgentIdentityId = nonEmpty(input.supplierAgentIdentityId, 'supplierAgentIdentityId');
  if (buyerPrincipalId !== supplierPrincipalId) return null;
  if (buyerAgentIdentityId === supplierAgentIdentityId) {
    return { ruleCode: INTEGRITY_RULE_CODES.SELF_TRADING, ruleVersion: SAME_PRINCIPAL_RULE_VERSIONS.R1, scope: 'agent', subjectPrincipalId: buyerPrincipalId, subjectAgentIdentityId: buyerAgentIdentityId, signalClass: 'relationship', relationshipType: 'same_agent_self_trading' };
  }
  return { ruleCode: INTEGRITY_RULE_CODES.SAME_PRINCIPAL_TRADING, ruleVersion: SAME_PRINCIPAL_RULE_VERSIONS.R2, scope: 'principal', subjectPrincipalId: buyerPrincipalId, subjectAgentIdentityId: null, signalClass: 'relationship', relationshipType: 'same_principal_distinct_agents' };
}

function buildSignalInput(settlement) {
  const classification = classifySamePrincipalRelationship(settlement);
  if (!classification) return null;
  return {
    ...classification,
    evidence: {
      relationshipType: classification.relationshipType,
      contractId: settlement.contractId,
      settlementId: settlement.settlementId,
      settlementHash: settlement.settlementHash,
      settlementType: settlement.settlementType,
      buyerPrincipalId: settlement.buyerPrincipalId,
      buyerAgentIdentityId: settlement.buyerAgentIdentityId,
      supplierPrincipalId: settlement.supplierPrincipalId,
      supplierAgentIdentityId: settlement.supplierAgentIdentityId,
    },
    metrics: {
      samePrincipal: true,
      sameAgent: settlement.buyerAgentIdentityId === settlement.supplierAgentIdentityId,
      independentGlobalTrustEligible: false,
      terminalSettlementCount: 1,
    },
    basisStart: settlement.activatedAt,
    basisEnd: settlement.settlementCreatedAt,
    observedAt: settlement.settlementCreatedAt,
  };
}

async function settlementFacts(prisma, settlementId) {
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT s."id" AS "settlementId", s."contractId" AS "contractId", s."settlementHash" AS "settlementHash",
      s."type"::text AS "settlementType", s."createdAt" AS "settlementCreatedAt", c."activatedAt" AS "activatedAt",
      c."buyerPrincipalId" AS "buyerPrincipalId", c."buyerAgentIdentityId" AS "buyerAgentIdentityId",
      c."supplierPrincipalId" AS "supplierPrincipalId", c."supplierAgentIdentityId" AS "supplierAgentIdentityId"
    FROM "settlements" s JOIN "contracts" c ON c."id" = s."contractId"
    WHERE s."id" = ${settlementId} LIMIT 1
  `);
  return rows[0] ?? null;
}

export async function evaluateSamePrincipalSettlement(prisma, input) {
  const settlementId = nonEmpty(input?.settlementId, 'settlementId');
  const facts = await settlementFacts(prisma, settlementId);
  if (!facts) throw new IntegritySignalError('INTEGRITY_RULE_SETTLEMENT_NOT_FOUND', 'Terminal Settlement does not exist', { settlementId });
  const signalInput = buildSignalInput(facts);
  if (!signalInput) return { matched: false, ruleCode: null, signal: null };
  const signal = await emitIntegritySignal(prisma, signalInput);
  return { matched: true, ruleCode: signalInput.ruleCode, signal };
}

export async function scanSamePrincipalSettlementSignals(prisma, { limit = 100 } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
    throw new IntegritySignalError('INTEGRITY_RULE_INPUT_INVALID', 'limit must be an integer from 1 to 1000', { field: 'limit' });
  }
  const settlements = await prisma.$queryRaw(Prisma.sql`
    SELECT s."id" FROM "settlements" s JOIN "contracts" c ON c."id" = s."contractId"
    WHERE c."buyerPrincipalId" = c."supplierPrincipalId"
    ORDER BY s."createdAt", s."id" LIMIT ${limit}
  `);
  const results = [];
  for (const row of settlements) results.push(await evaluateSamePrincipalSettlement(prisma, { settlementId: row.id }));
  return results;
}
