import assert from 'node:assert/strict';
import { buildAwardPayload, buildPolicyPayload, normalizePolicy } from '../../src/lib/incentives/governance-protocol.mjs';
import { awardProtocolIncentive } from '../../src/lib/ledger/incentive-awards.mjs';
import { createTerminalSettlement, signCommand, unique } from './incentive-governance-fixtures.mjs';
import { prepareRevocationProgram, revocationState } from './incentive-policy-revocation-fixtures.mjs';

export async function prepareObservationFixture(prisma) {
  const fixture = await prepareRevocationProgram(prisma);
  fixture.other = await prepareRevocationProgram(prisma);
  const bonus = normalizePolicy({ ...fixture.candidate.policy, policyVersion: 'completion-bonus',
    awardSlot: 'bonus', rewardFormula: { kind: 'fixed_amount', amountIwc: '0.00000001' } });
  await fixture.service.publishPolicy(prisma, fixture.governance.authentication, {
    policy: bonus.policy, ...signCommand(fixture.governance, 'incentive.policy.publish', buildPolicyPayload(bonus)),
  });
  fixture.candidates.push(bonus);
  fixture.terminal = await createTerminalSettlement(prisma, 'observation-real-terminal');
  fixture.awards = [];
  for (const candidate of fixture.candidates) {
    const payload = buildAwardPayload({ programId: fixture.programId, policyHash: candidate.policyHash,
      settlementId: fixture.terminal.settlement.id, settlementHash: fixture.terminal.settlement.settlementHash,
      beneficiaryPrincipalId: fixture.terminal.supplier.principal.id, beneficiaryRole: 'supplier',
      awardSlot: candidate.policy.awardSlot, amountIwc: candidate.policy.rewardFormula.amountIwc });
    const input = { programId: fixture.programId, policyHash: candidate.policyHash,
      settlementId: fixture.terminal.settlement.id, ...signCommand(fixture.executor, 'incentive.award.issue', payload) };
    const result = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, input);
    fixture.awards.push({ candidate, input, result });
  }
  // The same actual terminal fact also earns a different Program's legitimate
  // award. Neither that payment nor this unrelated legacy payment may leak
  // into this Program's observation or unbound candidate count.
  const other = fixture.other;
  const otherPayload = buildAwardPayload({ programId: other.programId, policyHash: other.candidate.policyHash,
    settlementId: fixture.terminal.settlement.id, settlementHash: fixture.terminal.settlement.settlementHash,
    beneficiaryPrincipalId: fixture.terminal.supplier.principal.id, beneficiaryRole: 'supplier',
    awardSlot: 'completion', amountIwc: '1.00000000' });
  fixture.otherAward = await other.service.awardForSettlement(prisma, other.executor.authentication, {
    programId: other.programId, policyHash: other.candidate.policyHash, settlementId: fixture.terminal.settlement.id,
    ...signCommand(other.executor, 'incentive.award.issue', otherPayload),
  });
  fixture.legacyProgramId = unique('observation-unrelated-legacy');
  fixture.legacyAward = await awardProtocolIncentive(prisma, {
    principalId: fixture.terminal.supplier.principal.id, programId: fixture.legacyProgramId,
    awardId: unique('legacy-award'), amount: '0.50000000',
  });
  const times = [...fixture.awards.map(({ result }) => result.ledgerTransaction.postedAt),
    fixture.otherAward.ledgerTransaction.postedAt, fixture.legacyAward.postedAt]
    .map((value) => new Date(value).getTime());
  fixture.input = { programId: fixture.programId,
    windowStart: new Date(Math.min(...times) - 1).toISOString(),
    windowEnd: new Date(Math.max(...times) + 1).toISOString() };
  return fixture;
}

export async function observationState(prisma) {
  const protocol = await revocationState(prisma);
  const [additional] = await prisma.$queryRaw`
    SELECT (SELECT count(*)::text FROM "integrity_signals") AS "integritySignals",
      (SELECT count(*)::text FROM "ledger_accounts") AS "accounts"
  `;
  return { ...protocol, ...additional };
}

export function assertObservation(observation, fixture) {
  assert.equal(observation.protocol, 'iwantu.incentive-observation/0.1');
  assert.equal(observation.programId, fixture.programId);
  assert.deepEqual(observation.observationWindow, { start: fixture.input.windowStart, endExclusive: fixture.input.windowEnd });
  assert.deepEqual(observation.metrics, { verifiedAwardCount: 2, distinctRewardedSettlementCount: 1,
    beneficiaryPrincipalCount: 1, totalAwardIwc: '1.00000001', totalRewardedSettlementGrossIwc: '25.50000000' });
  assert.deepEqual(observation.attribution, { state: 'verified', verifiedAwardCount: 2,
    unboundPostedCandidateCount: 0, legacyAttribution: 'unavailable' });
  assert.deepEqual(observation.riskAssessment, { state: 'not_evaluated', reason: 'rule_thresholds_not_frozen' });
  assert.equal(observation.automaticPunishmentApplied, false);
  assert.equal(observation.capitalLineageTraced, false);
  assert.match(observation.evidenceFingerprint, /^[0-9a-f]{64}$/);
  assert.equal(observation.records.length, 2);
  assert.deepEqual(observation.records.map((record) => record.awardId).sort(),
    fixture.awards.map(({ result }) => result.binding.awardId).sort());
  const sorted = [...observation.records].sort((left, right) =>
    left.postedAt.localeCompare(right.postedAt) || left.awardId.localeCompare(right.awardId));
  assert.deepEqual(observation.records, sorted);
  assert.deepEqual(observation.byBeneficiary, [{ principalId: fixture.terminal.supplier.principal.id,
    verifiedAwardCount: 2, distinctRewardedSettlementCount: 1, totalAwardIwc: '1.00000001',
    samePrincipalRewardedSettlementCount: 0, independentCounterpartyPrincipalCount: 1,
    topCounterpartySettlementCount: 1, topCounterpartySettlementShare: '1.00000000',
    policyHashes: fixture.candidates.map((candidate) => candidate.policyHash).sort(),
    roleSlotBreakdown: [
      { beneficiaryRole: 'supplier', awardSlot: 'bonus', verifiedAwardCount: 1,
        distinctRewardedSettlementCount: 1, totalAwardIwc: '0.00000001' },
      { beneficiaryRole: 'supplier', awardSlot: 'completion', verifiedAwardCount: 1,
        distinctRewardedSettlementCount: 1, totalAwardIwc: '1.00000000' },
    ],
  }]);
  for (const record of observation.records) {
    assert.equal(record.programId, fixture.programId);
    assert.equal(record.settlementId, fixture.terminal.settlement.id);
    assert.equal(record.settlementHash, fixture.terminal.settlement.settlementHash);
    assert.equal(record.settlementGrossIwc, '25.50000000');
    assert.equal(record.counterpartyPrincipalId, fixture.terminal.buyer.principal.id);
    assert.equal(record.beneficiaryPrincipalId, fixture.terminal.supplier.principal.id);
    assert.equal(record.policyRevokedAt, null);
  }
}
