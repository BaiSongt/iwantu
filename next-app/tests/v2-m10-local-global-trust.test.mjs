import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  GLOBAL_TRUST_PROJECTION_VERSION,
  LOCAL_TRUST_PROJECTION_VERSION,
  TrustProjectionError,
  buildGlobalTrustSnapshotId,
  buildLocalTrustSnapshotId,
} from '../src/lib/reputation/trust-projections.mjs';

const migrationUrl = new URL(
  '../prisma/migrations/20260921134500_v2_m10_local_global_trust/migration.sql',
  import.meta.url,
);
const serviceUrl = new URL(
  '../src/lib/reputation/trust-projections.mjs',
  import.meta.url,
);

async function migrationSql() {
  return readFile(migrationUrl, 'utf8');
}

test('M10-02: local and global trust remain distinct versioned projections', () => {
  assert.equal(LOCAL_TRUST_PROJECTION_VERSION, 'iwantu.local-trust.v0.1');
  assert.equal(GLOBAL_TRUST_PROJECTION_VERSION, 'iwantu.global-trust.v0.1');

  assert.equal(
    buildLocalTrustSnapshotId({
      subjectPrincipalId: 'principal_supplier',
      subjectAgentIdentityId: 'agent_supplier',
      counterpartyPrincipalId: 'principal_buyer',
      counterpartyAgentIdentityId: 'agent_buyer',
    }),
    'localtrust:agent_buyer:agent_supplier:iwantu.local-trust.v0.1',
  );

  assert.equal(
    buildGlobalTrustSnapshotId({
      subjectPrincipalId: 'principal_supplier',
      subjectAgentIdentityId: 'agent_supplier',
    }),
    'globaltrust:principal_supplier:agent_supplier:iwantu.global-trust.v0.1',
  );
});

test('M10-02: invalid trust subjects fail closed before database access', () => {
  assert.throws(
    () =>
      buildGlobalTrustSnapshotId({
        subjectPrincipalId: '',
        subjectAgentIdentityId: 'agent_supplier',
      }),
    (error) =>
      error instanceof TrustProjectionError &&
      error.code === 'TRUST_PROJECTION_INPUT_INVALID',
  );
});

test('M10-02: Local Trust is directional relationship evidence', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /'fromCounterpartyAgentIdentityId', p_counterparty_agent_identity_id/,
  );
  assert.match(
    sql,
    /'toSubjectAgentIdentityId', p_subject_agent_identity_id/,
  );
  assert.match(
    sql,
    /"counterpartyAgentIdentityId" = p_counterparty_agent_identity_id/,
  );
  assert.match(
    sql,
    /"subjectAgentIdentityId" = p_subject_agent_identity_id/,
  );
});

test('M10-02: same-Principal relationships remain visible locally but cannot masquerade as global evidence', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /'samePrincipal', p_subject_principal_id = p_counterparty_principal_id/,
  );
  assert.match(
    sql,
    /'globalEligible', p_subject_principal_id <> p_counterparty_principal_id/,
  );
  assert.match(
    sql,
    /WHERE "counterpartyPrincipalId" <> p_subject_principal_id/,
  );
});

test('M10-02: Global Trust basis separates independent diversity from repeated transactions', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /'independentSettlementCount',\s+global_stats\.independent_settlement_count/,
  );
  assert.match(
    sql,
    /'independentCounterpartyPrincipalCount',\s+global_stats\.independent_counterparty_principal_count/,
  );
  assert.match(
    sql,
    /'repeatIndependentSettlementCount',\s+GREATEST\(/,
  );
  assert.match(sql, /'topCounterpartySettlementShare'/);
});

test('M10-02: cold start remains insufficient evidence and no scoring algorithm is introduced', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /WHEN global_stats\.independent_settlement_count = 0\s+THEN 'insufficient_evidence'/,
  );
  assert.match(
    sql,
    /WHEN transaction_stats\.settlement_count = 0 THEN 'insufficient_evidence'/,
  );
  assert.doesNotMatch(
    sql,
    /trustScore|reputationScore|weightedScore|finalScore|trustLevel/i,
  );
});

test('M10-02: projections consume immutable ReputationEvidence without mutating it', async () => {
  const sql = await migrationSql();

  assert.match(sql, /FROM "reputation_evidence"/);
  assert.doesNotMatch(sql, /UPDATE "reputation_evidence"/);
  assert.doesNotMatch(sql, /DELETE FROM "reputation_evidence"/);
  assert.doesNotMatch(sql, /INSERT INTO "reputation_evidence"/);
});

test('M10-02: direct projection writes must match canonical builders', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /CREATE TRIGGER "reputation_local_trust_canonical_projection_guard"\s+BEFORE INSERT OR UPDATE/,
  );
  assert.match(
    sql,
    /CREATE TRIGGER "reputation_global_trust_canonical_projection_guard"\s+BEFORE INSERT OR UPDATE/,
  );
  assert.match(sql, /REPUTATION_LOCAL_TRUST_PROJECTION_MISMATCH/);
  assert.match(sql, /REPUTATION_GLOBAL_TRUST_PROJECTION_MISMATCH/);
});

test('M10-02: local and global projections are idempotently rebuildable and backfilled', async () => {
  const sql = await migrationSql();

  assert.match(sql, /iwantu_rebuild_local_trust_snapshot/);
  assert.match(sql, /iwantu_rebuild_global_trust_snapshot/);
  assert.match(
    sql,
    /SELECT DISTINCT\s+"subjectPrincipalId",\s+"subjectAgentIdentityId",\s+"counterpartyPrincipalId",\s+"counterpartyAgentIdentityId"\s+FROM "reputation_evidence"/,
  );
  assert.match(
    sql,
    /SELECT DISTINCT\s+"subjectPrincipalId",\s+"subjectAgentIdentityId"\s+FROM "reputation_evidence"/,
  );
});

test('M10-02: application service delegates to canonical database projectors', async () => {
  const source = await readFile(serviceUrl, 'utf8');

  assert.match(source, /iwantu_rebuild_local_trust_snapshot/);
  assert.match(source, /iwantu_rebuild_global_trust_snapshot/);
  assert.match(source, /FROM "reputation_local_trust_snapshots"/);
  assert.match(source, /FROM "reputation_global_trust_snapshots"/);
  assert.doesNotMatch(
    source,
    /trustScore|reputationScore|weightedScore|rating/i,
  );
});
