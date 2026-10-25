import { sha256Evidence } from '../../src/lib/authority/authority-snapshot.mjs';
import { createIncentiveGovernanceService } from '../../src/lib/incentives/governance-service.mjs';
import {
  buildAwardPayload, buildPolicyPayload, buildPolicyRevocationPayload,
  buildRegistrationPayload, normalizePolicy, normalizeRegistration,
} from '../../src/lib/incentives/governance-protocol.mjs';
import { fundProtocolIncentivePool } from '../../src/lib/ledger/credit-foundation.mjs';
import { createActor, signCommand, unique } from './incentive-governance-fixtures.mjs';

export async function prepareRevocationProgram(prisma, { versions = 1 } = {}) {
  const programId = unique('r8-revoke');
  const governance = await createActor(prisma, 'revoke-governance', [
    'incentive.program.register', 'incentive.policy.publish', 'incentive.policy.revoke',
  ]);
  const executor = await createActor(prisma, 'revoke-executor', ['incentive.award.issue']);
  const trustedEntry = {
    governancePrincipalId: governance.principal.id, governanceSigningKeyId: governance.signingKeyId,
    governanceKeyHash: sha256Evidence(governance.publicKeyJwk),
    awardIssuerPrincipalId: executor.principal.id, maximumBudgetIwc: '10.00000000',
  };
  const trustedPrograms = { [programId]: trustedEntry };
  const service = createIncentiveGovernanceService({ trustedPrograms });
  const registration = { protocol: 'iwantu.incentive-program-registration/0.1', programId, budgetIwc: '10.00000000' };
  const registrationInput = { registration, ...signCommand(governance, 'incentive.program.register',
    buildRegistrationPayload(normalizeRegistration(registration, trustedEntry))) };
  await fundProtocolIncentivePool(prisma, { budgetRef: unique('revoke-pool'), amount: '20.00000000' });
  const registered = await service.registerProgram(prisma, governance.authentication, registrationInput);
  const fixture = { programId, governance, executor, trustedEntry, trustedPrograms, service,
    registered, registrationInput, candidates: [] };
  for (let index = 1; index <= versions; index += 1) {
    const candidate = normalizePolicy({
      protocol: 'iwantu.incentive-program-policy/0.2', programId, policyVersion: `v${index}`,
      issuerPrincipalId: governance.principal.id, triggerType: 'terminal_settlement',
      eligibleSettlementTypes: ['full_settlement'], beneficiaryRole: 'supplier', awardSlot: 'completion',
      rewardFormula: { kind: 'fixed_amount', amountIwc: '1.00000000' },
      effectiveFrom: new Date(registered.program.createdAt).toISOString(),
      effectiveUntil: new Date(Date.now() + 86_400_000).toISOString(),
      deduplicationScope: 'program_settlement_role_slot',
    });
    await service.publishPolicy(prisma, governance.authentication, {
      policy: candidate.policy, ...signCommand(governance, 'incentive.policy.publish', buildPolicyPayload(candidate)),
    });
    fixture.candidates.push(candidate);
  }
  fixture.candidate = fixture.candidates[0];
  return fixture;
}

export function revocationInput(fixture, { candidate = fixture.candidate,
  actor = fixture.governance, reasonCode = 'security', commandChanges = {} } = {}) {
  const revocation = { protocol: 'iwantu.incentive-policy-revocation/0.1',
    programId: fixture.programId, policyHash: candidate.policyHash, reasonCode };
  return { revocation, ...signCommand(actor, 'incentive.policy.revoke',
    buildPolicyRevocationPayload(revocation), commandChanges) };
}

export function revocationAwardInput(fixture, terminal, candidate = fixture.candidate) {
  const payload = buildAwardPayload({
    programId: fixture.programId, policyHash: candidate.policyHash, settlementId: terminal.settlement.id,
    settlementHash: terminal.settlement.settlementHash, beneficiaryPrincipalId: terminal.supplier.principal.id,
    beneficiaryRole: 'supplier', awardSlot: 'completion', amountIwc: candidate.policy.rewardFormula.amountIwc,
  });
  return { programId: fixture.programId, policyHash: candidate.policyHash, settlementId: terminal.settlement.id,
    ...signCommand(fixture.executor, 'incentive.award.issue', payload) };
}

// Keep the pinned governance identity/key while independently testing a live,
// exact action Mandate whose authority contains no monetary commitment.
export async function actorWithMandate(prisma, actor, actionScopes, economicLimits = {}) {
  const mandate = await prisma.mandate.create({ data: {
    mandateFamilyId: unique('revoke-mandate-family'), version: 1,
    issuerPrincipalId: actor.principal.id, subjectAgentIdentityId: actor.agent.id,
    actionScopes, capabilityScopes: ['*'], economicLimits, resourcePolicy: {},
    dataPolicy: { rawDataAccess: false }, counterpartyPolicy: {},
    validFrom: new Date(Date.now() - 60_000), validUntil: new Date(Date.now() + 86_400_000),
    delegationAllowed: false, maxDelegationDepth: 0, payloadHash: sha256Evidence(unique('revoke-mandate')),
    signatureAlgorithm: 'EdDSA', signatureKeyId: unique('principal-key'), signature: unique('fixture-signature'),
  } });
  return { ...actor, mandate };
}

export async function revocationState(prisma) {
  const [state] = await prisma.$queryRaw`
    SELECT
      (SELECT count(*)::text FROM "r8_incentive_programs") AS "programs",
      (SELECT count(*)::text FROM "r8_incentive_policies") AS "policies",
      (SELECT count(*)::text FROM "r8_incentive_authorizations") AS "authorizations",
      (SELECT count(*)::text FROM "authority_snapshots") AS "snapshots",
      (SELECT count(*)::text FROM "r8_incentive_policy_revocations") AS "revocations",
      (SELECT count(*)::text FROM "r8_incentive_award_bindings") AS "bindings",
      (SELECT count(*)::text FROM "ledger_transactions") AS "transactions",
      (SELECT count(*)::text FROM "ledger_entries") AS "entries",
      (SELECT count(*)::text FROM "reputation_evidence") AS "reputationEvidence",
      (SELECT count(*)::text FROM "reputation_snapshots") AS "reputationSnapshots"
  `;
  return state;
}
