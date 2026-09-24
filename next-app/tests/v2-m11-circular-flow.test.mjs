import assert from 'node:assert/strict';
import test from 'node:test';

import { INTEGRITY_RULE_CODES } from '../src/lib/integrity/integrity-signal.mjs';
import {
  CIRCULAR_FLOW_POLICY,
  CIRCULAR_FLOW_RULE_VERSION,
  classifyCircularFlow,
  evaluateCircularFlow,
} from '../src/lib/integrity/circular-flow.mjs';

function facts(overrides = {}) {
  return {
    principalAId: 'principal-a', principalBId: 'principal-b', principalCId: 'principal-c',
    aToBSettlementCount: 1, bToCSettlementCount: 1, cToASettlementCount: 1,
    aToBAmount: '40.00000000', bToCAmount: '30.00000000', cToAAmount: '30.00000000',
    basisStart: new Date('2026-09-01T00:00:00.000Z'), basisEnd: new Date('2026-09-24T00:00:00.000Z'),
    ...overrides,
  };
}

function queryText(query) { return Array.isArray(query?.strings) ? query.strings.join(' ') : String(query); }
function fakePrisma(derivedFacts) {
  const calls = [];
  return {
    calls,
    async $queryRaw(query) {
      const text = queryText(query); calls.push({ text, values: [...(query?.values ?? [])] });
      if (text.includes('FROM "reputation_evidence"')) return [derivedFacts];
      if (text.includes('"iwantu_emit_integrity_signal"')) return [{ id: `intsig:r5:${calls.length}` }];
      throw new Error('Unexpected query in M11-05 fixture: ' + text);
    },
  };
}

test('M11-05: R5 policy is explicit and versioned', () => {
  assert.equal(CIRCULAR_FLOW_RULE_VERSION, 'iwantu.integrity-rule.r5/0.1');
  assert.deepEqual(CIRCULAR_FLOW_POLICY, { minEdgeSettlements: 1, minTotalSettlements: 3, minGrossAmount: '100.00000000', minEdgeShareBps: 2000 });
});

test('M11-05: material three-principal directed cycle emits R5', () => {
  const result = classifyCircularFlow(facts());
  assert.equal(result.ruleCode, INTEGRITY_RULE_CODES.CIRCULAR_FLOW);
  assert.equal(result.scope, 'principal');
  assert.equal(result.signalClass, 'economic_flow');
  assert.equal(result.totalSettlementCount, 3);
  assert.equal(result.grossAmount, '100.00000000');
  assert.deepEqual(result.principalIds, ['principal-a', 'principal-b', 'principal-c']);
});

test('M11-05: missing, low-gross, or immaterial cycle edge does not emit R5', () => {
  assert.equal(classifyCircularFlow(facts({ cToASettlementCount: 0 })), null);
  assert.equal(classifyCircularFlow(facts({ aToBAmount: '20.00000000', bToCAmount: '20.00000000', cToAAmount: '20.00000000' })), null);
  assert.equal(classifyCircularFlow(facts({ aToBAmount: '80.00000000', bToCAmount: '10.00000000', cToAAmount: '10.00000000' })), null);
});

test('M11-05: evaluator reads supplier economic evidence and emits one signal per Principal', async () => {
  const prisma = fakePrisma(facts());
  const result = await evaluateCircularFlow(prisma, { principalAId: 'principal-a', principalBId: 'principal-b', principalCId: 'principal-c' });
  assert.equal(result.matched, true);
  const sourceRead = prisma.calls[0];
  assert.match(sourceRead.text, /FROM "reputation_evidence"/);
  assert.match(sourceRead.text, /"evidenceClass" = 'economic'/);
  assert.match(sourceRead.text, /"subjectRole" = 'supplier'/);
  assert.match(sourceRead.text, /subjectReceivedAmount/);
  const emissions = prisma.calls.filter((call) => call.text.includes('"iwantu_emit_integrity_signal"'));
  assert.equal(emissions.length, 3);
  assert.deepEqual(emissions.map((call) => call.values[0]), ['principal-a', 'principal-b', 'principal-c']);
  const metrics = JSON.parse(emissions[0].values[7]);
  assert.equal(metrics.grossAmount, '100.00000000');
  assert.equal(metrics.automaticPunishmentApplied, false);
});

test('M11-05: observation never mutates reputation, ledger, or trust facts', async () => {
  const prisma = fakePrisma(facts());
  await evaluateCircularFlow(prisma, { principalAId: 'principal-a', principalBId: 'principal-b', principalCId: 'principal-c' });
  assert.equal(prisma.calls.some((call) => /UPDATE|DELETE|INSERT INTO "reputation_evidence"|INSERT INTO "ledger_|UPDATE "ledger_|reputation_global_trust_snapshots/i.test(call.text)), false);
});

test('M11-05: duplicate Principal cycle fails closed', () => {
  assert.throws(() => classifyCircularFlow(facts({ principalCId: 'principal-a' })), /three distinct Principals/);
});
