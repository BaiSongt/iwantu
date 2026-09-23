import assert from 'node:assert/strict';
import test from 'node:test';

import { INTEGRITY_RULE_CODES } from '../src/lib/integrity/integrity-signal.mjs';
import {
  RECIPROCAL_FLOW_POLICY,
  RECIPROCAL_FLOW_RULE_VERSION,
  classifyReciprocalFlow,
  evaluateReciprocalFlow,
  scanReciprocalFlowSignals,
} from '../src/lib/integrity/reciprocal-flow.mjs';

function facts(overrides = {}) {
  return {
    principalAId: 'principal-a',
    principalBId: 'principal-b',
    aToBSettlementCount: 3,
    bToASettlementCount: 3,
    aToBAmount: '50.00000000',
    bToAAmount: '50.00000000',
    basisStart: new Date('2026-09-01T00:00:00.000Z'),
    basisEnd: new Date('2026-09-23T01:00:00.000Z'),
    ...overrides,
  };
}

function queryText(query) {
  return Array.isArray(query?.strings)
    ? query.strings.join(' ')
    : String(query);
}

function fakePrisma(derivedFacts, signalIds = ['intsig:r4:a', 'intsig:r4:b']) {
  const calls = [];
  let signalIndex = 0;
  return {
    calls,
    async $queryRaw(query) {
      const text = queryText(query);
      calls.push({ text, values: [...(query?.values ?? [])] });

      if (text.includes('FROM "reputation_evidence"')) {
        return [derivedFacts];
      }
      if (text.includes('"iwantu_emit_integrity_signal"')) {
        const id = signalIds[Math.min(signalIndex, signalIds.length - 1)];
        signalIndex += 1;
        return [{ id }];
      }
      throw new Error('Unexpected query in M11-04 fixture: ' + text);
    },
  };
}

test('M11-04: R4 policy is explicit and versioned', () => {
  assert.equal(
    RECIPROCAL_FLOW_RULE_VERSION,
    'iwantu.integrity-rule.r4/0.1',
  );
  assert.deepEqual(RECIPROCAL_FLOW_POLICY, {
    minDirectionalSettlements: 2,
    minTotalSettlements: 6,
    minGrossAmount: '100.00000000',
    maxNetToGrossBps: 1000,
  });
});

test('M11-04: balanced high-frequency high-gross bilateral flow emits R4', () => {
  const classified = classifyReciprocalFlow(facts());

  assert.equal(
    classified.ruleCode,
    INTEGRITY_RULE_CODES.HIGH_RECIPROCAL_FLOW,
  );
  assert.equal(classified.scope, 'principal');
  assert.equal(classified.signalClass, 'economic_flow');
  assert.equal(classified.totalSettlementCount, 6);
  assert.equal(classified.grossAmount, '100.00000000');
  assert.equal(classified.netAmount, '0.00000000');
  assert.equal(classified.netToGrossRatio, '0.00000000');
});

test('M11-04: low frequency, low gross, or materially imbalanced flow does not emit R4', () => {
  assert.equal(
    classifyReciprocalFlow(
      facts({
        aToBSettlementCount: 5,
        bToASettlementCount: 1,
      }),
    ),
    null,
  );

  assert.equal(
    classifyReciprocalFlow(
      facts({
        aToBAmount: '45.00000000',
        bToAAmount: '45.00000000',
      }),
    ),
    null,
  );

  assert.equal(
    classifyReciprocalFlow(
      facts({
        aToBAmount: '70.00000000',
        bToAAmount: '30.00000000',
      }),
    ),
    null,
  );
});

test('M11-04: exact 10% net-to-gross boundary is included deterministically', () => {
  const classified = classifyReciprocalFlow(
    facts({
      aToBAmount: '55.00000000',
      bToAAmount: '45.00000000',
    }),
  );

  assert.equal(classified.netAmount, '10.00000000');
  assert.equal(classified.netToGrossRatio, '0.10000000');
});

test('M11-04: R4 derives directed credit flow from supplier economic evidence only', async () => {
  const prisma = fakePrisma(facts());

  const evaluated = await evaluateReciprocalFlow(prisma, {
    principalAId: 'principal-b',
    principalBId: 'principal-a',
  });

  assert.equal(evaluated.matched, true);
  assert.equal(
    evaluated.ruleCode,
    INTEGRITY_RULE_CODES.HIGH_RECIPROCAL_FLOW,
  );

  const sourceRead = prisma.calls[0];
  assert.match(sourceRead.text, /FROM "reputation_evidence"/);
  assert.match(sourceRead.text, /"evidenceClass" = 'economic'/);
  assert.match(sourceRead.text, /"subjectRole" = 'supplier'/);
  assert.match(sourceRead.text, /subjectReceivedAmount/);

  const emissions = prisma.calls.filter((call) =>
    call.text.includes('"iwantu_emit_integrity_signal"'),
  );
  assert.equal(emissions.length, 2);

  assert.equal(emissions[0].values[0], 'principal-a');
  assert.equal(emissions[0].values[1], null);
  assert.equal(emissions[0].values[2], 'principal');
  assert.equal(
    emissions[0].values[3],
    INTEGRITY_RULE_CODES.HIGH_RECIPROCAL_FLOW,
  );
  assert.equal(emissions[1].values[0], 'principal-b');

  const evidenceA = JSON.parse(emissions[0].values[6]);
  const metricsA = JSON.parse(emissions[0].values[7]);
  assert.equal(evidenceA.sourceFactLayer, 'reputation_evidence');
  assert.equal(evidenceA.sourceEvidenceClass, 'economic');
  assert.equal(evidenceA.principalAId, 'principal-a');
  assert.equal(evidenceA.principalBId, 'principal-b');
  assert.equal(evidenceA.counterpartyPrincipalId, 'principal-b');
  assert.equal(metricsA.grossAmount, '100.00000000');
  assert.equal(metricsA.netAmount, '0.00000000');
  assert.equal(metricsA.automaticPunishmentApplied, false);
});

test('M11-04: observation creates signals without rewriting economic or trust facts', async () => {
  const prisma = fakePrisma(facts());

  await evaluateReciprocalFlow(prisma, {
    principalAId: 'principal-a',
    principalBId: 'principal-b',
  });

  assert.equal(
    prisma.calls.some((call) =>
      /UPDATE|DELETE|INSERT INTO "reputation_evidence"/i.test(call.text),
    ),
    false,
  );
  assert.equal(
    prisma.calls.some((call) =>
      /UPDATE|DELETE|INSERT INTO "ledger_/i.test(call.text),
    ),
    false,
  );
  assert.equal(
    prisma.calls.some((call) =>
      /UPDATE|DELETE|INSERT INTO "reputation_global_trust_snapshots"/i.test(
        call.text,
      ),
    ),
    false,
  );
});

test('M11-04: exact replay emits identical canonical requests for both Principals', async () => {
  const prisma = fakePrisma(
    facts(),
    ['intsig:r4:a', 'intsig:r4:b', 'intsig:r4:a', 'intsig:r4:b'],
  );

  await evaluateReciprocalFlow(prisma, {
    principalAId: 'principal-a',
    principalBId: 'principal-b',
  });
  await evaluateReciprocalFlow(prisma, {
    principalAId: 'principal-b',
    principalBId: 'principal-a',
  });

  const emissions = prisma.calls.filter((call) =>
    call.text.includes('"iwantu_emit_integrity_signal"'),
  );
  assert.equal(emissions.length, 4);
  assert.deepEqual(emissions[0].values, emissions[2].values);
  assert.deepEqual(emissions[1].values, emissions[3].values);
});

test('M11-04: same-Principal pairs and invalid scan bounds fail closed', async () => {
  assert.throws(
    () =>
      classifyReciprocalFlow(
        facts({
          principalAId: 'principal-a',
          principalBId: 'principal-a',
        }),
      ),
    /R4 requires two distinct Principals/,
  );

  await assert.rejects(
    scanReciprocalFlowSignals(fakePrisma(facts()), { limit: 0 }),
    /limit must be an integer from 1 to 1000/,
  );
});
