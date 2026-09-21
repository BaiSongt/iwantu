import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';

import {
  INTEGRITY_RULE_CODES,
  INTEGRITY_SIGNAL_PROTOCOL_VERSION,
  emitIntegritySignal,
} from '../src/lib/integrity/integrity-signal.mjs';

const prisma = new PrismaClient();
const migrationUrl = new URL(
  '../prisma/migrations/20260921150000_v2_m11_integrity_signal_foundation/migration.sql',
  import.meta.url,
);

before(async () => prisma.$connect());
after(async () => prisma.$disconnect());

function unique(label) {
  return label + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

async function createActor(label, orgType = 'supplier') {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: {
      name: 'M11 Org ' + suffix,
      type: orgType,
    },
  });
  const principal = await prisma.principal.create({
    data: {
      type: 'organization',
      organizationId: organization.id,
    },
  });
  const agent = await prisma.agentIdentity.create({
    data: {
      principalId: principal.id,
      name: 'M11 Agent ' + suffix,
    },
  });
  return { organization, principal, agent };
}

function signalInput(actor, overrides = {}) {
  const basisStart = new Date('2026-09-21T00:00:00.000Z');
  const basisEnd = new Date('2026-09-21T01:00:00.000Z');
  return {
    subjectPrincipalId: actor.principal.id,
    subjectAgentIdentityId: actor.agent.id,
    scope: 'agent',
    ruleCode: INTEGRITY_RULE_CODES.SELF_TRADING,
    ruleVersion: 'iwantu.integrity-rule.r1/0.1',
    signalClass: 'relationship',
    evidence: {
      relationshipType: 'same_principal',
      settlementIds: ['settlement_fixture_1'],
    },
    metrics: {
      settlementCount: 1,
      independentPrincipalCount: 0,
    },
    basisStart,
    basisEnd,
    observedAt: new Date('2026-09-21T01:00:01.000Z'),
    ...overrides,
  };
}

test('M11-01: baseline rule codes and signal protocol are explicit', () => {
  assert.equal(
    INTEGRITY_SIGNAL_PROTOCOL_VERSION,
    'iwantu.integrity-signal.v0.1',
  );
  assert.equal(INTEGRITY_RULE_CODES.SELF_TRADING, 'R1_SELF_TRADING');
  assert.equal(
    INTEGRITY_RULE_CODES.SAME_PRINCIPAL_TRADING,
    'R2_SAME_PRINCIPAL_TRADING',
  );
  assert.equal(
    INTEGRITY_RULE_CODES.HIGH_COUNTERPARTY_CONCENTRATION,
    'R3_HIGH_COUNTERPARTY_CONCENTRATION',
  );
  assert.equal(
    INTEGRITY_RULE_CODES.HIGH_RECIPROCAL_FLOW,
    'R4_HIGH_RECIPROCAL_FLOW',
  );
  assert.equal(INTEGRITY_RULE_CODES.CIRCULAR_FLOW, 'R5_CIRCULAR_FLOW');
  assert.equal(
    INTEGRITY_RULE_CODES.NEW_ACCOUNT_CLUSTER,
    'R6_NEW_ACCOUNT_CLUSTER',
  );
  assert.equal(
    INTEGRITY_RULE_CODES.GENESIS_CREDIT_LOOP,
    'R7_GENESIS_CREDIT_LOOP',
  );
  assert.equal(
    INTEGRITY_RULE_CODES.INCENTIVE_FARMING,
    'R8_INCENTIVE_FARMING',
  );
});

test('M11-01: IntegritySignal is append-only evidence, not an opaque score or punishment state', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  const table = sql.match(
    /CREATE TABLE "integrity_signals" \([\s\S]*?\n\);/,
  )?.[0];

  assert.ok(table);
  assert.match(table, /"ruleCode" TEXT NOT NULL/);
  assert.match(table, /"ruleVersion" TEXT NOT NULL/);
  assert.match(table, /"evidence" JSONB NOT NULL/);
  assert.match(table, /"metrics" JSONB NOT NULL/);
  assert.match(table, /"evidenceFingerprint" TEXT NOT NULL/);
  assert.doesNotMatch(table, /"score"/i);
  assert.doesNotMatch(table, /"actionLevel"/i);
  assert.doesNotMatch(table, /"blocked"/i);
  assert.match(sql, /INTEGRITY_SIGNAL_IS_IMMUTABLE/);
});

test('M11-01: exact signal replay is deterministic and idempotent on PostgreSQL', async () => {
  const actor = await createActor('replay');
  const input = signalInput(actor);

  const first = await emitIntegritySignal(prisma, input);
  const second = await emitIntegritySignal(prisma, input);

  assert.equal(first.id, second.id);
  assert.match(first.id, /^intsig:/);
  assert.equal(first.protocolVersion, INTEGRITY_SIGNAL_PROTOCOL_VERSION);
  assert.equal(first.ruleCode, INTEGRITY_RULE_CODES.SELF_TRADING);
  assert.deepEqual(first.evidence, input.evidence);
  assert.deepEqual(first.metrics, input.metrics);

  const rows = await prisma.$queryRawUnsafe(
    'SELECT count(*)::integer AS "count" FROM "integrity_signals" WHERE "id" = $1',
    first.id,
  );
  assert.equal(rows[0].count, 1);
});

test('M11-01: IntegritySignal rejects mutation and deletion', async () => {
  const actor = await createActor('immutable');
  const signal = await emitIntegritySignal(prisma, signalInput(actor));

  await assert.rejects(
    prisma.$executeRawUnsafe(
      'UPDATE "integrity_signals" SET "signalClass" = $1 WHERE "id" = $2',
      'forged',
      signal.id,
    ),
    /INTEGRITY_SIGNAL_IS_IMMUTABLE/,
  );

  await assert.rejects(
    prisma.$executeRawUnsafe(
      'DELETE FROM "integrity_signals" WHERE "id" = $1',
      signal.id,
    ),
    /INTEGRITY_SIGNAL_IS_IMMUTABLE/,
  );
});

test('M11-01: Agent-scoped signal is bound to the owning Principal', async () => {
  const actor = await createActor('binding-agent');
  const other = await createActor('binding-other', 'buyer');

  await assert.rejects(
    emitIntegritySignal(
      prisma,
      signalInput(actor, {
        subjectPrincipalId: other.principal.id,
      }),
    ),
    /INTEGRITY_SIGNAL_AGENT_PRINCIPAL_MISMATCH/,
  );
});

test('M11-01: Principal-scoped signal cannot smuggle an AgentIdentity', async () => {
  const actor = await createActor('principal-scope');

  await assert.rejects(
    emitIntegritySignal(
      prisma,
      signalInput(actor, {
        scope: 'principal',
      }),
    ),
    /principal scope must not bind an AgentIdentity/,
  );

  const emitted = await emitIntegritySignal(
    prisma,
    signalInput(actor, {
      scope: 'principal',
      subjectAgentIdentityId: null,
      ruleCode: INTEGRITY_RULE_CODES.NEW_ACCOUNT_CLUSTER,
      ruleVersion: 'iwantu.integrity-rule.r6/0.1',
      signalClass: 'network',
    }),
  );
  assert.equal(emitted.scope, 'principal');
  assert.equal(emitted.subjectAgentIdentityId, null);
});

test('M11-01: direct fabricated fingerprint fails closed', async () => {
  const actor = await createActor('fingerprint');
  const basisStart = new Date('2026-09-21T00:00:00.000Z');
  const basisEnd = new Date('2026-09-21T01:00:00.000Z');
  const observedAt = new Date('2026-09-21T01:00:01.000Z');

  await assert.rejects(
    prisma.$executeRawUnsafe(
      'INSERT INTO "integrity_signals" ("id","protocolVersion","subjectPrincipalId","subjectAgentIdentityId","scope","ruleCode","ruleVersion","signalClass","evidence","metrics","evidenceFingerprint","basisStart","basisEnd","observedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,CAST($9 AS jsonb),CAST($10 AS jsonb),$11,$12,$13,$14)',
      'intsig:forged',
      INTEGRITY_SIGNAL_PROTOCOL_VERSION,
      actor.principal.id,
      actor.agent.id,
      'agent',
      INTEGRITY_RULE_CODES.SELF_TRADING,
      'iwantu.integrity-rule.r1/0.1',
      'relationship',
      JSON.stringify({ fabricated: true }),
      JSON.stringify({ settlementCount: 999 }),
      'forged-fingerprint',
      basisStart,
      basisEnd,
      observedAt,
    ),
    /INTEGRITY_SIGNAL_EVIDENCE_FINGERPRINT_MISMATCH/,
  );
});
