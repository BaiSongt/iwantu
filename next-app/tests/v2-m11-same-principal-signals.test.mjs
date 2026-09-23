import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { INTEGRITY_RULE_CODES } from '../src/lib/integrity/integrity-signal.mjs';
import {
  SAME_PRINCIPAL_RULE_VERSIONS,
  classifySamePrincipalRelationship,
  evaluateSamePrincipalSettlement,
} from '../src/lib/integrity/same-principal-rules.mjs';

const globalTrustMigrationUrl = new URL(
  '../prisma/migrations/20260921134500_v2_m10_local_global_trust/migration.sql',
  import.meta.url,
);

function settlementFacts(overrides = {}) {
  return {
    settlementId: 'settlement-r1-r2',
    contractId: 'contract-r1-r2',
    settlementHash: 'a'.repeat(64),
    settlementType: 'full_settlement',
    settlementCreatedAt: new Date('2026-09-23T01:00:00.000Z'),
    activatedAt: new Date('2026-09-23T00:00:00.000Z'),
    buyerPrincipalId: 'principal-shared',
    buyerAgentIdentityId: 'agent-buyer',
    supplierPrincipalId: 'principal-shared',
    supplierAgentIdentityId: 'agent-supplier',
    ...overrides,
  };
}

function queryText(query) {
  return Array.isArray(query?.strings)
    ? query.strings.join(' ')
    : String(query);
}

function fakePrisma(facts, signal = { id: 'intsig:stable' }) {
  const calls = [];
  return {
    calls,
    async $queryRaw(query) {
      const text = queryText(query);
      calls.push({ text, values: [...(query?.values ?? [])] });

      if (text.includes('FROM "settlements"')) {
        return facts ? [facts] : [];
      }
      if (text.includes('"iwantu_emit_integrity_signal"')) {
        return [signal];
      }
      throw new Error('Unexpected query in M11-02 fixture: ' + text);
    },
  };
}

test('M11-02: R1 classifies same Principal and same AgentIdentity as SELF_TRADING', () => {
  const classified = classifySamePrincipalRelationship(
    settlementFacts({
      buyerAgentIdentityId: 'agent-shared',
      supplierAgentIdentityId: 'agent-shared',
    }),
  );

  assert.deepEqual(classified, {
    ruleCode: INTEGRITY_RULE_CODES.SELF_TRADING,
    ruleVersion: SAME_PRINCIPAL_RULE_VERSIONS.R1,
    scope: 'agent',
    subjectPrincipalId: 'principal-shared',
    subjectAgentIdentityId: 'agent-shared',
    signalClass: 'relationship',
    relationshipType: 'same_agent_self_trading',
  });
});

test('M11-02: R2 classifies same Principal and distinct AgentIdentities as SAME_PRINCIPAL_TRADING', () => {
  const classified = classifySamePrincipalRelationship(settlementFacts());

  assert.deepEqual(classified, {
    ruleCode: INTEGRITY_RULE_CODES.SAME_PRINCIPAL_TRADING,
    ruleVersion: SAME_PRINCIPAL_RULE_VERSIONS.R2,
    scope: 'principal',
    subjectPrincipalId: 'principal-shared',
    subjectAgentIdentityId: null,
    signalClass: 'relationship',
    relationshipType: 'same_principal_distinct_agents',
  });
});

test('M11-02: independent Principals do not emit an R1/R2 signal', async () => {
  const prisma = fakePrisma(
    settlementFacts({ supplierPrincipalId: 'principal-independent' }),
  );

  assert.equal(
    classifySamePrincipalRelationship(
      settlementFacts({ supplierPrincipalId: 'principal-independent' }),
    ),
    null,
  );

  const evaluated = await evaluateSamePrincipalSettlement(prisma, {
    settlementId: 'settlement-r1-r2',
  });

  assert.deepEqual(evaluated, {
    matched: false,
    ruleCode: null,
    signal: null,
  });
  assert.equal(prisma.calls.length, 1);
  assert.match(prisma.calls[0].text, /JOIN "contracts"/);
});

test('M11-02: evaluator derives R1 only from Settlement plus immutable Contract bindings', async () => {
  const facts = settlementFacts({
    buyerAgentIdentityId: 'agent-shared',
    supplierAgentIdentityId: 'agent-shared',
  });
  const prisma = fakePrisma(facts);

  const evaluated = await evaluateSamePrincipalSettlement(prisma, {
    settlementId: facts.settlementId,
    buyerPrincipalId: 'forged-caller-principal',
    buyerAgentIdentityId: 'forged-caller-agent',
  });

  assert.equal(evaluated.matched, true);
  assert.equal(evaluated.ruleCode, INTEGRITY_RULE_CODES.SELF_TRADING);
  assert.equal(prisma.calls.length, 2);

  const sourceRead = prisma.calls[0];
  assert.match(sourceRead.text, /FROM "settlements"/);
  assert.match(sourceRead.text, /JOIN "contracts"/);
  assert.deepEqual(sourceRead.values, [facts.settlementId]);

  const emission = prisma.calls[1];
  assert.match(emission.text, /"iwantu_emit_integrity_signal"/);
  assert.equal(emission.values[0], facts.buyerPrincipalId);
  assert.equal(emission.values[1], facts.buyerAgentIdentityId);
  assert.equal(emission.values[2], 'agent');
  assert.equal(emission.values[3], INTEGRITY_RULE_CODES.SELF_TRADING);

  const evidence = JSON.parse(emission.values[6]);
  const metrics = JSON.parse(emission.values[7]);
  assert.equal(evidence.contractId, facts.contractId);
  assert.equal(evidence.settlementId, facts.settlementId);
  assert.equal(evidence.settlementHash, facts.settlementHash);
  assert.equal(evidence.buyerPrincipalId, facts.buyerPrincipalId);
  assert.equal(evidence.supplierPrincipalId, facts.supplierPrincipalId);
  assert.equal(metrics.samePrincipal, true);
  assert.equal(metrics.sameAgent, true);
  assert.equal(metrics.independentGlobalTrustEligible, false);
});

test('M11-02: R2 signal is Principal-scoped and cannot masquerade as independent Global Trust', async () => {
  const facts = settlementFacts();
  const prisma = fakePrisma(facts);

  const evaluated = await evaluateSamePrincipalSettlement(prisma, {
    settlementId: facts.settlementId,
  });

  assert.equal(evaluated.ruleCode, INTEGRITY_RULE_CODES.SAME_PRINCIPAL_TRADING);

  const emission = prisma.calls[1];
  assert.equal(emission.values[0], facts.buyerPrincipalId);
  assert.equal(emission.values[1], null);
  assert.equal(emission.values[2], 'principal');
  assert.equal(
    emission.values[3],
    INTEGRITY_RULE_CODES.SAME_PRINCIPAL_TRADING,
  );

  const metrics = JSON.parse(emission.values[7]);
  assert.equal(metrics.samePrincipal, true);
  assert.equal(metrics.sameAgent, false);
  assert.equal(metrics.independentGlobalTrustEligible, false);

  const migrationSql = await readFile(globalTrustMigrationUrl, 'utf8');
  assert.match(
    migrationSql,
    /"counterpartyPrincipalId" <> p_subject_principal_id/,
  );
  assert.match(migrationSql, /same_principal_settlement_count/);
});

test('M11-02: exact replay produces the same canonical emission input', async () => {
  const facts = settlementFacts();
  const prisma = fakePrisma(facts, { id: 'intsig:replay-stable' });

  const first = await evaluateSamePrincipalSettlement(prisma, {
    settlementId: facts.settlementId,
  });
  const second = await evaluateSamePrincipalSettlement(prisma, {
    settlementId: facts.settlementId,
  });

  assert.equal(first.signal.id, second.signal.id);
  const emissions = prisma.calls.filter((call) =>
    call.text.includes('"iwantu_emit_integrity_signal"'),
  );
  assert.equal(emissions.length, 2);
  assert.deepEqual(emissions[0].values, emissions[1].values);
});

test('M11-02: malformed relationship inputs fail closed', () => {
  assert.throws(
    () =>
      classifySamePrincipalRelationship({
        buyerPrincipalId: '',
        supplierPrincipalId: 'principal',
        buyerAgentIdentityId: 'buyer-agent',
        supplierAgentIdentityId: 'supplier-agent',
      }),
    /buyerPrincipalId must be a non-empty string/,
  );
});
