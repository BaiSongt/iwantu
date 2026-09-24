import assert from 'node:assert/strict';
import test from 'node:test';

import { INTEGRITY_RULE_CODES } from '../src/lib/integrity/integrity-signal.mjs';
import {
  NEW_ACCOUNT_CLUSTER_POLICY,
  NEW_ACCOUNT_CLUSTER_RULE_VERSION,
  classifyNewAccountCluster,
  evaluateNewAccountCluster,
} from '../src/lib/integrity/new-account-cluster.mjs';

function facts(overrides = {}) {
  return {
    principalAId: 'principal-a',
    principalBId: 'principal-b',
    principalCId: 'principal-c',
    principalACreatedAt: new Date('2026-09-01T00:00:00.000Z'),
    principalBCreatedAt: new Date('2026-09-05T00:00:00.000Z'),
    principalCCreatedAt: new Date('2026-09-10T00:00:00.000Z'),
    abSettlementCount: 2,
    bcSettlementCount: 2,
    caSettlementCount: 2,
    basisStart: new Date('2026-09-12T00:00:00.000Z'),
    basisEnd: new Date('2026-09-24T00:00:00.000Z'),
    ...overrides,
  };
}

function queryText(query) {
  return Array.isArray(query?.strings)
    ? query.strings.join(' ')
    : String(query);
}

function fakePrisma(derivedFacts) {
  const calls = [];
  return {
    calls,
    async $queryRaw(query) {
      const text = queryText(query);
      calls.push({ text, values: [...(query?.values ?? [])] });

      if (
        text.includes('WITH principal_rows') &&
        text.includes('FROM "reputation_evidence"')
      ) {
        return [derivedFacts];
      }
      if (text.includes('"iwantu_emit_integrity_signal"')) {
        return [{ id: 'intsig:r6:' + calls.length }];
      }
      throw new Error('Unexpected query in M11-05 R6 fixture: ' + text);
    },
  };
}

test('M11-05 R6: policy is explicit and versioned', () => {
  assert.equal(
    NEW_ACCOUNT_CLUSTER_RULE_VERSION,
    'iwantu.integrity-rule.r6/0.1',
  );
  assert.deepEqual(NEW_ACCOUNT_CLUSTER_POLICY, {
    maxPrincipalCreationSpreadDays: 14,
    maxFirstActivityDelayDays: 14,
    minPairSettlements: 1,
    minTotalSettlements: 6,
  });
});

test('M11-05 R6: dense three-principal new-account cluster emits R6', () => {
  const result = classifyNewAccountCluster(facts());

  assert.equal(
    result.ruleCode,
    INTEGRITY_RULE_CODES.NEW_ACCOUNT_CLUSTER,
  );
  assert.equal(result.scope, 'principal');
  assert.equal(result.signalClass, 'relationship_graph');
  assert.deepEqual(result.principalIds, [
    'principal-a',
    'principal-b',
    'principal-c',
  ]);
  assert.equal(result.totalSettlementCount, 6);
  assert.deepEqual(result.pairSettlementCounts, {
    ab: 2,
    bc: 2,
    ca: 2,
  });
});

test('M11-05 R6: old, delayed, sparse, or low-sample clusters do not emit', () => {
  assert.equal(
    classifyNewAccountCluster(
      facts({
        principalACreatedAt: new Date('2026-08-01T00:00:00.000Z'),
      }),
    ),
    null,
  );

  assert.equal(
    classifyNewAccountCluster(
      facts({
        basisStart: new Date('2026-09-30T00:00:00.000Z'),
        basisEnd: new Date('2026-10-01T00:00:00.000Z'),
      }),
    ),
    null,
  );

  assert.equal(
    classifyNewAccountCluster(
      facts({
        caSettlementCount: 0,
        abSettlementCount: 3,
        bcSettlementCount: 3,
      }),
    ),
    null,
  );

  assert.equal(
    classifyNewAccountCluster(
      facts({
        abSettlementCount: 1,
        bcSettlementCount: 1,
        caSettlementCount: 1,
      }),
    ),
    null,
  );
});

test('M11-05 R6: evaluator reads Principal creation facts and supplier transaction evidence', async () => {
  const prisma = fakePrisma(facts());

  const result = await evaluateNewAccountCluster(prisma, {
    principalAId: 'principal-a',
    principalBId: 'principal-b',
    principalCId: 'principal-c',
  });

  assert.equal(result.matched, true);

  const sourceRead = prisma.calls[0];
  assert.match(sourceRead.text, /FROM "principals"/);
  assert.match(sourceRead.text, /FROM "reputation_evidence"/);
  assert.match(sourceRead.text, /"evidenceClass" = 'transaction'/);
  assert.match(sourceRead.text, /"subjectRole" = 'supplier'/);

  const emissions = prisma.calls.filter((call) =>
    call.text.includes('"iwantu_emit_integrity_signal"'),
  );
  assert.equal(emissions.length, 3);
  assert.deepEqual(
    emissions.map((call) => call.values[0]),
    ['principal-a', 'principal-b', 'principal-c'],
  );

  const evidence = JSON.parse(emissions[0].values[6]);
  const metrics = JSON.parse(emissions[0].values[7]);
  assert.equal(evidence.sourceFactLayer, 'reputation_evidence');
  assert.equal(evidence.principalFactLayer, 'principals.createdAt');
  assert.equal(metrics.totalSettlementCount, 6);
  assert.equal(metrics.automaticPunishmentApplied, false);
});

test('M11-05 R6: observation never mutates reputation, ledger, trust, or Principal facts', async () => {
  const prisma = fakePrisma(facts());

  await evaluateNewAccountCluster(prisma, {
    principalAId: 'principal-a',
    principalBId: 'principal-b',
    principalCId: 'principal-c',
  });

  assert.equal(
    prisma.calls.some((call) =>
      /UPDATE|DELETE|INSERT INTO "reputation_evidence"|INSERT INTO "ledger_|UPDATE "ledger_|reputation_global_trust_snapshots|UPDATE "principals"/i.test(
        call.text,
      ),
    ),
    false,
  );
});

test('M11-05 R6: duplicate Principal and pre-creation activity fail closed', () => {
  assert.throws(
    () =>
      classifyNewAccountCluster(
        facts({ principalCId: 'principal-a' }),
      ),
    /three distinct Principals/,
  );

  assert.equal(
    classifyNewAccountCluster(
      facts({
        basisStart: new Date('2026-09-09T00:00:00.000Z'),
      }),
    ),
    null,
  );
});
