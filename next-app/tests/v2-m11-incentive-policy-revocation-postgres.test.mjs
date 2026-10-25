import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { bindAuthorityToAuthentication } from '../src/lib/agent-auth-context-core.mjs';
import { resolveAuthority } from '../src/lib/authority/authority.mjs';
import { captureAuthoritySnapshot, sha256Evidence } from '../src/lib/authority/authority-snapshot.mjs';
import { buildPolicyRevocationPayload, validateSignedCommand } from '../src/lib/incentives/governance-protocol.mjs';
import { createTerminalSettlement, unique } from './helpers/incentive-governance-fixtures.mjs';
import {
  actorWithMandate, prepareRevocationProgram, revocationAwardInput, revocationInput, revocationState,
} from './helpers/incentive-policy-revocation-fixtures.mjs';
import { requireR8PostgresTestTarget } from './helpers/r8-postgres-test-target.mjs';

const prisma = new PrismaClient();
let connected = false;
before(async () => {
  requireR8PostgresTestTarget();
  await prisma.$connect();
  connected = true;
});
after(async () => { if (connected) await prisma.$disconnect(); });

const diagnostic = (error) => `${error.code ?? ''} ${error.message} ${error.meta?.message ?? ''}`;
async function rejectAtomically(operation, pattern) {
  const state = await revocationState(prisma);
  await assert.rejects(operation, (error) => { assert.match(diagnostic(error), pattern); return true; });
  assert.deepEqual(await revocationState(prisma), state, 'failure must roll back all protocol facts and nonce evidence');
}
const financial = ({ transactions, entries, bindings, reputationEvidence, reputationSnapshots }) =>
  ({ transactions, entries, bindings, reputationEvidence, reputationSnapshots });

test('R8 revocation: exact nonmonetary authority preserves paid proofs and another policy version', async () => {
  const fixture = await prepareRevocationProgram(prisma, { versions: 2 });
  const paid = await createTerminalSettlement(prisma, 'revoke-already-paid');
  const fresh = await createTerminalSettlement(prisma, 'revoke-other-version');
  const awardInput = revocationAwardInput(fixture, paid);
  const awarded = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, awardInput);
  const actor = await actorWithMandate(prisma, fixture.governance, ['incentive.policy.revoke']);
  const input = revocationInput(fixture, { actor, reasonCode: 'policy_error' });
  const state = financial(await revocationState(prisma));
  const result = await fixture.service.revokePolicy(prisma, actor.authentication, input);
  assert.equal(result.idempotent, false);
  assert.equal(result.revocation.id, result.authorization.commandHash);
  assert.equal(result.revocation.authorizationId, result.authorization.commandHash);
  assert.equal(result.revocation.reasonCode, 'policy_error');
  assert.equal(result.revocation.revocationHash, sha256Evidence(result.revocation.evidence));
  assert.deepEqual(result.revocation.evidence, { ...input.revocation, authorizationId: result.authorization.commandHash });
  const snapshot = await prisma.authoritySnapshot.findUnique({ where: { id: result.authorization.authoritySnapshotId } });
  assert.equal(snapshot.requestEvidence.economic, null);
  assert.deepEqual(snapshot.effectiveAuthority.economicLimits, {});
  assert.deepEqual(financial(await revocationState(prisma)), state, 'revocation does not spend or change reputation');
  const replay = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, awardInput);
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.binding, awarded.binding);
  assert.equal(replay.ledgerTransaction.id, awarded.ledgerTransaction.id);
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication,
    revocationAwardInput(fixture, fresh)), /R8_POLICY_REVOKED/);
  const other = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication,
    revocationAwardInput(fixture, fresh, fixture.candidates[1]));
  assert.equal(other.idempotent, false);
  assert.equal(other.binding.policyHash, fixture.candidates[1].policyHash);
  const [policy] = await prisma.$queryRaw`SELECT "policy" FROM "r8_incentive_policies" WHERE "policyHash" = ${fixture.candidate.policyHash}`;
  assert.deepEqual(policy.policy, fixture.candidate.policy);
});

test('R8 revocation: concurrent exact replays append one event; fresh and cross-action nonces cannot append', async () => {
  const fixture = await prepareRevocationProgram(prisma, { versions: 2 });
  const input = revocationInput(fixture);
  const results = await Promise.all([0, 1].map(() => fixture.service.revokePolicy(prisma, fixture.governance.authentication, input)));
  assert.deepEqual(results.map((value) => value.idempotent).sort(), [false, true]);
  assert.deepEqual(results[0].revocation, results[1].revocation);
  const [counts] = await prisma.$queryRaw`
    SELECT (SELECT count(*)::text FROM "r8_incentive_policy_revocations" WHERE "policyHash" = ${fixture.candidate.policyHash}) AS "events",
      (SELECT count(*)::text FROM "r8_incentive_authorizations" WHERE "commandHash" = ${results[0].authorization.commandHash}) AS "commands"
  `;
  assert.deepEqual(counts, { events: '1', commands: '1' });
  await rejectAtomically(() => fixture.service.revokePolicy(prisma, fixture.governance.authentication,
    revocationInput(fixture)), /R8_POLICY_ALREADY_REVOKED/);
  await rejectAtomically(() => fixture.service.revokePolicy(prisma, fixture.governance.authentication,
    revocationInput(fixture, { candidate: fixture.candidates[1], commandChanges: {
      nonce: fixture.registrationInput.commandEvidence.nonce,
    } })), /R8_COMMAND_REPLAY/);
  await rejectAtomically(() => fixture.service.revokePolicy(prisma, fixture.governance.authentication,
    { ...input, signature: 'A'.repeat(86) }), /R8_COMMAND_REPLAY/);
});

test('R8 revocation: wrong owner, unpinned key, missing exact action and invalid signature leave no evidence', async () => {
  const fixture = await prepareRevocationProgram(prisma);
  await rejectAtomically(() => fixture.service.revokePolicy(prisma, fixture.executor.authentication,
    revocationInput(fixture, { actor: fixture.executor })), /R8_TRUST_DENIED/);
  for (const scopes of [['incentive.policy.publish'], ['*']]) {
    const actor = await actorWithMandate(prisma, fixture.governance, scopes);
    await rejectAtomically(() => fixture.service.revokePolicy(prisma, actor.authentication,
      revocationInput(fixture, { actor })), /action|R8_EXPLICIT_ACTION_REQUIRED/i);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const signingKeyId = unique('unpinned-revoke-key');
  await prisma.agentCredential.create({ data: { agentIdentityId: fixture.governance.agent.id,
    kind: 'signing', keyId: signingKeyId, publicKeyJwk: publicKey.export({ format: 'jwk' }), algorithm: 'EdDSA' } });
  const otherKey = { ...fixture.governance, privateKey, signingKeyId };
  await rejectAtomically(() => fixture.service.revokePolicy(prisma, otherKey.authentication,
    revocationInput(fixture, { actor: otherKey })), /R8_TRUST_DENIED/);
  const input = revocationInput(fixture);
  await rejectAtomically(() => fixture.service.revokePolicy(prisma, fixture.governance.authentication,
    { ...input, signature: 'A'.repeat(86) }), /INCENTIVE_SIGNATURE_INVALID/);
  await rejectAtomically(() => fixture.service.revokePolicy(prisma, fixture.governance.authentication,
    { ...input, revocation: { ...input.revocation, reasonCode: 'operational' } }), /payload|SIGNATURE/i);
});

test('R8 revocation: committed replay survives root key revocation while new commands fail closed', async () => {
  const fixture = await prepareRevocationProgram(prisma, { versions: 2 });
  const input = revocationInput(fixture, { reasonCode: 'superseded' });
  const first = await fixture.service.revokePolicy(prisma, fixture.governance.authentication, input);
  await prisma.agentCredential.update({ where: { id: fixture.governance.signingCredential.id },
    data: { status: 'revoked', revokedAt: new Date() } });
  const state = await revocationState(prisma);
  const replay = await fixture.service.revokePolicy(prisma, fixture.governance.authentication, input);
  assert.equal(replay.idempotent, true);
  assert.deepEqual(replay.revocation, first.revocation);
  assert.deepEqual(await revocationState(prisma), state);
  await rejectAtomically(() => fixture.service.revokePolicy(prisma, fixture.governance.authentication,
    revocationInput(fixture, { candidate: fixture.candidates[1] })), /R8_GOVERNANCE_REVOKED/);
});

test('R8 revocation: database event is append-only and direct new bindings see the immediate policy guard', async () => {
  const fixture = await prepareRevocationProgram(prisma);
  const terminal = await createTerminalSettlement(prisma, 'revoke-sql-guard');
  const award = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication,
    revocationAwardInput(fixture, terminal));
  const result = await fixture.service.revokePolicy(prisma, fixture.governance.authentication, revocationInput(fixture));
  await rejectAtomically(() => prisma.$executeRaw`
    UPDATE "r8_incentive_policy_revocations" SET "reasonCode" = 'operational' WHERE "id" = ${result.revocation.id}
  `, /R8_APPEND_ONLY/);
  await rejectAtomically(() => prisma.$executeRaw`
    DELETE FROM "r8_incentive_policy_revocations" WHERE "id" = ${result.revocation.id}
  `, /R8_APPEND_ONLY/);
  // Clone an otherwise-valid historical binding. The specific revocation
  // error must happen before duplicate-key checks can obscure a missing gate.
  await rejectAtomically(() => prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(4921178337::bigint)::text`;
    await tx.$executeRaw`
      INSERT INTO "r8_incentive_award_bindings"
      SELECT * FROM "r8_incentive_award_bindings" WHERE "id" = ${award.binding.id}
    `;
  }), /R8_POLICY_REVOKED/);
});

test('R8 revocation: insert failure rolls back snapshot, authorization and nonce so the exact command can retry', async () => {
  const fixture = await prepareRevocationProgram(prisma);
  const input = revocationInput(fixture, { reasonCode: 'operational' });
  const suffix = Math.random().toString(16).slice(2);
  const name = `test_r8_revocation_failure_${suffix}`;
  const quote = (value) => `'${value.replaceAll("'", "''")}'`;
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN
    IF NEW."programId" = ${quote(fixture.programId)} THEN RAISE EXCEPTION 'PRIVATE_R8_REVOCATION_FAILURE'; END IF;
    RETURN NEW; END; $$ LANGUAGE plpgsql`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} BEFORE INSERT ON "r8_incentive_policy_revocations"
      FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    await rejectAtomically(() => fixture.service.revokePolicy(prisma, fixture.governance.authentication, input),
      /PRIVATE_R8_REVOCATION_FAILURE/);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "r8_incentive_policy_revocations"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
  }
  const retried = await fixture.service.revokePolicy(prisma, fixture.governance.authentication, input);
  assert.equal(retried.idempotent, false);
  assert.equal(retried.authorization.nonce, input.commandEvidence.nonce);
});

test('R8 revocation: award and revoke race has only the two serializable economic outcomes', async () => {
  const fixture = await prepareRevocationProgram(prisma);
  const terminal = await createTerminalSettlement(prisma, 'revoke-race');
  const input = revocationAwardInput(fixture, terminal);
  const [award, revoke] = await Promise.allSettled([
    fixture.service.awardForSettlement(prisma, fixture.executor.authentication, input),
    fixture.service.revokePolicy(prisma, fixture.governance.authentication, revocationInput(fixture)),
  ]);
  assert.equal(revoke.status, 'fulfilled');
  const [counts] = await prisma.$queryRaw`
    SELECT count(*)::text AS "bindings" FROM "r8_incentive_award_bindings" WHERE "programId" = ${fixture.programId}
  `;
  if (award.status === 'fulfilled') {
    assert.equal(counts.bindings, '1');
    const replay = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, input);
    assert.equal(replay.idempotent, true);
    assert.deepEqual(replay.binding, award.value.binding);
  } else {
    assert.match(diagnostic(award.reason), /R8_POLICY_REVOKED/);
    assert.equal(counts.bindings, '0');
  }
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication,
    revocationAwardInput(fixture, terminal)), /R8_POLICY_REVOKED/);
});

for (const immediate of [false, true]) {
test(`R8 revocation: ${immediate ? 'immediate constraint inside a savepoint' : 'deferred constraint'} rolls back an award when valid revocation follows its binding`, async () => {
  const fixture = await prepareRevocationProgram(prisma);
  const terminal = await createTerminalSettlement(prisma, 'revoke-deferred-gate');
  const actor = await actorWithMandate(prisma, fixture.governance, ['incentive.policy.revoke']);
  const input = revocationInput(fixture, { actor });
  const payload = buildPolicyRevocationPayload(input.revocation);
  // A real resolver and signature check produce this historical snapshot.
  // The test trigger stages the authorization and its revocation together in
  // the award transaction, satisfying the reverse deferred receipt invariant.
  const prepared = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(4921178337::bigint)::text`;
    const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS "now"`;
    const proof = validateSignedCommand({ commandEvidence: input.commandEvidence,
      signature: input.signature, publicKeyJwk: actor.publicKeyJwk,
      expectedAction: payload.action, payload, now });
    const authority = await resolveAuthority(tx, { mandateId: actor.mandate.id,
      subjectAgentIdentityId: actor.agent.id, action: payload.action, at: now });
    const snapshot = await captureAuthoritySnapshot(tx, bindAuthorityToAuthentication(actor.authentication, authority), {
      action: payload.action, commandHash: proof.commandHash, payloadHash: proof.payloadHash,
      nonce: input.commandEvidence.nonce, signingCredentialId: actor.signingCredential.id,
      signingKeyId: actor.signingKeyId, signatureAlgorithm: 'EdDSA', economic: null,
    }, now);
    return { proof, snapshot };
  });
  const evidence = { ...input.revocation, authorizationId: prepared.proof.commandHash };
  const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;
  const suffix = Math.random().toString(16).slice(2);
  const name = `test_r8_deferred_revoke_${suffix}`;
  const commandValues = [prepared.proof.commandHash, fixture.programId, payload.action, actor.principal.id,
    actor.agent.id, actor.apiCredential.id, actor.signingCredential.id, prepared.snapshot.id,
    input.commandEvidence.nonce, JSON.stringify(input.commandEvidence), JSON.stringify(payload), input.signature];
  const eventValues = [prepared.proof.commandHash, fixture.programId, fixture.candidate.policyHash,
    prepared.proof.commandHash, 'security', JSON.stringify(evidence), sha256Evidence(evidence)];
  await prisma.$executeRawUnsafe(`CREATE FUNCTION ${name}() RETURNS trigger AS $$ BEGIN
    IF NEW."programId" = ${literal(fixture.programId)} THEN
      INSERT INTO "r8_incentive_authorizations" ("commandHash","programId","action","principalId","agentIdentityId",
        "accessCredentialId","signingCredentialId","authoritySnapshotId","nonce","commandEvidence","payload","signature")
        VALUES (${commandValues.map((value, index) => literal(value) + ([9, 10].includes(index) ? '::jsonb' : '')).join(',')});
      INSERT INTO "r8_incentive_policy_revocations" ("id","programId","policyHash","authorizationId","reasonCode","evidence","revocationHash")
        VALUES (${eventValues.map((value, index) => literal(value) + (index === 5 ? '::jsonb' : '')).join(',')});
    END IF; RETURN NEW; END; $$ LANGUAGE plpgsql`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER ${name} AFTER INSERT ON "r8_incentive_award_bindings"
      FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    // A caller may change a deferrable constraint to immediate and write inside
    // a savepoint. Revocation must still reject a binding from the same outer
    // transaction even though its immediate binding check has already passed.
    const database = immediate ? { $transaction: (callback, options) => prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SET CONSTRAINTS r8_binding_policy_active_at_commit IMMEDIATE`;
      await tx.$executeRaw`SAVEPOINT r8_revocation_award_savepoint`;
      const result = await callback(tx);
      await tx.$executeRaw`RELEASE SAVEPOINT r8_revocation_award_savepoint`;
      return result;
    }, options) } : prisma;
    await rejectAtomically(() => fixture.service.awardForSettlement(database, fixture.executor.authentication,
      revocationAwardInput(fixture, terminal)), /R8_POLICY_REVOKED/);
  } finally {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON "r8_incentive_award_bindings"`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
  }
  // Both the rejected award command and trigger's revocation command vanished.
  const retried = await fixture.service.revokePolicy(prisma, actor.authentication, input);
  assert.equal(retried.idempotent, false);
});
}
