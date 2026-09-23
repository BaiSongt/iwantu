import assert from 'node:assert/strict';
import test from 'node:test';

import { INTEGRITY_RULE_CODES } from '../src/lib/integrity/integrity-signal.mjs';
import {
  COUNTERPARTY_CONCENTRATION_POLICY,
  COUNTERPARTY_CONCENTRATION_RULE_VERSION,
  classifyCounterpartyConcentration,
  evaluateCounterpartyConcentration,
  scanCounterpartyConcentrationSignals,
} from '../src/lib/integrity/counterparty-concentration.mjs';

function facts(overrides = {}) {
  return {
    independentSettlementCount: 5,
    independentCounterpartyPrincipalCount: 2,
    topCounterpartySettlementCount: 4,
    topCounterpartyPrincipalId: 'principal-counterparty-a',
    basisStart: new Date('2026-09-01T00:00:00.000Z'),
    basisEnd: new Date('2026-09-23T00:00:00.000Z'),
    ...overrides,
  };
}

function queryText(query) {
  return Array.isArray(query?.strings)
    ? query.strings.join(' ')
    : String(query);
}

function fakePrisma(derivedFacts, signal = { id: 'intsig:r3-stable' }) {
  const calls = [];
  return {
    calls,
    async $queryRaw(query) {
      const text = queryText(query);
      calls.push({ text, values: [...(query?.values ?? [])] });

      if (text.includes('FROM "reputation_evidence"')) {
        return [derivedFacts];
      }
      if (text.includes('"iwantu_emit_integrity_signal"')) {
        return [signal];
      }
      throw new Error('Unexpected query in M11-03 fixture: ' + text);
    },
  };
}

test('M11-03: R3 policy is explicit, versioned and conservative', () => {
  assert.equal(
    COUNTERPARTY_CONCENTRATION_RULE_VERSION,
    'iwantu.integrity-rule.r3/0.1',
  );
  assert.deepEqual(COUNTERPARTY_CONCENTRATION_POLICY, {
    minIndependentSettlements: 5,
    topCounterpartyShareBps: 8000,
  });
});

test('M11-03: 80% top-counterparty share at five independent settlements emits R3', () => {
  const classified = classifyCounterpartyConcentration(facts());

  assert.equal(
    classified.ruleCode,
    INTEGRITY_RULE_CODES.HIGH_COUNTERPARTY_CONCENTRATION,
  );
  assert.equal(classified.scope, 'agent');
  assert.equal(classified.signalClass, 'market_concentration');
  assert.equal(classified.topCounterpartySettlementShare, '0.80000000');
  assert.equal(classified.independentSettlementCount, 5);
  assert.equal(classified.topCounterpartySettlementCount, 4);
});

test('M11-03: small samples and sub-threshold concentration do not emit R3', () => {
  assert.equal(
    classifyCounterpartyConcentration(
      facts({
        independentSettlementCount: 4,
        topCounterpartySettlementCount: 4,
      }),
    ),
    null,
  );

  assert.equal(
    classifyCounterpartyConcentration(
      facts({
        independentSettlementCount: 5,
        topCounterpartySettlementCount: 3,
      }),
    ),
    null,
  );
});

test('M11-03: R3 derives only from independent Principal transaction evidence', async () => {
  const derived = facts();
  const prisma = fakePrisma(derived);

  const evaluated = await evaluateCounterpartyConcentration(prisma, {
    subjectPrincipalId: 'principal-subject',
    subjectAgentIdentityId: 'agent-subject',
  });

  assert.equal(evaluated.matched, true);
  assert.equal(
    evaluated.ruleCode,
    INTEGRITY_RULE_CODES.HIGH_COUNTERPARTY_CONCENTRATION,
  );
  assert.equal(prisma.calls.length, 2);

  const sourceRead = prisma.calls[0];
  assert.match(sourceRead.text, /FROM "reputation_evidence"/);
  assert.match(sourceRead.text, /"evidenceClass" = 'transaction'/);
  assert.match(
    sourceRead.text,
    /"counterpartyPrincipalId" <>/,
  );
  assert.match(
    sourceRead.text,
    /ORDER BY settlement_count DESC, "counterpartyPrincipalId" ASC/,
  );
  assert.deepEqual(sourceRead.values, [
    'principal-subject',
    'agent-subject',
    'principal-subject',
  ]);

  const emission = prisma.calls[1];
  assert.match(emission.text, /"iwantu_emit_integrity_signal"/);
  assert.equal(emission.values[0], 'principal-subject');
  assert.equal(emission.values[1], 'agent-subject');
  assert.equal(emission.values[2], 'agent');
  assert.equal(
    emission.values[3],
    INTEGRITY_RULE_CODES.HIGH_COUNTERPARTY_CONCENTRATION,
  );

  const evidence = JSON.parse(emission.values[6]);
  const metrics = JSON.parse(emission.values[7]);
  assert.deepEqual(evidence, {
    relationshipType: 'independent_counterparty_concentration',
    sourceEvidenceClass: 'transaction',
    sourceFactLayer: 'reputation_evidence',
    topCounterpartyPrincipalId: 'principal-counterparty-a',
  });
  assert.equal(metrics.independentSettlementCount, 5);
  assert.equal(metrics.independentCounterpartyPrincipalCount, 2);
  assert.equal(metrics.topCounterpartySettlementCount, 4);
  assert.equal(metrics.topCounterpartySettlementShare, '0.80000000');
  assert.equal(metrics.thresholdShareBps, 8000);
  assert.equal(metrics.minimumIndependentSettlements, 5);
  assert.equal(metrics.automaticPunishmentApplied, false);
});

test('M11-03: concentration observation does not mutate or rewrite trust evidence', async () => {
  const derived = facts();
  const prisma = fakePrisma(derived);

  await evaluateCounterpartyConcentration(prisma, {
    subjectPrincipalId: 'principal-subject',
    subjectAgentIdentityId: 'agent-subject',
  });

  assert.equal(
    prisma.calls.some((call) =>
      /UPDATE|DELETE|INSERT INTO "reputation_evidence"/i.test(call.text),
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

test('M11-03: exact replay produces the same canonical signal request', async () => {
  const derived = facts();
  const prisma = fakePrisma(derived);

  const first = await evaluateCounterpartyConcentration(prisma, {
    subjectPrincipalId: 'principal-subject',
    subjectAgentIdentityId: 'agent-subject',
  });
  const second = await evaluateCounterpartyConcentration(prisma, {
    subjectPrincipalId: 'principal-subject',
    subjectAgentIdentityId: 'agent-subject',
  });

  assert.equal(first.signal.id, second.signal.id);
  const emissions = prisma.calls.filter((call) =>
    call.text.includes('"iwantu_emit_integrity_signal"'),
  );
  assert.equal(emissions.length, 2);
  assert.deepEqual(emissions[0].values, emissions[1].values);
});

test('M11-03: invalid scan bounds and impossible counts fail closed', async () => {
  await assert.rejects(
    scanCounterpartyConcentrationSignals(fakePrisma(facts()), { limit: 0 }),
    /limit must be an integer from 1 to 1000/,
  );

  assert.throws(
    () =>
      classifyCounterpartyConcentration(
        facts({
          independentSettlementCount: 5,
          topCounterpartySettlementCount: 6,
        }),
      ),
    /topCounterpartySettlementCount cannot exceed independentSettlementCount/,
  );
});
