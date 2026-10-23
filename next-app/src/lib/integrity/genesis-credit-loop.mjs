import { Prisma } from '@prisma/client';

import {
  INTEGRITY_RULE_CODES,
  IntegritySignalError,
  emitIntegritySignal,
} from './integrity-signal.mjs';
import { classifyCircularFlow, CIRCULAR_FLOW_POLICY } from './circular-flow.mjs';
import {
  GENESIS_ISSUANCE_PROVENANCE_VERSION,
  readGenesisIssuanceFacts,
} from './genesis-issuance-facts.mjs';

export const GENESIS_CREDIT_LOOP_RULE_VERSION = 'iwantu.integrity-rule.r7/0.1';

/**
 * R7 是 Genesis 受益主体参与闭环交易的信号，不证明具体结算 IWC 的资金来源。
 * 复用 R5 的闭环阈值，防止两个风险规则发生口径漂移。
 */
export const GENESIS_CREDIT_LOOP_POLICY = Object.freeze({
  ...CIRCULAR_FLOW_POLICY,
  minGenesisPrincipals: 1,
  minGenesisIssuedAmount: '1.00000000',
});

const SCALE = 100000000n;

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new IntegritySignalError('INTEGRITY_RULE_INPUT_INVALID', field + ' must be a non-empty string', { field });
  }
  return value.trim();
}

function count(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', field + ' must be a non-negative integer', { field });
  }
  return value;
}

function units(value, field) {
  const text = String(value ?? '').trim();
  if (!/^\d+(?:\.\d{1,8})?$/.test(text)) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', field + ' must be a non-negative decimal with at most 8 fractional digits', { field });
  }
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * SCALE + BigInt(fraction.padEnd(8, '0'));
}

function amountText(value) {
  return `${value / SCALE}.${String(value % SCALE).padStart(8, '0')}`;
}

function canonicalPrincipals(values) {
  if (!Array.isArray(values) || values.length !== 3) {
    throw new IntegritySignalError('INTEGRITY_RULE_INPUT_INVALID', 'R7 requires exactly three Principals');
  }
  const ids = values.map((id, index) => nonEmpty(id, 'principalIds[' + index + ']'));
  if (new Set(ids).size !== 3) {
    throw new IntegritySignalError('INTEGRITY_RULE_INPUT_INVALID', 'R7 requires three distinct Principals');
  }
  return [...ids].sort();
}

function normalizePolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new IntegritySignalError('INTEGRITY_RULE_POLICY_INVALID', 'R7 policy must be an object');
  }
  const minGenesisPrincipals = count(policy.minGenesisPrincipals, 'minGenesisPrincipals');
  const minGenesisIssuedAmount = units(policy.minGenesisIssuedAmount, 'minGenesisIssuedAmount');
  if (minGenesisPrincipals < 1 || minGenesisPrincipals > 3 || minGenesisIssuedAmount === 0n) {
    throw new IntegritySignalError('INTEGRITY_RULE_POLICY_INVALID', 'R7 Genesis issuance thresholds are inconsistent');
  }
  return {
    minEdgeSettlements: policy.minEdgeSettlements,
    minTotalSettlements: policy.minTotalSettlements,
    minGrossAmount: policy.minGrossAmount,
    minEdgeShareBps: policy.minEdgeShareBps,
    minGenesisPrincipals,
    minGenesisIssuedAmount: amountText(minGenesisIssuedAmount),
  };
}

function directedCycle(input) {
  const ids = [
    nonEmpty(input?.principalAId, 'principalAId'),
    nonEmpty(input?.principalBId, 'principalBId'),
    nonEmpty(input?.principalCId, 'principalCId'),
  ];
  canonicalPrincipals(ids);
  // 仅进行有向循环旋转；反向交易环属于另一组独立证据。
  const start = ids.indexOf([...ids].sort()[0]);
  return [ids[start], ids[(start + 1) % 3], ids[(start + 2) % 3]];
}

function normalizedCycleFacts(facts) {
  const ids = [facts.principalAId, facts.principalBId, facts.principalCId];
  const [a, b, c] = directedCycle(facts);
  const start = ids.indexOf(a);
  const rows = [
    { count: facts.aToBSettlementCount, amount: facts.aToBAmount },
    { count: facts.bToCSettlementCount, amount: facts.bToCAmount },
    { count: facts.cToASettlementCount, amount: facts.cToAAmount },
  ];
  const first = rows[start];
  const second = rows[(start + 1) % 3];
  const third = rows[(start + 2) % 3];
  return {
    ...facts, principalAId: a, principalBId: b, principalCId: c,
    aToBSettlementCount: first.count, aToBAmount: first.amount,
    bToCSettlementCount: second.count, bToCAmount: second.amount,
    cToASettlementCount: third.count, cToAAmount: third.amount,
  };
}

/**
 * 精确的已 POSTED Genesis 发放历史 + 真实终结结算环是唯一的 R7 v0.1 观察口径。
 * 任何历史发放额都不能用于推算某笔 Settlement 的 Genesis 来源比例。
 */
export function classifyGenesisCreditLoop(facts, genesisIssuance, policy = GENESIS_CREDIT_LOOP_POLICY) {
  if (!facts || typeof facts !== 'object' || Array.isArray(facts)) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', 'R7 cycle facts must be an object');
  }
  const p = normalizePolicy(policy);
  const normalized = normalizedCycleFacts(facts);
  const circle = classifyCircularFlow(normalized, {
    minEdgeSettlements: p.minEdgeSettlements,
    minTotalSettlements: p.minTotalSettlements,
    minGrossAmount: p.minGrossAmount,
    minEdgeShareBps: p.minEdgeShareBps,
  });
  if (!circle) return null;
  if (!(facts.basisStart instanceof Date) || !Number.isFinite(facts.basisStart.getTime()) ||
      !(facts.basisEnd instanceof Date) || !Number.isFinite(facts.basisEnd.getTime()) ||
      facts.basisStart > facts.basisEnd) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', 'Matched R7 requires a valid Settlement evidence window');
  }
  if (!genesisIssuance || !(genesisIssuance.before instanceof Date) ||
      genesisIssuance.before.getTime() !== facts.basisStart.getTime() ||
      genesisIssuance.capitalLineageTraced !== false ||
      !Array.isArray(genesisIssuance.principals) || genesisIssuance.principals.length !== 3) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', 'R7 requires prior Genesis ledger facts without inferred capital lineage');
  }
  // 纯分类入口同样校验来源协议，避免把其他类型的 Credit 发放伪装为 Genesis。
  const expectedLayers = ['ledger_transactions', 'ledger_entries', 'ledger_accounts'];
  if (genesisIssuance.provenanceVersion !== GENESIS_ISSUANCE_PROVENANCE_VERSION ||
      !Array.isArray(genesisIssuance.sourceFactLayer) ||
      genesisIssuance.sourceFactLayer.length !== expectedLayers.length ||
      expectedLayers.some((layer, index) => genesisIssuance.sourceFactLayer[index] !== layer)) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID',
      'R7 requires canonical Genesis issuance source provenance');
  }
  const issuance = genesisIssuance.principals.map((row) => {
    const principalId = nonEmpty(row?.principalId, 'genesisPrincipalId');
    const issuanceCount = count(row.issuanceCount, 'genesisIssuanceCount');
    const issuedAmount = units(row.issuedAmount, 'genesisIssuedAmount');
    if ((issuanceCount === 0) !== (issuedAmount === 0n)) {
      throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', 'Genesis issuance count and amount disagree');
    }
    // 保留且校验每笔已 POSTED Genesis 的不可变哈希，避免同额不同源混同。
    const transactionHashes = row.transactionHashes;
    if (!Array.isArray(transactionHashes) || transactionHashes.length !== issuanceCount ||
        transactionHashes.some((hash, index) => typeof hash !== 'string' ||
          !/^[0-9a-f]{64}$/.test(hash) ||
          (index > 0 && transactionHashes[index - 1] >= hash))) {
      throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', 'Genesis transaction hashes are invalid');
    }
    return { principalId, issuanceCount, issuedAmount: amountText(issuedAmount), transactionHashes: [...transactionHashes] };
  }).sort((a, b) => a.principalId < b.principalId ? -1 : a.principalId > b.principalId ? 1 : 0);
  if (issuance.some((row, index) => row.principalId !== circle.principalIds[index])) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', 'R7 issuance subjects must match the Settlement cycle');
  }
  const genesisPrincipalCount = issuance.filter((row) => row.issuanceCount > 0).length;
  const genesisIssuedAmount = issuance.reduce(
    (sum, row) => sum + units(row.issuedAmount, 'genesisIssuedAmount'), 0n,
  );
  if (genesisPrincipalCount < p.minGenesisPrincipals ||
      genesisIssuedAmount < units(p.minGenesisIssuedAmount, 'minGenesisIssuedAmount')) return null;
  return {
    ruleCode: INTEGRITY_RULE_CODES.GENESIS_CREDIT_LOOP,
    ruleVersion: GENESIS_CREDIT_LOOP_RULE_VERSION,
    scope: 'principal',
    signalClass: 'economic_flow',
    relationshipType: 'genesis_recipient_in_circular_settlement_flow',
    principalIds: circle.principalIds,
    edges: circle.edges,
    totalSettlementCount: circle.totalSettlementCount,
    grossAmount: circle.grossAmount,
    genesisIssuance: issuance,
    genesisPrincipalCount,
    genesisIssuedAmount: amountText(genesisIssuedAmount),
    capitalLineageTraced: false,
    policy: { ...circle.policy,
      minGenesisPrincipals: p.minGenesisPrincipals,
      minGenesisIssuedAmount: p.minGenesisIssuedAmount },
  };
}

async function genesisCreditLoopFacts(prisma, principalAId, principalBId, principalCId) {
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT
      ${principalAId}::text AS "principalAId", ${principalBId}::text AS "principalBId", ${principalCId}::text AS "principalCId",
      count(*) FILTER (WHERE "counterpartyPrincipalId" = ${principalAId} AND "subjectPrincipalId" = ${principalBId})::integer AS "aToBSettlementCount",
      count(*) FILTER (WHERE "counterpartyPrincipalId" = ${principalBId} AND "subjectPrincipalId" = ${principalCId})::integer AS "bToCSettlementCount",
      count(*) FILTER (WHERE "counterpartyPrincipalId" = ${principalCId} AND "subjectPrincipalId" = ${principalAId})::integer AS "cToASettlementCount",
      COALESCE(sum(CASE WHEN "counterpartyPrincipalId" = ${principalAId} AND "subjectPrincipalId" = ${principalBId} THEN NULLIF("evidence" ->> 'subjectReceivedAmount', '')::numeric ELSE 0 END), 0)::text AS "aToBAmount",
      COALESCE(sum(CASE WHEN "counterpartyPrincipalId" = ${principalBId} AND "subjectPrincipalId" = ${principalCId} THEN NULLIF("evidence" ->> 'subjectReceivedAmount', '')::numeric ELSE 0 END), 0)::text AS "bToCAmount",
      COALESCE(sum(CASE WHEN "counterpartyPrincipalId" = ${principalCId} AND "subjectPrincipalId" = ${principalAId} THEN NULLIF("evidence" ->> 'subjectReceivedAmount', '')::numeric ELSE 0 END), 0)::text AS "cToAAmount",
      min("occurredAt") AS "basisStart", max("occurredAt") AS "basisEnd"
    FROM "reputation_evidence"
    WHERE "evidenceClass" = 'economic' AND "subjectRole" = 'supplier'
      AND (("counterpartyPrincipalId" = ${principalAId} AND "subjectPrincipalId" = ${principalBId})
        OR ("counterpartyPrincipalId" = ${principalBId} AND "subjectPrincipalId" = ${principalCId})
        OR ("counterpartyPrincipalId" = ${principalCId} AND "subjectPrincipalId" = ${principalAId}))
  `);
  return rows[0] ?? null;
}

export async function evaluateGenesisCreditLoop(prisma, input, options = {}) {
  const [principalAId, principalBId, principalCId] = directedCycle(input);
  const policy = options.policy ?? GENESIS_CREDIT_LOOP_POLICY;
  const p = normalizePolicy(policy);
  const facts = await genesisCreditLoopFacts(prisma, principalAId, principalBId, principalCId);
  if (!facts) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACTS_UNAVAILABLE', 'R7 Settlement cycle facts unavailable');
  }
  // 未满足 R5 的真实结算环阈值时，无需查询发行历史，也不得产生信号。
  const circle = classifyCircularFlow(facts, {
    minEdgeSettlements: p.minEdgeSettlements,
    minTotalSettlements: p.minTotalSettlements,
    minGrossAmount: p.minGrossAmount,
    minEdgeShareBps: p.minEdgeShareBps,
  });
  if (!circle) return { matched: false, ruleCode: INTEGRITY_RULE_CODES.GENESIS_CREDIT_LOOP, signals: [], facts };
  if (!(facts.basisStart instanceof Date) || !Number.isFinite(facts.basisStart.getTime()) ||
      !(facts.basisEnd instanceof Date) || !Number.isFinite(facts.basisEnd.getTime()) ||
      facts.basisStart > facts.basisEnd) {
    throw new IntegritySignalError('INTEGRITY_RULE_FACT_INVALID', 'R7 cycle has no valid immutable evidence window');
  }
  const issuance = await readGenesisIssuanceFacts(prisma, {
    principalIds: circle.principalIds,
    before: facts.basisStart,
  });
  const classification = classifyGenesisCreditLoop(facts, issuance, policy);
  if (!classification) {
    return { matched: false, ruleCode: INTEGRITY_RULE_CODES.GENESIS_CREDIT_LOOP, signals: [], facts, issuance };
  }
  const evidence = {
    relationshipType: classification.relationshipType,
    sourceEvidenceClass: 'economic',
    sourceFactLayers: ['reputation_evidence', ...issuance.sourceFactLayer],
    provenanceVersion: issuance.provenanceVersion,
    principalIds: classification.principalIds,
    capitalLineageTraced: false,
    interpretation: 'genesis_issuance_precedes_circular_settlement_observation_only',
  };
  const metrics = {
    totalSettlementCount: classification.totalSettlementCount,
    grossAmount: classification.grossAmount,
    directedEdges: classification.edges,
    genesisIssuance: classification.genesisIssuance,
    genesisPrincipalCount: classification.genesisPrincipalCount,
    genesisIssuedAmount: classification.genesisIssuedAmount,
    capitalLineageTraced: false,
    thresholds: classification.policy,
    automaticPunishmentApplied: false,
  };
  const signals = [];
  for (const subjectPrincipalId of classification.principalIds) {
    signals.push(await emitIntegritySignal(prisma, {
      subjectPrincipalId, subjectAgentIdentityId: null,
      scope: classification.scope, ruleCode: classification.ruleCode,
      ruleVersion: classification.ruleVersion, signalClass: classification.signalClass,
      evidence, metrics,
      basisStart: facts.basisStart, basisEnd: facts.basisEnd, observedAt: facts.basisEnd,
    }));
  }
  return { matched: true, ruleCode: classification.ruleCode, signals, facts, issuance };
}
