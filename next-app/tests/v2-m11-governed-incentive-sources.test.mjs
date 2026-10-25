import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import test from 'node:test';
import { buildAuthoritySnapshot, sha256Evidence } from '../src/lib/authority/authority-snapshot.mjs';
import { buildSettlementEvidence, hashSettlementEvidence } from '../src/lib/atomic-settlement.mjs';
import { hashFullRefundSettlementEvidence } from '../src/lib/supplier-default-refund.mjs';
import { hashMutualSplitSettlementEvidence } from '../src/lib/mutual-settlement.mjs';
import { buildCreditProvenance } from '../src/lib/ledger/credit-foundation.mjs';
import { buildLedgerPostingHash } from '../src/lib/ledger/ledger-posting.mjs';
import { buildEconomicCommandEvidence, hashEconomicCommandEvidence } from '../src/lib/signed-economic-command.mjs';
import {
  buildAwardPayload, buildPolicyPayload, buildRegistrationPayload, normalizePolicy, normalizeRegistration,
} from '../src/lib/incentives/governance-protocol.mjs';
import { readGovernedIncentiveAwardSources } from '../src/lib/integrity/governed-incentive-sources.mjs';

const INPUT = { programId: 'program', windowStart: '2026-10-25T00:00:00.000Z', windowEnd: '2026-10-26T00:00:00.000Z' };
const TIME = (hour) => new Date(`2026-10-25T${String(hour).padStart(2, '0')}:00:00.000Z`);
const SAFE_FIELDS = [
  'awardId', 'programId', 'policyHash', 'policyVersion', 'settlementId', 'settlementHash', 'settlementType',
  'settlementCreatedAt', 'beneficiaryRole', 'awardSlot', 'beneficiaryPrincipalId', 'counterpartyPrincipalId',
  'amountIwc', 'settlementGrossIwc', 'ledgerTransactionId', 'ledgerTransactionHash', 'receiptHash',
  'authorizationId', 'postedAt', 'policyRevokedAt',
];

function fixture(settlementType = 'full_settlement') {
  const keys = generateKeyPairSync('ed25519');
  const publicKeyJwk = keys.publicKey.export({ format: 'jwk' });
  const trusted = {
    governancePrincipalId: 'governor', governanceSigningKeyId: 'key', governanceKeyHash: sha256Evidence(publicKeyJwk),
    awardIssuerPrincipalId: 'executor', maximumBudgetIwc: '1000.00000000',
  };
  const registration = normalizeRegistration({
    protocol: 'iwantu.incentive-program-registration/0.1', programId: 'program', budgetIwc: '100.00000000',
  }, trusted);
  function proof(payload, principal, hour, amountIwc) {
    const commandEvidence = buildEconomicCommandEvidence({
      action: payload.action, principalId: principal, agentIdentityId: `${principal}-agent`, mandateId: 'mandate',
      payloadHash: sha256Evidence(payload), nonce: `nonce-${hour}`, issuedAt: TIME(hour).toISOString(),
      expiresAt: new Date(TIME(hour).getTime() + 5 * 60_000).toISOString(), signingKeyId: 'key', signatureAlgorithm: 'EdDSA',
    });
    const commandHash = hashEconomicCommandEvidence(commandEvidence);
    const access = { id: `${principal}-access`, keyId: `${principal}-access-key`, kind: 'api', agentIdentityId: `${principal}-agent`, status: 'revoked' };
    const snapshot = buildAuthoritySnapshot({
      kind: 'authenticated_authority_context', securityStage: 'identity_and_authority_resolved',
      authentication: { kind: 'v2_agent_credential', principal: { id: principal }, agent: { id: `${principal}-agent` }, credential: access },
      authority: { allowed: true, principalId: principal, subjectAgentIdentityId: `${principal}-agent`,
        mandateChain: [{ id: 'mandate', version: 1, payloadHash: 'e'.repeat(64) }], effective: { actionScopes: [payload.action] } },
    }, { action: payload.action, commandHash, payloadHash: commandEvidence.payloadHash, nonce: commandEvidence.nonce,
      signingCredentialId: `${principal}-credential`, signingKeyId: 'key', signatureAlgorithm: 'EdDSA',
      ...(payload.action === 'incentive.award.issue' ? { counterpartyPrincipalId: payload.beneficiaryPrincipalId } : {}),
      economic: { singleContract: amountIwc, currency: 'IWC' } }, TIME(hour));
    return {
      authorization: {
        commandHash, programId: 'program', action: payload.action, principalId: principal,
        agentIdentityId: `${principal}-agent`, signingCredentialId: `${principal}-credential`, nonce: `nonce-${hour}`,
        accessCredentialId: access.id, authoritySnapshotId: `snapshot-${hour}`,
        commandEvidence, payload, signature: sign(null, Buffer.from(commandHash, 'hex'), keys.privateKey).toString('base64url'),
      },
      authorizationCreatedAt: TIME(hour), signingPrincipalId: principal, access,
      authoritySnapshot: { id: `snapshot-${hour}`, ...snapshot },
      signing: {
        id: `${principal}-credential`, kind: 'signing', algorithm: 'EdDSA', keyId: 'key',
        agentIdentityId: `${principal}-agent`, publicKeyJwk,
        // These current statuses intentionally do not invalidate historical proof.
        status: 'revoked', expiresAt: TIME(0),
      },
    };
  }
  const registrationProof = proof(buildRegistrationPayload(registration), 'governor', 0, registration.budgetIwc);
  const program = { ...registration, registration, authorizationId: registrationProof.authorization.commandHash, createdAt: TIME(0) };
  const candidate = normalizePolicy({
    protocol: 'iwantu.incentive-program-policy/0.2', programId: 'program', policyVersion: 'v1',
    issuerPrincipalId: 'governor', triggerType: 'terminal_settlement', eligibleSettlementTypes: ['full_settlement', 'full_refund', 'mutual_split'],
    beneficiaryRole: 'supplier', awardSlot: 'completion', rewardFormula: { kind: 'fixed_amount', amountIwc: '1.00000000' },
    effectiveFrom: TIME(1).toISOString(), effectiveUntil: '2026-10-26T00:00:00.000Z',
    deduplicationScope: 'program_settlement_role_slot',
  });
  const policyProof = proof(buildPolicyPayload(candidate), 'governor', 1, candidate.policy.rewardFormula.amountIwc);
  const contract = {
    id: 'contract', effectiveContractHash: 'a'.repeat(64), lifecycleState: 'closed', escrowId: 'escrow',
    buyerPrincipalId: 'buyer', buyerAgentIdentityId: 'buyer-agent',
    supplierPrincipalId: 'supplier', supplierAgentIdentityId: 'supplier-agent',
  };
  const delivery = { id: 'delivery', contractId: 'contract', effectiveContractHash: contract.effectiveContractHash, deliveryHash: 'b'.repeat(64) };
  const acceptance = {
    id: 'acceptance', contractId: 'contract', deliveryId: 'delivery', effectiveContractHash: contract.effectiveContractHash,
    deliveryHash: delivery.deliveryHash, decisionHash: 'c'.repeat(64), decision: 'accept', source: 'auto_accept',
  };
  const isRefund = settlementType === 'full_refund';
  const isSplit = settlementType === 'mutual_split';
  const supplierAmount = isRefund ? '0.00000000' : isSplit ? '4.00000000' : '10.00000000';
  const buyerRefundAmount = isRefund ? '10.00000000' : isSplit ? '6.00000000' : '0';
  const referenceType = isRefund ? 'escrow_refund' : isSplit ? 'escrow_mutual_split' : 'escrow_release';
  const settlementLedger = { id: 'settlement-ledger', status: 'posted', type: isRefund ? 'refund' : 'settlement', referenceType,
    referenceId: contract.id, idempotencyKey: `escrow:release:${contract.id}`, metadata: { contractId: contract.id } };
  const settlementEntries = [
    { transactionId: settlementLedger.id, entryIndex: 0, accountId: 'locked', side: 'debit', amount: '10.00000000', provenance: null,
      accountType: 'principal_locked', accountPrincipalId: 'buyer', accountCurrency: 'IWC' },
    { transactionId: settlementLedger.id, entryIndex: 1, accountId: 'available', side: 'credit', amount: isRefund ? buyerRefundAmount : supplierAmount,
      accountType: 'principal_available', accountPrincipalId: isRefund ? 'buyer' : 'supplier', accountCurrency: 'IWC',
      provenance: buildCreditProvenance({ kind: isRefund ? 'refund' : 'earned', beneficiaryPrincipalId: isRefund ? 'buyer' : 'supplier', sourceReferenceType: referenceType,
        sourceReferenceId: contract.id, contractId: contract.id, earnedByAgentIdentityId: 'supplier-agent', originalLedgerTransactionId: 'lock-ledger' }) },
  ];
  if (isSplit) settlementEntries.push({ transactionId: settlementLedger.id, entryIndex: 2, accountId: 'buyer-available', side: 'credit', amount: buyerRefundAmount,
    accountType: 'principal_available', accountPrincipalId: 'buyer', accountCurrency: 'IWC', provenance: buildCreditProvenance({
      kind: 'refund', beneficiaryPrincipalId: 'buyer', sourceReferenceType: referenceType, sourceReferenceId: contract.id,
      contractId: contract.id, originalLedgerTransactionId: 'lock-ledger' }) });
  settlementLedger.transactionHash = buildLedgerPostingHash({ ...settlementLedger, entries: settlementEntries });
  const settlement = {
    id: 'settlement', contractId: 'contract', effectiveContractHash: contract.effectiveContractHash,
    supplierPrincipalId: 'supplier', supplierAgentIdentityId: 'supplier-agent', escrowId: 'escrow',
    type: settlementType, deliveryId: 'delivery', acceptanceDecisionId: 'acceptance', ledgerTransactionId: settlementLedger.id,
    supplierDefaultId: isRefund ? 'default' : null, disputeId: isSplit ? 'dispute' : null,
    mutualSettlementAgreementId: isSplit ? 'agreement' : null,
    allocation: { currency: 'IWC', grossAmount: '10.00000000', supplierAmount, buyerRefundAmount },
  };
  const supplierDefault = { id: 'default', contractId: contract.id, effectiveContractHash: contract.effectiveContractHash,
    supplierPrincipalId: 'supplier', supplierAgentIdentityId: 'supplier-agent', evidenceHash: 'd'.repeat(64) };
  const dispute = { id: 'dispute', contractId: contract.id, effectiveContractHash: contract.effectiveContractHash, disputeHash: 'f'.repeat(64) };
  const agreement = { id: 'agreement', contractId: contract.id, effectiveContractHash: contract.effectiveContractHash,
    disputeId: dispute.id, disputeHash: dispute.disputeHash, agreementHash: 'e'.repeat(64), buyerPrincipalId: 'buyer',
    supplierPrincipalId: 'supplier', currency: 'IWC', grossAmount: '10.00000000', supplierAmount, buyerRefundAmount };
  const settlementEvidence = {
    ...settlement, amount: settlement.allocation.grossAmount, currency: 'IWC', deliveryHash: delivery.deliveryHash,
    acceptanceDecisionHash: acceptance.decisionHash, acceptanceSource: acceptance.source, ledgerTransactionHash: settlementLedger.transactionHash,
  };
  settlement.settlementHash = isRefund ? hashFullRefundSettlementEvidence({ ...settlementEvidence,
    buyerPrincipalId: 'buyer', supplierDefaultHash: supplierDefault.evidenceHash })
    : isSplit ? hashMutualSplitSettlementEvidence({ ...settlementEvidence, ...settlement.allocation,
      disputeHash: dispute.disputeHash, agreementHash: agreement.agreementHash })
      : hashSettlementEvidence(buildSettlementEvidence(settlementEvidence));
  const payload = buildAwardPayload({
    programId: 'program', policyHash: candidate.policyHash, settlementId: settlement.id, settlementHash: settlement.settlementHash,
    beneficiaryPrincipalId: 'supplier', beneficiaryRole: 'supplier', awardSlot: 'completion', amountIwc: '1.00000000',
  });
  const awardProof = proof(payload, 'executor', 3, payload.amountIwc);
  const referenceId = `program:${payload.awardId}`;
  const provenance = buildCreditProvenance({ kind: 'incentive', beneficiaryPrincipalId: 'supplier',
    sourceReferenceType: 'protocol_incentive_award', sourceReferenceId: referenceId, programId: 'program', awardId: payload.awardId });
  const entries = [
    { transactionId: 'reward-ledger', entryIndex: 0, accountId: 'pool', side: 'debit', amount: '1.00000000', provenance: null,
      accountType: 'system_incentive', accountPrincipalId: null, accountCurrency: 'IWC' },
    { transactionId: 'reward-ledger', entryIndex: 1, accountId: 'available', side: 'credit', amount: '1.00000000', provenance,
      accountType: 'principal_available', accountPrincipalId: 'supplier', accountCurrency: 'IWC' },
  ];
  const ledgerTransaction = {
    id: 'reward-ledger', type: 'incentive', status: 'posted', referenceType: 'protocol_incentive_award', referenceId,
    idempotencyKey: `credit:incentive-award:${referenceId}`,
    metadata: { programId: 'program', awardId: payload.awardId, beneficiaryPrincipalId: 'supplier',
      details: { policyHash: candidate.policyHash, settlementId: settlement.id, authorizationId: awardProof.authorization.commandHash } },
  };
  ledgerTransaction.transactionHash = buildLedgerPostingHash({ ...ledgerTransaction, entries });
  const receiptPayload = { ...payload };
  delete receiptPayload.action;
  delete receiptPayload.currency;
  const receipt = { ...receiptPayload, protocol: 'iwantu.incentive-award-receipt/0.1',
    ledgerTransactionId: ledgerTransaction.id, ledgerTransactionHash: ledgerTransaction.transactionHash,
    authorizationId: awardProof.authorization.commandHash };
  const row = {
    id: payload.awardId, awardId: payload.awardId, programId: 'program', policyHash: candidate.policyHash,
    settlementId: 'settlement', beneficiaryRole: 'supplier', awardSlot: 'completion', beneficiaryPrincipalId: 'supplier',
    amountIwc: '1.00000000', ledgerTransactionId: ledgerTransaction.id, authorizationId: awardProof.authorization.commandHash,
    receipt, receiptHash: sha256Evidence(receipt), postedAt: TIME(3), settlementCreatedAt: TIME(2), policyCreatedAt: TIME(1),
    policyRevokedAt: TIME(4), policyRow: { ...candidate, programId: 'program', policyVersion: 'v1', authorizationId: policyProof.authorization.commandHash },
    settlement, contract, delivery, acceptance, settlementLedger, ledgerTransaction, supplierDefault, dispute, agreement,
  };
  const terminalEvidence = ['transaction', 'economic'].map((evidenceClass) => {
    const evidence = { settlementId: settlement.id, settlementHash: settlement.settlementHash, subjectRole: 'supplier' };
    return { settlementId: settlement.id, contractId: contract.id, subjectRole: 'supplier', evidenceClass,
      subjectPrincipalId: 'supplier', subjectAgentIdentityId: 'supplier-agent', counterpartyPrincipalId: 'buyer',
      counterpartyAgentIdentityId: 'buyer-agent', occurredAt: TIME(2), evidence, expectedEvidence: evidence };
  });
  return { program, rows: [row], authorizations: [registrationProof, policyProof, awardProof],
    entries: [...entries, ...settlementEntries], terminalEvidence, count: '0' };
}

function client(data) {
  const calls = [];
  const query = async (sql, ...values) => {
    const text = Array.isArray(sql) ? sql.join('?') : sql.sql;
    calls.push({ text, values });
    if (text.startsWith('SET')) return 0;
    if (text.includes('count(*)::text')) return [{ count: data.count }];
    if (text.includes('FROM "r8_incentive_programs"')) return data.program ? [data.program] : [];
    if (text.includes('FROM "r8_incentive_award_bindings"')) return data.rows;
    if (text.includes('FROM "r8_incentive_authorizations"')) return data.authorizations;
    if (text.includes('FROM "ledger_entries"')) return data.entries;
    if (text.includes('FROM "reputation_evidence"')) return data.terminalEvidence;
    throw new Error('Unexpected query');
  };
  return { calls, async $transaction(work, options) {
    assert.equal(options.isolationLevel, 'RepeatableRead');
    return work({ $queryRaw: query, $executeRaw: query });
  } };
}

test('R8 sources: historically verifies signatures and canonical Ledger evidence in one read-only snapshot', async () => {
  const data = fixture();
  const prisma = client(data);
  const result = await readGovernedIncentiveAwardSources(prisma, INPUT);
  assert.equal(result.unboundPostedCandidateCount, 0);
  assert.equal(result.records.length, 1);
  const record = result.records[0];
  assert.deepEqual(Object.keys(record), SAFE_FIELDS);
  assert.equal(record.counterpartyPrincipalId, 'buyer');
  assert.equal(record.amountIwc, '1.00000000');
  assert.equal(record.settlementGrossIwc, '10.00000000');
  assert.equal(record.policyRevokedAt, TIME(4).toISOString());
  assert.equal(prisma.calls[0].text, 'SET TRANSACTION READ ONLY');
  for (const { text } of prisma.calls.slice(1)) {
    assert.doesNotMatch(text, /FOR\s+(?:UPDATE|SHARE)|pg_advisory|\b(?:INSERT|UPDATE|DELETE)\b/i);
  }
  const awardQuery = prisma.calls.find(({ text }) => text.includes('FROM "r8_incentive_award_bindings"'));
  assert.match(awardQuery.text, /LEFT JOIN "settlements"/);
  assert.match(awardQuery.text, /AT TIME ZONE 'UTC'/);
  assert.ok(awardQuery.values.includes(INPUT.windowStart));
  assert.ok(awardQuery.values.includes(501));
});

test('R8 sources: subsequent revocation does not alter a closed historical window', async () => {
  const data = fixture();
  data.rows[0].policyRevokedAt = new Date(INPUT.windowEnd);
  const result = await readGovernedIncentiveAwardSources(client(data), INPUT);
  assert.equal(result.records[0].policyRevokedAt, null);
});

test('R8 sources: verifies full refund and mutual split canonical terminal proofs and allocations', async (t) => {
  for (const settlementType of ['full_refund', 'mutual_split']) {
    await t.test(settlementType, async () => {
      const data = fixture(settlementType);
      const { records } = await readGovernedIncentiveAwardSources(client(data), INPUT);
      assert.equal(records[0].settlementType, settlementType);
      assert.equal(records[0].settlementGrossIwc, '10.00000000');
      const credit = data.entries.find((entry) => entry.transactionId === 'settlement-ledger' && entry.entryIndex === 1);
      credit.accountPrincipalId = 'attacker';
      await assert.rejects(readGovernedIncentiveAwardSources(client(data), INPUT), { code: 'R8_OBSERVATION_INVALID' });
    });
  }
});

test('R8 sources: rejects invalid windows and limits before database access', async () => {
  for (const patch of [
    { windowStart: '2026-10-25T00:00:00Z' }, { windowEnd: INPUT.windowStart },
    { windowEnd: '2026-11-26T00:00:00.000Z' }, { programId: 'program:spoof' },
    { limit: 0 }, { limit: 501 }, { limit: '500' }, { limit: null }, { unknown: true },
  ]) {
    const prisma = client(fixture());
    await assert.rejects(readGovernedIncentiveAwardSources(prisma, { ...INPUT, ...patch }), { code: 'R8_INPUT_INVALID' });
    assert.equal(prisma.calls.length, 0);
  }
});

test('R8 sources: registered Program is required and legacy postings remain unbound', async () => {
  const missing = fixture();
  missing.program = null;
  await assert.rejects(readGovernedIncentiveAwardSources(client(missing), INPUT), { code: 'R8_PROGRAM_NOT_FOUND' });
  const data = fixture();
  data.rows = [];
  data.count = '2';
  assert.deepEqual(await readGovernedIncentiveAwardSources(client(data), INPUT), { records: [], unboundPostedCandidateCount: 2 });
});

test('R8 sources: unbound audit covers every writer candidate and every explicit Program association', async () => {
  const data = fixture();
  data.rows = [];
  data.count = '4';
  const prisma = client(data);
  const result = await readGovernedIncentiveAwardSources(prisma, INPUT);
  assert.deepEqual(result, { records: [], unboundPostedCandidateCount: 4 });
  const { text, values } = prisma.calls.find((call) => call.text.includes('count(*)::text'));
  assert.match(text, /t\."type" = 'incentive' OR t\."referenceType" = 'protocol_incentive_award'/);
  assert.match(text, /t\."metadata" ->> 'creditSource' = 'incentive'/);
  assert.match(text, /e\."side" = 'debit' AND a\."type" = 'system_incentive'/);
  assert.match(text, /e\."provenance" ->> 'kind' = 'incentive'/);
  assert.match(text, /e\."provenance" ->> 'sourceReferenceType' = 'protocol_incentive_award'/);
  assert.match(text, /t\."metadata" ->> 'programId'/);
  assert.match(text, /split_part\(t\."referenceId", ':', 1\)/);
  assert.match(text, /e\."provenance" ->> 'programId'/);
  assert.match(text, /NOT EXISTS[\s\S]*b\."ledgerTransactionId" = t\."id" AND b\."programId"/);
  assert.equal(values.filter((value) => value === INPUT.programId).length, 4);
  assert.ok(values.includes(INPUT.windowStart) && values.includes(INPUT.windowEnd));
  // Broad candidates consume the same total bound even without a governed row.
  await assert.rejects(readGovernedIncentiveAwardSources(client(data), { ...INPUT, limit: 3 }),
    { code: 'R8_OBSERVATION_LIMIT_EXCEEDED' });
});

test('R8 sources: fails closed when governed awards plus legacy candidates exceed the bound', async () => {
  const data = fixture();
  data.count = '1';
  await assert.rejects(readGovernedIncentiveAwardSources(client(data), { ...INPUT, limit: 1 }), { code: 'R8_OBSERVATION_LIMIT_EXCEEDED' });
  data.count = '0';
  data.rows.push(data.rows[0]);
  await assert.rejects(readGovernedIncentiveAwardSources(client(data), { ...INPUT, limit: 1 }), { code: 'R8_OBSERVATION_LIMIT_EXCEEDED' });
});

test('R8 sources: rejects forged policy, registration, signatures, Ledger, receipts and M9 attribution', async (t) => {
  const corruptions = {
    'policy hash': (d) => { d.rows[0].policyRow.policyHash = '0'.repeat(64); },
    'registration hash': (d) => { d.program.configurationHash = '0'.repeat(64); },
    'registration signature': (d) => { d.authorizations[0].authorization.signature = 'A'.repeat(86); },
    'policy signature': (d) => { d.authorizations[1].authorization.signature = 'A'.repeat(86); },
    'award signature': (d) => { d.authorizations[2].authorization.signature = 'A'.repeat(86); },
    'award signer ownership': (d) => { d.authorizations[2].signingPrincipalId = 'attacker'; },
    'authority chain digest': (d) => { d.authorizations[2].authoritySnapshot.authorityChainHash = '0'.repeat(64); },
    'authority snapshot digest': (d) => { d.authorizations[2].authoritySnapshot.evidenceHash = '0'.repeat(64); },
    'authority command linkage': (d) => { d.authorizations[2].authoritySnapshot.requestEvidence.commandHash = '0'.repeat(64); },
    'authority access identity': (d) => { d.authorizations[2].access.agentIdentityId = 'attacker'; },
    'terminal Ledger hash': (d) => { d.rows[0].settlementLedger.transactionHash = '0'.repeat(64); },
    'terminal Ledger amount': (d) => { d.entries[2].amount = '11.00000000'; },
    '64hex Ledger hash': (d) => { d.rows[0].ledgerTransaction.transactionHash = '0'.repeat(64); },
    'Ledger amount': (d) => { d.entries[0].amount = '2.00000000'; },
    'Ledger beneficiary': (d) => { d.entries[1].accountPrincipalId = 'attacker'; },
    'provenance': (d) => { d.entries[1].provenance = { ...d.entries[1].provenance, beneficiaryPrincipalId: 'attacker' }; },
    'receipt hash': (d) => { d.rows[0].receiptHash = '0'.repeat(64); },
    'receipt extra field': (d) => { d.rows[0].receipt = { ...d.rows[0].receipt, leaked: true }; },
    'contract beneficiary': (d) => { d.rows[0].contract.supplierPrincipalId = 'attacker'; },
    'settlement hash': (d) => { d.rows[0].settlement.settlementHash = '0'.repeat(64); },
    'settlement evidence': (d) => { d.rows[0].acceptance.source = 'forged'; },
    'missing M9': (d) => { d.terminalEvidence.pop(); },
    'M9 counterparty': (d) => { d.terminalEvidence[0].counterpartyPrincipalId = 'attacker'; },
    'M9 settlement hash': (d) => { d.terminalEvidence[0].evidence = { ...d.terminalEvidence[0].evidence, settlementHash: '0'.repeat(64) }; },
    'missing related Ledger': (d) => { d.rows[0].ledgerTransaction = null; },
    'malformed count': (d) => { d.count = '1e3'; },
  };
  for (const [name, corrupt] of Object.entries(corruptions)) {
    await t.test(name, async () => {
      const data = fixture();
      corrupt(data);
      await assert.rejects(readGovernedIncentiveAwardSources(client(data), INPUT), { code: 'R8_OBSERVATION_INVALID' });
    });
  }
});
