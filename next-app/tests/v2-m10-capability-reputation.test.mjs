import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CAPABILITY_REPUTATION_PROJECTION_VERSION,
  CapabilityReputationError,
  buildCapabilityReputationSnapshotId,
} from '../src/lib/reputation/capability-reputation.mjs';

const migrationUrl = new URL(
  '../prisma/migrations/20260921140000_v2_m10_capability_reputation/migration.sql',
  import.meta.url,
);
const serviceUrl = new URL(
  '../src/lib/reputation/capability-reputation.mjs',
  import.meta.url,
);

async function migrationSql() {
  return readFile(migrationUrl, 'utf8');
}

test('M10-03: capability projection identity is deterministic and namespace-safe', () => {
  assert.equal(
    CAPABILITY_REPUTATION_PROJECTION_VERSION,
    'iwantu.capability-reputation.v0.1',
  );

  assert.equal(
    buildCapabilityReputationSnapshotId({
      subjectPrincipalId: 'principal_supplier',
      subjectAgentIdentityId: 'agent_supplier',
      capabilityId: 'urn:iwantu:capability:manufacturing.cam.toolpath.generate',
    }),
    'caprep:principal_supplier:agent_supplier:urn:iwantu:capability:manufacturing.cam.toolpath.generate:iwantu.capability-reputation.v0.1',
  );
});

test('M10-03: invalid capability inputs fail closed before database access', () => {
  assert.throws(
    () =>
      buildCapabilityReputationSnapshotId({
        subjectPrincipalId: 'principal_supplier',
        subjectAgentIdentityId: 'agent_supplier',
        capabilityId: ' ',
      }),
    (error) =>
      error instanceof CapabilityReputationError &&
      error.code === 'CAPABILITY_REPUTATION_INPUT_INVALID',
  );
});

test('M10-03: historical capability attribution follows immutable contract task snapshot facts', async () => {
  const sql = await migrationSql();

  assert.match(sql, /FROM "reputation_evidence" e/);
  assert.match(sql, /JOIN "contracts" c\s+ON c\."id" = e\."contractId"/);
  assert.match(
    sql,
    /JOIN "offer_revisions" o\s+ON o\."id" = c\."acceptedOfferRevisionId"/,
  );
  assert.match(
    sql,
    /JOIN "task_capability_requirements" r\s+ON r\."taskRevisionId" = o\."taskRevisionId"\s+AND r\."capabilityId" = p_capability_id/,
  );
});

test('M10-03: capability projection does not infer historical AgentVersion', async () => {
  const sql = await migrationSql();

  assert.match(sql, /'versionScope', 'agent_identity'/);
  assert.match(sql, /'agentVersionBinding', 'unbound'/);
  assert.match(sql, /'agentVersionId', NULL/);
  assert.doesNotMatch(sql, /JOIN "agent_versions"/);
  assert.doesNotMatch(sql, /JOIN "agent_capability_claims"/);
});

test('M10-03: external capability namespaces remain valid without registry allowlisting', async () => {
  const sql = await migrationSql();

  const tableDefinition = sql.match(
    /CREATE TABLE "reputation_capability_snapshots" \([\s\S]*?\n\);/,
  )?.[0];

  assert.ok(tableDefinition);
  assert.match(tableDefinition, /"capabilityId" TEXT NOT NULL/);
  assert.doesNotMatch(sql, /FOREIGN KEY \("capabilityId"\).*capability_definitions/s);
});

test('M10-03: capability facts expose observation and independence without a score', async () => {
  const sql = await migrationSql();

  assert.match(sql, /'attributionBasis', 'task_required_capability'/);
  assert.match(sql, /'settlementCount'/);
  assert.match(sql, /'independentSettlementCount'/);
  assert.match(sql, /'independentCounterpartyPrincipalCount'/);
  assert.match(sql, /'terminalOutcomes'/);
  assert.match(sql, /'independentTerminalOutcomes'/);
  assert.match(sql, /'grossSettledCredit'/);
  assert.doesNotMatch(
    sql,
    /capabilityScore|trustScore|reputationScore|weightedScore|rating/i,
  );
});

test('M10-03: cold start is insufficient evidence', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /WHEN transaction_stats\.settlement_count = 0\s+THEN 'insufficient_evidence'/,
  );
});

test('M10-03: projector consumes evidence without mutating protocol truth', async () => {
  const sql = await migrationSql();

  assert.doesNotMatch(sql, /UPDATE "reputation_evidence"/);
  assert.doesNotMatch(sql, /DELETE FROM "reputation_evidence"/);
  assert.doesNotMatch(sql, /INSERT INTO "reputation_evidence"/);
});

test('M10-03: direct snapshot writes are canonical and rebuild is idempotent', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /CREATE TRIGGER "reputation_capability_canonical_projection_guard"\s+BEFORE INSERT OR UPDATE/,
  );
  assert.match(sql, /REPUTATION_CAPABILITY_PROJECTION_MISMATCH/);
  assert.match(sql, /iwantu_rebuild_capability_reputation_snapshot/);
  assert.match(
    sql,
    /ON CONFLICT \(\s*"subjectPrincipalId",\s*"subjectAgentIdentityId",\s*"capabilityId",\s*"projectionVersion"\s*\)\s+DO UPDATE SET/,
  );
});

test('M10-03: application service delegates to canonical database projector', async () => {
  const source = await readFile(serviceUrl, 'utf8');

  assert.match(source, /iwantu_rebuild_capability_reputation_snapshot/);
  assert.match(source, /FROM "reputation_capability_snapshots"/);
  assert.doesNotMatch(
    source,
    /capabilityScore|trustScore|reputationScore|weightedScore|rating/i,
  );
});
