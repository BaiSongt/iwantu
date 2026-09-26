import assert from 'node:assert/strict';
import test from 'node:test';

import { INTEGRITY_RULE_CODES } from '../src/lib/integrity/integrity-signal.mjs';
import {
  GENESIS_CREDIT_LOOP_POLICY,
  GENESIS_CREDIT_LOOP_RULE_VERSION,
  classifyGenesisCreditLoop,
  evaluateGenesisCreditLoop,
} from '../src/lib/integrity/genesis-credit-loop.mjs';

function facts(overrides = {}) {
  return {
    principalAId: 'principal-a',
    principalBId: 'principal-b',
    principalCId: 'principal-c',
    aToBSettlementCount: 1,
    bToCSettlementCount: 1,
    cToASettlementCount: 1,
    aToBAmount: '50.00000000',
    bToCAmount: '40.00000000',
    cToAAmount: '30.00000000',
    aToBGenesisAmount: '40.00000000',
    bToCGenesisAmount: '30.00000000',
    cToAGenesisAmount: '20.00000000',
    basisStart: new Date('2026-09-20T00:00:00.000Z'),
    basisEnd: new Date('2026-09-24T00:00:00.000Z'),
    ...overrides,
  };
}

function queryText(query) {
  return Array.isArray(query?.strings) ? query.strings.join(' ') : String(query);
}

function fakePrisma(derivedFacts) {
  const calls = [];
  return {
    calls,
    async $queryRaw(query) {
      const text = queryText(query);
      calls.push({ text, values: [...(query?.values ?? [])] });
      if (text.includes('WITH economic_flow') && text.includes('FROM "reputation_evidence"')) {
        return [derivedFacts];
      }
      if (text.includes('"iwantu_emit_integrity_signal"')) {
        return [{ id: 'intsig:r7:' + calls.length }];
      }
      throw new Error('Unexpected query in M11 R7 fixture: ' + text);
    },
  };
}

test('M11 R7: policy is explicit and versioned', () => {
  assert.equal(GENESIS_CREDIT_LOOP_RULE_VERSION, 'iwantu.integrity-rule.r7/0.1');
  assert.deepEqual(GENESIS_CREDIT_LOOP_POLICY, {
    minEdgeSettlements: 1,
    minTotalSettlements: 3,
    minGrossAmount: '100.00000000',
    minGenesisOriginRatioBps: 5000,
  });
});

test('M11 R7: genesis-funded three-principal economic loop emits R7', () => {
  const result = classifyGenesisCreditLoop(facts());
  assert.equal(result.ruleCode, INTEGRITY_RULE_CODES.GENESIS_CREDIT_LOOP);
  assert.equal(result.scope, 'principal');
  assert.equal(result.signalClass, 'economic_flow');
  assert.deepEqual(result.principalIds, ['principal-a', 'principal-b', 'principal-c']);
  assert.equal(result.totalSettlementCount, 3);
  assert.equal(result.grossAmount, '120.00000000');
  assert.equal(result.genesisAmount, '90.00000000');
  assert.equal(result.genesisOriginRatioBps, 7500);
});

test('M11 R7: broken, low-value, or low-genesis loops do not emit', () => {
  assert.equal(classifyGenesisCreditLoop(facts({ cToASettlementCount: 0 })), null);
  assert.equal(classifyGenesisCreditLoop(facts({
    aToBAmount: '20.00000000',
    bToCAmount: '20.00000000',
    cToAAmount: '20.00000000',
  })), null);
  assert.equal(classifyGenesisCreditLoop(facts({
    aToBGenesisAmount: '10.00000000',
    bToCGenesisAmount: '10.00000000',
    cToAGenesisAmount: '10.00000000',
  })), null);
});

test('M11 R7: evaluator reads economic evidence and emits one signal per Principal', async () => {
  const prisma = fakePrisma(facts());
  const result = await evaluateGenesisCreditLoop(prisma, {
    principalAId: 'principal-a',
    principalBId: 'principal-b',
    principalCId: 'principal-c',
  });
  assert.equal(result.matched, true);

  const sourceRead = prisma.calls[0];
  assert.match(sourceRead.text, /FROM "reputation_evidence"/);
  assert.match(sourceRead.text, /"evidenceClass" = 'economic'/);
  assert.match(sourceRead.text, /"subjectRole" = 'supplier'/);

  const emissions = prisma.calls.filter((call) => call.text.includes('"iwantu_emit_integrity_signal"'));
  assert.equal(emissions.length, 3);
  assert.deepEqual(emissions.map((call) => call.values[0]), [
    'principal-a',
    'principal-b',
    'principal-c',
  ]);
  const evidence = JSON.parse(emissions[0].values[6]);
  const metrics = JSON.parse(emissions[0].values[7]);
  assert.equal(evidence.sourceFactLayer, 'reputation_evidence');
  assert.equal(evidence.capitalProvenanceField, 'genesisOriginAmount');
  assert.equal(metrics.genesisOriginRatioBps, 7500);
  assert.equal(metrics.automaticPunishmentApplied, false);
});

test('M11 R7: observation never mutates ledger, reputation, trust, or Principal facts', async () => {
  const prisma = fakePrisma(facts());
  await evaluateGenesisCreditLoop(prisma, {
    principalAId: 'principal-a',
    principalBId: 'principal-b',
    principalCId: 'principal-c',
  });
  assert.equal(
    prisma.calls.some((call) =>
      /UPDATE|DELETE|INSERT INTO "reputation_evidence"|INSERT INTO "ledger_|UPDATE "ledger_|reputation_global_trust_snapshots|UPDATE "principals"/i.test(call.text),
    ),
    false,
  );
});

test('M11 R7: malformed facts, duplicate Principals, and inconsistent policy fail closed', () => {
  assert.throws(
    () => classifyGenesisCreditLoop(facts({ principalCId: 'principal-a' })),
    /three distinct Principals/,
  );
  assert.throws(
    () => classifyGenesisCreditLoop(facts({ aToBAmount: '-1.0' })),
    /non-negative decimal/,
  );
  assert.throws(
    () => classifyGenesisCreditLoop(facts(), {
      ...GENESIS_CREDIT_LOOP_POLICY,
      minGenesisOriginRatioBps: 10001,
    }),
    /policy thresholds are inconsistent/,
  );
});
