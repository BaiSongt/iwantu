import assert from 'node:assert/strict';
import { sha256Evidence } from '../../src/lib/authority/authority-snapshot.mjs';
import { createIncentiveGovernanceService } from '../../src/lib/incentives/governance-service.mjs';
import {
  amountUnits, buildAwardPayload, buildPolicyPayload, buildRegistrationPayload,
  normalizePolicy, normalizeRegistration,
} from '../../src/lib/incentives/governance-protocol.mjs';
import { fundProtocolIncentivePool } from '../../src/lib/ledger/credit-foundation.mjs';
import { createActor, signCommand, unique } from './incentive-governance-fixtures.mjs';
import { createObservationTerminal } from './incentive-observation-terminal-fixtures.mjs';

// One actual Supplier earns rewards from independently owned Buyer Contracts.
// Both the high-reward shadow case and its low-reward control use the same
// signed M3-M5 facts; only the published discretionary reward amount changes.
export async function prepareShadowFixture(prisma, { rewardAmountIwc = '30.00000000', settlementCount = 5 } = {}) {
  assert.ok(Number.isInteger(settlementCount) && settlementCount >= 1 && settlementCount <= 500);
  assert.ok(amountUnits(rewardAmountIwc) * BigInt(settlementCount) <= amountUnits('1000.00000000'));
  const programId = unique('r8-shadow');
  const governance = await createActor(prisma, 'shadow-governance', [
    'incentive.program.register', 'incentive.policy.publish', 'incentive.policy.revoke',
  ]);
  const executor = await createActor(prisma, 'shadow-executor', ['incentive.award.issue']);
  const commonSupplier = await createActor(prisma, 'shadow-common-supplier', ['offer.issue', 'delivery.submit']);
  const trustedEntry = {
    governancePrincipalId: governance.principal.id, governanceSigningKeyId: governance.signingKeyId,
    governanceKeyHash: sha256Evidence(governance.publicKeyJwk), awardIssuerPrincipalId: executor.principal.id,
    maximumBudgetIwc: '1000.00000000',
  };
  const trustedPrograms = { [programId]: trustedEntry };
  const service = createIncentiveGovernanceService({ trustedPrograms });
  const registration = { protocol: 'iwantu.incentive-program-registration/0.1', programId, budgetIwc: '1000.00000000' };
  const registrationInput = { registration, ...signCommand(governance, 'incentive.program.register',
    buildRegistrationPayload(normalizeRegistration(registration, trustedEntry))) };
  await fundProtocolIncentivePool(prisma, { budgetRef: unique('shadow-pool'), amount: '2000.00000000' });
  const registered = await service.registerProgram(prisma, governance.authentication, registrationInput);
  const candidate = normalizePolicy({
    protocol: 'iwantu.incentive-program-policy/0.2', programId, policyVersion: 'v1',
    issuerPrincipalId: governance.principal.id, triggerType: 'terminal_settlement',
    eligibleSettlementTypes: ['full_settlement'], beneficiaryRole: 'supplier', awardSlot: 'completion',
    rewardFormula: { kind: 'fixed_amount', amountIwc: rewardAmountIwc },
    effectiveFrom: new Date(registered.program.createdAt).toISOString(),
    effectiveUntil: new Date(Date.now() + 86_400_000).toISOString(),
    deduplicationScope: 'program_settlement_role_slot',
  });
  const published = await service.publishPolicy(prisma, governance.authentication, {
    policy: candidate.policy, ...signCommand(governance, 'incentive.policy.publish', buildPolicyPayload(candidate)),
  });
  const terminals = [];
  const awards = [];
  for (let index = 0; index < settlementCount; index += 1) {
    const terminal = await createObservationTerminal(prisma, `shadow-${index}`, 'full_settlement', { supplier: commonSupplier });
    const payload = buildAwardPayload({
      programId, policyHash: candidate.policyHash, settlementId: terminal.settlement.id,
      settlementHash: terminal.settlement.settlementHash, beneficiaryPrincipalId: commonSupplier.principal.id,
      beneficiaryRole: 'supplier', awardSlot: 'completion', amountIwc: rewardAmountIwc,
    });
    const input = { programId, policyHash: candidate.policyHash, settlementId: terminal.settlement.id,
      ...signCommand(executor, 'incentive.award.issue', payload) };
    const result = await service.awardForSettlement(prisma, executor.authentication, input);
    terminals.push(terminal);
    awards.push({ candidate, input, result });
  }
  assert.equal(new Set(terminals.map((terminal) => terminal.buyer.principal.id)).size, settlementCount);
  const postedTimes = awards.map(({ result }) => new Date(result.ledgerTransaction.postedAt).getTime());
  return {
    programId, governance, executor, commonSupplier, trustedEntry, trustedPrograms, service,
    registrationInput, registered, candidate, published, terminals, awards,
    input: { programId, windowStart: new Date(Math.min(...postedTimes) - 1).toISOString(),
      windowEnd: new Date(Math.max(...postedTimes) + 1).toISOString() },
  };
}
