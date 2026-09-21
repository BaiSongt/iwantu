import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  REPUTATION_SNAPSHOT_PROJECTION_VERSION,
  ReputationSnapshotError,
  buildReputationSnapshotId,
} from '../src/lib/reputation/reputation-snapshot.mjs';

const migrationUrl = new URL(
  '../prisma/migrations/20260921133000_v2_m10_reputation_snapshot_foundation/migration.sql',
  import.meta.url,
);
const serviceUrl = new URL(
  '../src/lib/reputation/reputation-snapshot.mjs',
  import.meta.url,
);

async function migrationSql() {
  return readFile(migrationUrl, 'utf8');
}

test('M10-01: snapshot identity is deterministic and versioned', () => {
  assert.equal(
    REPUTATION_SNAPSHOT_PROJECTION_VERSION,
    'iwantu.reputation-snapshot.v0.1',
  );
  assert.equal(
    buildReputationSnapshotId({
      subjectPrincipalId: 'principal_a',
      subjectAgentIdentityId: 'agent_a',
    }),
    'repsnap:principal_a:agent_a:iwantu.reputation-snapshot.v0.1',
  );
});

test('M10-01: invalid snapshot subjects fail closed before database access', () => {
  assert.throws(
    () =>
      buildReputationSnapshotId({
        subjectPrincipalId: ' ',
        subjectAgentIdentityId: 'agent_a',
      }),
    (error) =>
      error instanceof ReputationSnapshotError &&
      error.code === 'REPUTATION_SNAPSHOT_INPUT_INVALID',
  );
});

test('M10-01: snapshot storage remains a derived projection, not reputation truth', async () => {
  const sql = await migrationSql();
  const tableDefinition = sql.match(
    /CREATE TABLE "reputation_snapshots" \([\s\S]*?\n\);/,
  )?.[0];

  assert.ok(tableDefinition, 'reputation_snapshots table definition must exist');
  assert.match(tableDefinition, /"projection" JSONB NOT NULL/);
  assert.match(
    tableDefinition,
    /"projectionVersion" TEXT NOT NULL/,
  );
  assert.doesNotMatch(tableDefinition, /"score"/i);
  assert.doesNotMatch(tableDefinition, /"level"/i);
  assert.doesNotMatch(tableDefinition, /"rating"/i);
});

test('M10-01: canonical projection is rebuilt only from immutable ReputationEvidence', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION "iwantu_build_reputation_snapshot_projection"/,
  );
  assert.match(
    sql,
    /FROM "reputation_evidence"\s+WHERE "subjectPrincipalId" = p_subject_principal_id\s+AND "subjectAgentIdentityId" = p_subject_agent_identity_id/,
  );
  assert.doesNotMatch(sql, /UPDATE "reputation_evidence"/);
  assert.doesNotMatch(sql, /DELETE FROM "reputation_evidence"/);
});

test('M10-01: cold start is insufficient evidence rather than low trust', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /WHEN stats\.evidence_count = 0 THEN 'insufficient_evidence'\s+ELSE 'observed'/,
  );
  assert.doesNotMatch(sql, /'low_trust'/i);
});

test('M10-01: projection exposes evidence-backed counts and economic facts without scoring', async () => {
  const sql = await migrationSql();

  assert.match(sql, /'evidenceCount', stats\.evidence_count/);
  assert.match(sql, /'settlementCount', stats\.settlement_count/);
  assert.match(
    sql,
    /'counterpartyPrincipalCount', stats\.counterparty_principal_count/,
  );
  assert.match(sql, /'terminalOutcomes'/);
  assert.match(sql, /'settlementTypes'/);
  assert.match(sql, /'grossSettledCredit'/);
  assert.match(sql, /'subjectReceivedCredit'/);
  assert.doesNotMatch(sql, /trustScore|reputationScore|weightedScore/i);
});

test('M10-01: direct snapshot writes must match the canonical evidence projection', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /CREATE TRIGGER "reputation_snapshots_canonical_projection_guard"\s+BEFORE INSERT OR UPDATE ON "reputation_snapshots"/,
  );
  assert.match(sql, /REPUTATION_SNAPSHOT_SUBJECT_BINDING_MISMATCH/);
  assert.match(sql, /REPUTATION_SNAPSHOT_ID_INVALID/);
  assert.match(sql, /REPUTATION_SNAPSHOT_PROJECTION_MISMATCH/);
});

test('M10-01: snapshot is disposable and idempotently rebuildable', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /CREATE OR REPLACE FUNCTION "iwantu_rebuild_reputation_snapshot"/,
  );
  assert.match(
    sql,
    /ON CONFLICT \(\s*"subjectPrincipalId",\s*"subjectAgentIdentityId",\s*"projectionVersion"\s*\)\s+DO UPDATE SET/,
  );
  assert.doesNotMatch(sql, /reputation_snapshots_delete_guard/i);
});

test('M10-01: application service delegates rebuild to the canonical database projector', async () => {
  const source = await readFile(serviceUrl, 'utf8');

  assert.match(source, /iwantu_rebuild_reputation_snapshot/);
  assert.match(source, /FROM "reputation_snapshots"/);
  assert.doesNotMatch(source, /reputationScore|trustScore|rating/i);
});
