import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { readGovernedIncentiveAwardSources } from '../src/lib/integrity/governed-incentive-sources.mjs';
import { buildIncentiveObservation } from '../src/lib/integrity/incentive-observation.mjs';
import { buildAwardPayload, buildPolicyPayload, normalizePolicy } from '../src/lib/incentives/governance-protocol.mjs';
import { signCommand, unique } from './helpers/incentive-governance-fixtures.mjs';
import { prepareRevocationProgram, revocationInput } from './helpers/incentive-policy-revocation-fixtures.mjs';
import {
  assertObservation, observationState, prepareObservationFixture,
} from './helpers/incentive-observation-fixtures.mjs';
import { createObservationTerminal } from './helpers/incentive-observation-terminal-fixtures.mjs';
import { requireR8PostgresTestTarget } from './helpers/r8-postgres-test-target.mjs';

const prisma = new PrismaClient();
let connected = false;
let fixture;
before(async () => {
  requireR8PostgresTestTarget();
  await prisma.$connect();
  connected = true;
  fixture = await prepareObservationFixture(prisma);
});
after(async () => { if (connected) await prisma.$disconnect(); });

async function observe(client = prisma, input = fixture.input) {
  return buildIncentiveObservation(input, await readGovernedIncentiveAwardSources(client, input));
}

test('R8 observation: genuine terminal awards produce exact money, stable sorted evidence and deduplicated settlement gross', async () => {
  const state = await observationState(prisma);
  const first = await observe();
  assertObservation(first, fixture);
  assert.deepEqual(await observe(), first);
  assert.deepEqual(await observationState(prisma), state, 'observation must not write protocol, Ledger, reputation or signals');
});

test('R8 observation: other Program awards and unrelated legacy postings are excluded from verified and unbound sources', async () => {
  const source = await readGovernedIncentiveAwardSources(prisma, fixture.input);
  assert.equal(source.unboundPostedCandidateCount, 0);
  assert.equal(source.records.length, 2);
  assert.ok(source.records.every((record) => record.programId === fixture.programId));
  assert.ok(source.records.every((record) => record.awardId !== fixture.otherAward.binding.awardId));
  assert.ok(source.records.every((record) => record.ledgerTransactionId !== fixture.legacyAward.id));
});

test('R8 observation: postedAt window is inclusive/exclusive UTC even in a non-UTC database session', async () => {
  const first = await observe();
  const earliest = first.records[0].postedAt;
  const latest = first.records.at(-1).postedAt;
  const beforeEarliest = { ...fixture.input, windowEnd: earliest };
  const fromLatest = { ...fixture.input, windowStart: latest };
  const nonUtcDatabase = { $transaction: (callback, options) => prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL TIME ZONE 'Pacific/Auckland'`;
    return callback(tx);
  }, options) };
  const results = { full: await observe(nonUtcDatabase), before: await observe(nonUtcDatabase, beforeEarliest),
    from: await observe(nonUtcDatabase, fromLatest) };
  assert.deepEqual(results.full, first);
  assert.equal(results.before.records.length, 0, 'endExclusive excludes awards posted exactly at the end');
  assert.equal(results.before.attribution.state, 'empty');
  assert.equal(results.before.metrics.totalAwardIwc, '0.00000000');
  assert.deepEqual(results.from.records, first.records.filter((record) => record.postedAt >= latest));
});

test('R8 observation: reader fails closed at a real source cap without truncation or protocol writes', async () => {
  const state = await observationState(prisma);
  await assert.rejects(() => readGovernedIncentiveAwardSources(prisma, { ...fixture.input, limit: 1 }),
    (error) => error.code === 'R8_OBSERVATION_LIMIT_EXCEEDED');
  const exact = await readGovernedIncentiveAwardSources(prisma, { ...fixture.input, limit: 2 });
  assert.equal(exact.records.length, 2);
  for (const changes of [{ limit: 0 }, { limit: 501 }, { limit: 1.5 },
    { windowEnd: fixture.input.windowStart }, { windowStart: '2026-10-25T00:00:00+08:00' }]) {
    await assert.rejects(() => readGovernedIncentiveAwardSources(prisma, { ...fixture.input, ...changes }),
      (error) => error.code === 'R8_INPUT_INVALID');
  }
  await assert.rejects(() => readGovernedIncentiveAwardSources(prisma, { ...fixture.input, programId: unique('missing') }),
    (error) => error.code === 'R8_PROGRAM_NOT_FOUND');
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 observation: exact command replays cannot duplicate observed source awards or alter the fingerprint', async () => {
  const first = await observe();
  const state = await observationState(prisma);
  for (const { input, result } of fixture.awards) {
    const replay = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, input);
    assert.equal(replay.idempotent, true);
    assert.deepEqual(replay.binding, result.binding);
  }
  assert.deepEqual(await observe(), first);
  assert.deepEqual(await observationState(prisma), state);
});

test('R8 observation: later policy/root key revocation preserves historical proofs and only a later window includes revocation context', async () => {
  const original = await observe();
  const revoked = await fixture.service.revokePolicy(prisma, fixture.governance.authentication, revocationInput(fixture));
  assert.ok(new Date(revoked.revocation.createdAt).getTime() >= new Date(fixture.input.windowEnd).getTime());
  await prisma.agentCredential.update({ where: { id: fixture.governance.signingCredential.id },
    data: { status: 'revoked', revokedAt: new Date() } });
  const state = await observationState(prisma);
  assert.deepEqual(await observe(), original, 'future revocation must not rewrite a fixed historical observation');
  const laterInput = { ...fixture.input, windowEnd: new Date(Date.now() + 1_000).toISOString() };
  const later = await observe(prisma, laterInput);
  assert.deepEqual(later.metrics, original.metrics);
  assert.notEqual(later.evidenceFingerprint, original.evidenceFingerprint);
  for (const record of later.records) {
    assert.equal(record.policyRevokedAt, record.policyHash === fixture.candidate.policyHash
      ? new Date(revoked.revocation.createdAt).toISOString() : null);
  }
  assert.deepEqual(await observationState(prisma), state);
});

for (const type of ['full_refund', 'mutual_split']) {
  test(`R8 observation: a genuine ${type} terminal award verifies its allocation, M9 evidence and exact gross without writes`, async () => {
    const program = await prepareRevocationProgram(prisma);
    const beneficiaryRole = type === 'full_refund' ? 'buyer' : 'supplier';
    const candidate = normalizePolicy({ ...program.candidate.policy, policyVersion: type,
      eligibleSettlementTypes: [type], beneficiaryRole, awardSlot: 'resolution' });
    await program.service.publishPolicy(prisma, program.governance.authentication, {
      policy: candidate.policy,
      ...signCommand(program.governance, 'incentive.policy.publish', buildPolicyPayload(candidate)),
    });
    const terminal = await createObservationTerminal(prisma, `observation-${type}`, type);
    const beneficiary = beneficiaryRole === 'buyer' ? terminal.buyer : terminal.supplier;
    const counterparty = beneficiaryRole === 'buyer' ? terminal.supplier : terminal.buyer;
    const payload = buildAwardPayload({ programId: program.programId, policyHash: candidate.policyHash,
      settlementId: terminal.settlement.id, settlementHash: terminal.settlement.settlementHash,
      beneficiaryPrincipalId: beneficiary.principal.id, beneficiaryRole, awardSlot: 'resolution',
      amountIwc: '1.00000000' });
    const award = await program.service.awardForSettlement(prisma, program.executor.authentication, {
      programId: program.programId, policyHash: candidate.policyHash, settlementId: terminal.settlement.id,
      ...signCommand(program.executor, 'incentive.award.issue', payload),
    });
    const time = new Date(award.ledgerTransaction.postedAt).getTime();
    const input = { programId: program.programId, windowStart: new Date(time - 1).toISOString(),
      windowEnd: new Date(time + 1).toISOString() };
    const state = await observationState(prisma);
    const observation = await observe(prisma, input);
    assert.deepEqual(observation.metrics, { verifiedAwardCount: 1, distinctRewardedSettlementCount: 1,
      beneficiaryPrincipalCount: 1, totalAwardIwc: '1.00000000', totalRewardedSettlementGrossIwc: '25.50000000' });
    assert.equal(observation.attribution.state, 'verified');
    assert.equal(observation.records.length, 1);
    const [record] = observation.records;
    assert.equal(record.settlementType, type);
    assert.equal(record.settlementId, terminal.settlement.id);
    assert.equal(record.settlementHash, terminal.settlement.settlementHash);
    assert.equal(record.settlementGrossIwc, '25.50000000');
    assert.equal(record.beneficiaryRole, beneficiaryRole);
    assert.equal(record.beneficiaryPrincipalId, beneficiary.principal.id);
    assert.equal(record.counterpartyPrincipalId, counterparty.principal.id);
    assert.equal(record.policyHash, candidate.policyHash);
    assert.equal(record.ledgerTransactionHash, award.ledgerTransaction.transactionHash);
    assert.equal(record.receiptHash, award.binding.receiptHash);
    assert.equal(observation.byBeneficiary[0].principalId, beneficiary.principal.id);
    assert.deepEqual(await observe(prisma, input), observation);
    assert.deepEqual(await observationState(prisma), state);
  });
}
