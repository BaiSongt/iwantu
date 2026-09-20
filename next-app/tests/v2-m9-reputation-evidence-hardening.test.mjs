import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL(
  '../prisma/migrations/20260919161000_v2_m9_terminal_reputation_evidence/migration.sql',
  import.meta.url,
);

async function migrationSql() {
  return readFile(migrationUrl, 'utf8');
}

test('M9 hardening: terminal Settlement is the only automatic reputation emission boundary', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /CREATE TRIGGER "settlements_terminal_reputation_evidence"\s+AFTER INSERT ON "settlements"/,
  );
  assert.doesNotMatch(sql, /CREATE TRIGGER\s+"[^"]*reputation[^\n]*"[\s\S]*?ON "deliveries"/i);
  assert.doesNotMatch(
    sql,
    /CREATE TRIGGER\s+"[^"]*reputation[^\n]*"[\s\S]*?ON "delivery_acceptance_decisions"/i,
  );
});

test('M9 hardening: evidence identity is unique per settlement subject and evidence class', async () => {
  const sql = await migrationSql();

  assert.match(
    sql,
    /CREATE UNIQUE INDEX "reputation_evidence_settlement_subject_class_key"\s+ON "reputation_evidence"\("settlementId", "subjectRole", "evidenceClass"\)/,
  );
  assert.match(sql, /'rep:' \|\| NEW\."id" \|\| ':' \|\| role_name \|\| ':' \|\| class_name/);
});

test('M9 hardening: direct evidence fabrication and mutation fail closed', async () => {
  const sql = await migrationSql();

  assert.match(sql, /CREATE TRIGGER "reputation_evidence_binding_guard"\s+BEFORE INSERT/);
  assert.match(sql, /REPUTATION_EVIDENCE_PAYLOAD_MISMATCH/);
  assert.match(sql, /CREATE TRIGGER "reputation_evidence_update_guard"\s+BEFORE UPDATE/);
  assert.match(sql, /CREATE TRIGGER "reputation_evidence_delete_guard"\s+BEFORE DELETE/);
  assert.match(sql, /REPUTATION_EVIDENCE_IS_IMMUTABLE/);
});

test('M9 hardening: evidence is bound to immutable settlement time and contract parties', async () => {
  const sql = await migrationSql();

  assert.match(sql, /NEW\."occurredAt" IS DISTINCT FROM settlement_row\."createdAt"/);
  assert.match(sql, /REPUTATION_OCCURRED_AT_MISMATCH/);
  assert.match(sql, /REPUTATION_SETTLEMENT_CONTRACT_MISMATCH/);
  assert.match(sql, /REPUTATION_PARTY_BINDING_MISMATCH/);
});

test('M9 hardening: migration backfills pre-existing terminal settlements through canonical builder', async () => {
  const sql = await migrationSql();

  assert.match(sql, /FOR settlement_row IN SELECT \* FROM "settlements"/);
  assert.match(
    sql,
    /"iwantu_build_terminal_reputation_evidence"\(\s*settlement_row\."id",\s*role_name,\s*class_name\s*\)/,
  );
  assert.match(
    sql,
    /ON CONFLICT \("settlementId", "subjectRole", "evidenceClass"\) DO NOTHING/,
  );
});

test('M9 hardening: foundation remains evidence-only and introduces no mutable score field', async () => {
  const sql = await migrationSql();
  const tableDefinition = sql.match(
    /CREATE TABLE "reputation_evidence" \([\s\S]*?\n\);/,
  )?.[0];

  assert.ok(tableDefinition, 'reputation_evidence table definition must exist');
  assert.doesNotMatch(tableDefinition, /"score"/i);
  assert.doesNotMatch(tableDefinition, /"level"/i);
  assert.match(tableDefinition, /"evidence" JSONB NOT NULL/);
});
