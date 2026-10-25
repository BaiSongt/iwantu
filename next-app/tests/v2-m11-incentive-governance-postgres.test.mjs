import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { Prisma, PrismaClient } from '@prisma/client';
import { createIncentiveGovernanceService } from '../src/lib/incentives/governance-service.mjs';
import {
  amountUnits, buildAwardPayload, buildPolicyPayload, buildRegistrationPayload,
  formatUnits, normalizePolicy, normalizeRegistration,
} from '../src/lib/incentives/governance-protocol.mjs';
import { sha256Evidence } from '../src/lib/authority/authority-snapshot.mjs';
import { awardProtocolIncentive } from '../src/lib/ledger/incentive-awards.mjs';
import { fundProtocolIncentivePool } from '../src/lib/ledger/credit-foundation.mjs';
import { requireR8PostgresTestTarget } from './helpers/r8-postgres-test-target.mjs';
import { createActor, createTerminalSettlement, signCommand, unique } from './helpers/incentive-governance-fixtures.mjs';

const prisma = new PrismaClient();
let connected = false;
before(async () => {
  requireR8PostgresTestTarget();
  await prisma.$connect();
  connected = true;
});
after(async () => { if (connected) await prisma.$disconnect(); });

async function economicState() {
  const [state] = await prisma.$queryRaw`
    SELECT
      (SELECT count(*)::text FROM "r8_incentive_programs") AS "programs",
      (SELECT count(*)::text FROM "r8_incentive_policies") AS "policies",
      (SELECT count(*)::text FROM "r8_incentive_authorizations") AS "authorizations",
      (SELECT count(*)::text FROM "r8_incentive_award_bindings") AS "bindings",
      (SELECT count(*)::text FROM "ledger_transactions") AS "transactions",
      (SELECT count(*)::text FROM "ledger_entries") AS "entries"
  `;
  return state;
}

async function rejectAtomically(operation, pattern) {
  const before = await economicState();
  await assert.rejects(operation, (error) => {
    if (pattern) assert.match(`${error.code ?? ''} ${error.message}`, pattern);
    return true;
  });
  assert.deepEqual(await economicState(), before, 'rejected operation must leave all economic facts unchanged');
}

function policyFor(fixture, changes = {}) {
  const now = Date.now();
  return normalizePolicy({
    protocol: 'iwantu.incentive-program-policy/0.2', programId: fixture.programId,
    policyVersion: 'v1', issuerPrincipalId: fixture.governance.principal.id,
    triggerType: 'terminal_settlement', eligibleSettlementTypes: ['full_settlement'],
    beneficiaryRole: 'supplier', awardSlot: 'completion',
    rewardFormula: { kind: 'fixed_amount', amountIwc: fixture.reward },
    effectiveFrom: new Date(fixture.registered?.program.createdAt ?? now).toISOString(),
    effectiveUntil: new Date(now + 86_400_000).toISOString(),
    deduplicationScope: 'program_settlement_role_slot', ...changes,
  });
}

async function prepareProgram({ budget = '10.00000000', reward = '1.00000000', fund = '20.00000000',
  governanceActions = ['incentive.program.register', 'incentive.policy.publish'],
  executorActions = ['incentive.award.issue'], executorLimits,
  trustChanges = {}, register = true, publish = true,
} = {}) {
  const programId = unique('r8-governed');
  const governance = await createActor(prisma, 'governance', governanceActions,
    { singleContract: budget, currency: 'IWC' });
  const executor = await createActor(prisma, 'executor', executorActions,
    executorLimits ?? { singleContract: budget, currency: 'IWC' });
  const trustedEntry = {
    governancePrincipalId: governance.principal.id, governanceSigningKeyId: governance.signingKeyId,
    governanceKeyHash: sha256Evidence(governance.publicKeyJwk),
    awardIssuerPrincipalId: executor.principal.id, maximumBudgetIwc: budget, ...trustChanges,
  };
  const trustedPrograms = { [programId]: trustedEntry };
  const service = createIncentiveGovernanceService({ trustedPrograms });
  const fixture = { programId, governance, executor, trustedEntry, trustedPrograms, service, reward };
  const registration = { protocol: 'iwantu.incentive-program-registration/0.1', programId, budgetIwc: budget };
  const registrationPayload = buildRegistrationPayload(normalizeRegistration(registration, trustedEntry));
  fixture.registrationInput = { registration, ...signCommand(governance, 'incentive.program.register', registrationPayload) };
  if (fund) await fundProtocolIncentivePool(prisma, { budgetRef: unique('r8-funded-pool'), amount: fund });
  if (register) fixture.registered = await service.registerProgram(prisma, governance.authentication, fixture.registrationInput);
  fixture.candidate = policyFor(fixture);
  fixture.policyInput = { policy: fixture.candidate.policy,
    ...signCommand(governance, 'incentive.policy.publish', buildPolicyPayload(fixture.candidate)) };
  if (publish) fixture.published = await service.publishPolicy(prisma, governance.authentication, fixture.policyInput);
  return fixture;
}

function awardInput(fixture, terminal, candidate = fixture.candidate, actor = fixture.executor, payloadChanges = {}) {
  const payload = buildAwardPayload({
    programId: fixture.programId, policyHash: candidate.policyHash, settlementId: terminal.settlement.id,
    settlementHash: terminal.settlement.settlementHash,
    beneficiaryPrincipalId: candidate.policy.beneficiaryRole === 'supplier'
      ? terminal.supplier.principal.id : terminal.buyer.principal.id,
    beneficiaryRole: candidate.policy.beneficiaryRole, awardSlot: candidate.policy.awardSlot,
    amountIwc: candidate.policy.rewardFormula.amountIwc, ...payloadChanges,
  });
  return {
    programId: fixture.programId, policyHash: candidate.policyHash, settlementId: terminal.settlement.id,
    ...signCommand(actor, 'incentive.award.issue', payload),
  };
}

async function publishCandidate(fixture, changes) {
  const candidate = policyFor(fixture, changes);
  await fixture.service.publishPolicy(prisma, fixture.governance.authentication, {
    policy: candidate.policy,
    ...signCommand(fixture.governance, 'incentive.policy.publish', buildPolicyPayload(candidate)),
  });
  return candidate;
}

test('R8 governance: disabled configuration, wrong Principal and unpinned key cannot register', async () => {
  const fixture = await prepareProgram({ register: false, publish: false });
  const disabled = createIncentiveGovernanceService();
  await rejectAtomically(() => disabled.registerProgram(
    prisma, fixture.governance.authentication, fixture.registrationInput,
  ), /CONFIG|TRUST|disabled/i);
  await rejectAtomically(() => disabled.publishPolicy(
    prisma, fixture.governance.authentication, fixture.policyInput,
  ), /CONFIG|TRUST|disabled/i);
  await rejectAtomically(() => fixture.service.registerProgram(
    prisma, fixture.executor.authentication, fixture.registrationInput,
  ));
  const wrongKey = createIncentiveGovernanceService({ trustedPrograms: {
    [fixture.programId]: { ...fixture.trustedEntry, governanceKeyHash: 'f'.repeat(64) },
  } });
  const registration = fixture.registrationInput.registration;
  const changedPayload = buildRegistrationPayload(normalizeRegistration(registration,
    { ...fixture.trustedEntry, governanceKeyHash: 'f'.repeat(64) }));
  await rejectAtomically(() => wrongKey.registerProgram(prisma, fixture.governance.authentication, {
    registration, ...signCommand(fixture.governance, 'incentive.program.register', changedPayload),
  }));
});

test('R8 governance: exact registration/policy replays converge to immutable receipts', async () => {
  const fixture = await prepareProgram();
  const state = await economicState();
  const registered = await fixture.service.registerProgram(prisma, fixture.governance.authentication, fixture.registrationInput);
  const published = await fixture.service.publishPolicy(prisma, fixture.governance.authentication, fixture.policyInput);
  assert.equal(registered.idempotent, true);
  assert.equal(published.idempotent, true);
  assert.equal(registered.program.programId, fixture.programId);
  assert.equal(published.policy.policyHash, fixture.candidate.policyHash);
  assert.deepEqual(await economicState(), state);
  for (const [table, field] of [
    ['r8_incentive_programs', 'budgetIwc'], ['r8_incentive_policies', 'policyHash'],
    ['r8_incentive_authorizations', 'commandHash'],
  ]) {
    await assert.rejects(prisma.$executeRaw(Prisma.sql`
      UPDATE ${Prisma.raw(`"${table}"`)} SET ${Prisma.raw(`"${field}"`)} = ${Prisma.raw(`"${field}"`)}
      WHERE "programId" = ${fixture.programId}
    `));
    await assert.rejects(prisma.$executeRaw(Prisma.sql`
      DELETE FROM ${Prisma.raw(`"${table}"`)} WHERE "programId" = ${fixture.programId}
    `));
  }
  assert.deepEqual(await economicState(), state);
});

test('R8 governance: pre-existing unbound Program spend cannot be silently adopted or rewritten', async () => {
  const fixture = await prepareProgram({ register: false, publish: false });
  const historical = await awardProtocolIncentive(prisma, {
    principalId: fixture.executor.principal.id, programId: fixture.programId,
    awardId: unique('r8-before-registration'), amount: '1.00000000',
  });
  assert.equal(historical.status, 'posted');
  await rejectAtomically(() => fixture.service.registerProgram(prisma, fixture.governance.authentication,
    fixture.registrationInput), /HISTORY|history|legacy|migration/i);
  const preserved = await prisma.ledgerTransaction.findUnique({ where: { id: historical.id } });
  assert.equal(preserved.transactionHash, historical.transactionHash);
  assert.deepEqual(preserved.metadata, historical.metadata);
});

test('R8 governance: signature tampering, action substitution and nonce reuse fail atomically', async () => {
  const fixture = await prepareProgram({ register: false, publish: false });
  await rejectAtomically(() => fixture.service.registerProgram(prisma, fixture.governance.authentication, {
    ...fixture.registrationInput, signature: Buffer.alloc(64).toString('base64url'),
  }), /SIGNATURE|signature/i);
  await rejectAtomically(() => fixture.service.registerProgram(prisma, fixture.governance.authentication, {
    ...fixture.registrationInput,
    commandEvidence: { ...fixture.registrationInput.commandEvidence, action: 'incentive.award.issue' },
  }));
  fixture.registered = await fixture.service.registerProgram(prisma, fixture.governance.authentication, fixture.registrationInput);
  const conflicting = { ...fixture.registrationInput.registration, budgetIwc: '9.00000000' };
  const payload = buildRegistrationPayload(normalizeRegistration(conflicting, fixture.trustedEntry));
  await rejectAtomically(() => fixture.service.registerProgram(prisma, fixture.governance.authentication, {
    registration: conflicting, ...signCommand(fixture.governance, 'incentive.program.register', payload,
      { nonce: fixture.registrationInput.commandEvidence.nonce }),
  }));
  const publication = policyFor(fixture);
  await rejectAtomically(() => fixture.service.publishPolicy(prisma, fixture.governance.authentication, {
    policy: publication.policy,
    ...signCommand(fixture.governance, 'incentive.policy.publish', buildPolicyPayload(publication),
      { nonce: fixture.registrationInput.commandEvidence.nonce }),
  }), /REPLAY|nonce/i);
});

test('R8 governance: publication requires its exact Mandate action and active governance credential', async () => {
  const fixture = await prepareProgram({ governanceActions: ['incentive.program.register', '*'], publish: false });
  await rejectAtomically(() => fixture.service.publishPolicy(prisma, fixture.governance.authentication, fixture.policyInput));
  const revoked = await prepareProgram({ publish: false });
  await prisma.agentCredential.update({ where: { id: revoked.governance.apiCredential.id },
    data: { status: 'revoked', revokedAt: new Date() } });
  await rejectAtomically(() => revoked.service.publishPolicy(prisma, revoked.governance.authentication, revoked.policyInput));
});

test('R8 governance: policy cannot rewrite an existing version or change the configured issuer', async () => {
  const fixture = await prepareProgram();
  const changed = policyFor(fixture, { rewardFormula: { kind: 'fixed_amount', amountIwc: '2.00000000' } });
  await rejectAtomically(() => fixture.service.publishPolicy(prisma, fixture.governance.authentication, {
    policy: changed.policy,
    ...signCommand(fixture.governance, 'incentive.policy.publish', buildPolicyPayload(changed)),
  }));
  const wrongIssuer = policyFor(fixture, { policyVersion: 'wrong-issuer', issuerPrincipalId: fixture.executor.principal.id });
  await rejectAtomically(() => fixture.service.publishPolicy(prisma, fixture.governance.authentication, {
    policy: wrongIssuer.policy,
    ...signCommand(fixture.governance, 'incentive.policy.publish', buildPolicyPayload(wrongIssuer)),
  }));
});

test('R8 atomic award: real Settlement determines beneficiary and concurrent replay pays exactly once', async () => {
  const fixture = await prepareProgram({ reward: '0.00000001' });
  const terminal = await createTerminalSettlement(prisma, 'r8-concurrent-award');
  const input = awardInput(fixture, terminal);
  const before = await economicState();
  const [left, right] = await Promise.all([
    fixture.service.awardForSettlement(prisma, fixture.executor.authentication, input),
    fixture.service.awardForSettlement(prisma, fixture.executor.authentication, input),
  ]);
  assert.equal(left.binding.id, right.binding.id);
  assert.equal(left.ledgerTransaction.id, right.ledgerTransaction.id);
  assert.equal(left.binding.beneficiaryPrincipalId, terminal.supplier.principal.id);
  assert.equal(left.binding.amountIwc, '0.00000001');
  assert.equal(left.ledgerTransaction.status, 'posted');
  const replay = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, input);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.binding.id, left.binding.id);
  const state = await economicState();
  assert.equal(BigInt(state.bindings) - BigInt(before.bindings), 1n);
  assert.equal(BigInt(state.authorizations) - BigInt(before.authorizations), 1n);
  assert.equal(BigInt(state.transactions) - BigInt(before.transactions), 1n);
  assert.equal(BigInt(state.entries) - BigInt(before.entries), 2n);
  const entries = await prisma.ledgerEntry.findMany({ where: { transactionId: left.ledgerTransaction.id },
    include: { account: true }, orderBy: { entryIndex: 'asc' } });
  assert.deepEqual(entries.map((entry) => [entry.side, entry.amount.toFixed(8)]),
    [['debit', '0.00000001'], ['credit', '0.00000001']]);
  assert.equal(entries[0].account.type, 'system_incentive');
  assert.equal(entries[1].account.principalId, terminal.supplier.principal.id);
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication, {
    ...input, beneficiaryPrincipalId: fixture.executor.principal.id,
  }));
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication,
    awardInput(fixture, terminal, fixture.candidate, fixture.executor,
      { beneficiaryPrincipalId: fixture.executor.principal.id })));
  await assert.rejects(prisma.$executeRaw`UPDATE "r8_incentive_award_bindings" SET "id" = "id" WHERE "id" = ${left.binding.id}`);
  await assert.rejects(prisma.$executeRaw`DELETE FROM "r8_incentive_award_bindings" WHERE "id" = ${left.binding.id}`);
  assert.deepEqual(await economicState(), state);
});

test('R8 atomic award: cross-version stable entitlement cannot pay twice', async () => {
  const fixture = await prepareProgram();
  const second = await publishCandidate(fixture, { policyVersion: 'v2' });
  const terminal = await createTerminalSettlement(prisma, 'r8-cross-version');
  await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, awardInput(fixture, terminal));
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication,
    awardInput(fixture, terminal, second)), /ENTITLEMENT|entitlement|already/i);
});

test('R8 atomic award: Buyer and Supplier role entitlements derive different recipients from one immutable Settlement', async () => {
  const fixture = await prepareProgram();
  const buyerPolicy = await publishCandidate(fixture, { policyVersion: 'buyer-v1', beneficiaryRole: 'buyer' });
  const terminal = await createTerminalSettlement(prisma, 'r8-buyer-supplier-roles');
  const reputationBefore = await prisma.$queryRaw`
    SELECT * FROM "reputation_evidence" WHERE "contractId" = ${terminal.contract.id} ORDER BY "id"
  `;
  const supplier = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, awardInput(fixture, terminal));
  const buyer = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, awardInput(fixture, terminal, buyerPolicy));
  assert.notEqual(supplier.binding.id, buyer.binding.id);
  assert.equal(supplier.binding.beneficiaryPrincipalId, terminal.supplier.principal.id);
  assert.equal(buyer.binding.beneficiaryPrincipalId, terminal.buyer.principal.id);
  const credited = await prisma.ledgerEntry.findFirst({
    where: { transactionId: buyer.ledgerTransaction.id, side: 'credit' }, include: { account: true },
  });
  assert.equal(credited.account.principalId, terminal.buyer.principal.id);
  assert.deepEqual(await prisma.$queryRaw`
    SELECT * FROM "reputation_evidence" WHERE "contractId" = ${terminal.contract.id} ORDER BY "id"
  `, reputationBefore, 'incentives must not rewrite or fabricate ReputationEvidence');
});

test('R8 atomic award: suspended beneficiary blocks new payouts while exact committed replay remains readable', async () => {
  const fixture = await prepareProgram();
  const paidSource = await createTerminalSettlement(prisma, 'r8-suspend-after-award');
  const paidInput = awardInput(fixture, paidSource);
  const paid = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, paidInput);
  await prisma.principal.update({ where: { id: paidSource.supplier.principal.id }, data: { status: 'suspended' } });
  const committedState = await economicState();
  const replay = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, paidInput);
  assert.equal(replay.idempotent, true);
  assert.equal(replay.binding.id, paid.binding.id);
  assert.equal(replay.ledgerTransaction.id, paid.ledgerTransaction.id);
  assert.deepEqual(await economicState(), committedState);

  const unpaidSource = await createTerminalSettlement(prisma, 'r8-suspend-before-award');
  await prisma.principal.update({ where: { id: unpaidSource.supplier.principal.id }, data: { status: 'suspended' } });
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication,
    awardInput(fixture, unpaidSource)), /BENEFICIARY|beneficiary|active/i);
});

test('R8 atomic award: shared Program budget survives a policy version change', async () => {
  const fixture = await prepareProgram({ budget: '1.00000000', reward: '0.60000000' });
  const second = await publishCandidate(fixture, { policyVersion: 'v2' });
  const firstTerminal = await createTerminalSettlement(prisma, 'r8-budget-first');
  const secondTerminal = await createTerminalSettlement(prisma, 'r8-budget-second');
  await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, awardInput(fixture, firstTerminal));
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication,
    awardInput(fixture, secondTerminal, second)), /BUDGET|budget/i);
});

test('R8 atomic award: wrong actor, missing exact action, amount limit, signature and live revocation are enforced', async () => {
  const fixture = await prepareProgram();
  const terminal = await createTerminalSettlement(prisma, 'r8-authorization');
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.governance.authentication,
    awardInput(fixture, terminal, fixture.candidate, fixture.governance)));
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication,
    { ...awardInput(fixture, terminal), signature: Buffer.alloc(64).toString('base64url') }));
  for (const options of [
    { executorActions: ['incentive.policy.publish'] },
    { executorActions: ['*'] },
    { executorLimits: { singleContract: '0.50000000', currency: 'IWC' } },
    { executorLimits: { singleContract: 1000, currency: 'IWC' } },
    { executorLimits: { singleContract: '10.00000000', currency: 'USD' } },
  ]) {
    const denied = await prepareProgram(options);
    const source = await createTerminalSettlement(prisma, 'r8-denied-authority');
    await rejectAtomically(() => denied.service.awardForSettlement(prisma, denied.executor.authentication, awardInput(denied, source)));
  }
  await prisma.mandateRevocation.create({ data: {
    mandateId: fixture.executor.mandate.id, revokedByPrincipalId: fixture.executor.principal.id,
    reasonCode: 'TEST_REVOKED', payloadHash: sha256Evidence({ revoked: fixture.executor.mandate.id }),
    signatureAlgorithm: 'EdDSA', signatureKeyId: unique('revocation-key'), signature: 'fixture-revocation',
  } });
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication, awardInput(fixture, terminal)));
  const revokedRoot = await prepareProgram();
  const rootSource = await createTerminalSettlement(prisma, 'r8-revoked-root');
  await prisma.agentCredential.update({ where: { id: revokedRoot.governance.signingCredential.id },
    data: { status: 'revoked', revokedAt: new Date() } });
  await rejectAtomically(() => revokedRoot.service.awardForSettlement(prisma, revokedRoot.executor.authentication,
    awardInput(revokedRoot, rootSource)), /REVOKED|revoked|live/i);
});

test('R8 atomic award: publication is prospective and settlement eligibility is derived from stored facts', async () => {
  const historical = await createTerminalSettlement(prisma, 'r8-pre-publication');
  const fixture = await prepareProgram();
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication, awardInput(fixture, historical)));
  const ineligible = await publishCandidate(fixture,
    { policyVersion: 'refund-only', eligibleSettlementTypes: ['full_refund'] });
  const terminal = await createTerminalSettlement(prisma, 'r8-ineligible-source');
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication,
    awardInput(fixture, terminal, ineligible)));
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication,
    { ...awardInput(fixture, terminal), settlementId: unique('missing-settlement') }));
});

test('R8 atomic award: registered Program cannot bypass governed authorization through legacy M2 awards', async () => {
  const fixture = await prepareProgram();
  const terminal = await createTerminalSettlement(prisma, 'r8-legacy-bypass');
  await rejectAtomically(() => awardProtocolIncentive(prisma, {
    principalId: terminal.supplier.principal.id, programId: fixture.programId,
    awardId: unique('unsigned-legacy-award'), amount: fixture.reward,
  }), /R8|GOVERN|authoriz|binding/i);
});

test('R8 atomic award: failed binding insert rolls back its authorization, double entries and payment', async () => {
  const fixture = await prepareProgram();
  const terminal = await createTerminalSettlement(prisma, 'r8-receipt-rollback');
  const input = awardInput(fixture, terminal);
  await prisma.$executeRawUnsafe(`CREATE FUNCTION "r8_test_fail_binding_insert"() RETURNS trigger LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'R8_TEST_BINDING_INSERT_FAILURE'; END; $$`);
  try {
    await prisma.$executeRawUnsafe(`CREATE TRIGGER "r8_test_fail_binding" BEFORE INSERT ON "r8_incentive_award_bindings"
      FOR EACH ROW EXECUTE FUNCTION "r8_test_fail_binding_insert"()`);
    await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication, input),
      /R8_TEST_BINDING_INSERT_FAILURE/);
  } finally {
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS "r8_test_fail_binding" ON "r8_incentive_award_bindings"');
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "r8_test_fail_binding_insert"()');
  }
  const result = await fixture.service.awardForSettlement(prisma, fixture.executor.authentication, input);
  assert.equal(result.idempotent, false, 'failed attempt must not consume the command nonce');
});

test('R8 atomic award: finite system pool overdraft fails without consuming Program budget or nonce', async () => {
  const [pool] = await prisma.$queryRaw`
    SELECT COALESCE(SUM(CASE WHEN e."side" = 'credit' THEN e."amount" ELSE -e."amount" END), 0)::numeric(36,8)::text AS "balance"
    FROM "ledger_accounts" a JOIN "ledger_entries" e ON e."accountId" = a."id"
    JOIN "ledger_transactions" t ON t."id" = e."transactionId"
    WHERE a."type" = 'system_incentive' AND t."status" = 'posted'
  `;
  const tooMuch = formatUnits(amountUnits(pool.balance, true) + 1n);
  const fixture = await prepareProgram({ budget: tooMuch, reward: tooMuch, fund: null });
  const terminal = await createTerminalSettlement(prisma, 'r8-pool-overdraft');
  await rejectAtomically(() => fixture.service.awardForSettlement(prisma, fixture.executor.authentication,
    awardInput(fixture, terminal)), /OVERDRAFT|overdraft|funds/i);
});
