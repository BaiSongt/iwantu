import { Prisma } from '@prisma/client';
import { sha256Evidence } from '../authority/authority-snapshot.mjs';
import { buildSettlementEvidence, hashSettlementEvidence } from '../atomic-settlement.mjs';
import { hashFullRefundSettlementEvidence } from '../supplier-default-refund.mjs';
import { hashMutualSplitSettlementEvidence } from '../mutual-settlement.mjs';
import { buildCreditProvenance } from '../ledger/credit-foundation.mjs';
import { buildLedgerPostingHash } from '../ledger/ledger-posting.mjs';
import {
  amountUnits, formatUnits, buildAwardPayload, buildPolicyPayload,
  buildRegistrationPayload, normalizePolicy, validateSignedCommand,
} from '../incentives/governance-protocol.mjs';
import { normalizeIncentiveObservationInput } from './incentive-observation.mjs';

export class GovernedIncentiveSourceError extends Error {
  constructor(code) {
    super(code === 'R8_INPUT_INVALID' ? 'Invalid incentive observation input'
      : code === 'R8_PROGRAM_NOT_FOUND' ? 'Registered incentive Program was not found'
        : code === 'R8_OBSERVATION_LIMIT_EXCEEDED' ? 'Incentive observation exceeds the source limit'
          : 'Stored incentive observation evidence is inconsistent');
    this.name = 'GovernedIncentiveSourceError';
    this.code = code;
  }
}

const deny = (code = 'R8_OBSERVATION_INVALID') => { throw new GovernedIncentiveSourceError(code); };
const requireFact = (condition) => { if (!condition) deny(); };
const same = (left, right) => sha256Evidence(left) === sha256Evidence(right);
const digest = (value) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);

function factTime(value) {
  // Raw TIMESTAMP columns are UTC Dates from Prisma. JSON projections of those
  // same columns omit a zone, so explicitly interpret only that DB form as UTC.
  const text = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?$/.test(value)
    ? `${value}Z` : value;
  const date = text instanceof Date ? text : new Date(text);
  requireFact(value !== null && value !== undefined && Number.isFinite(date.getTime()));
  return date;
}

function money(value, allowZero = false) {
  requireFact(typeof value === 'string' && /^(0|[1-9][0-9]{0,27})(?:\.[0-9]{1,8})?$/.test(value));
  const [whole, fraction = ''] = value.split('.');
  const canonical = `${whole}.${fraction.padEnd(8, '0')}`;
  return formatUnits(amountUnits(canonical, allowZero));
}

function inputs(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).some((key) => !['programId', 'windowStart', 'windowEnd', 'limit'].includes(key))) {
    deny('R8_INPUT_INVALID');
  }
  const limit = input.limit === undefined ? 500 : input.limit;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) deny('R8_INPUT_INVALID');
  let normalized;
  try {
    normalized = normalizeIncentiveObservationInput({
      programId: input.programId, windowStart: input.windowStart, windowEnd: input.windowEnd,
    });
  } catch { deny('R8_INPUT_INVALID'); }
  return { ...normalized, windowStart: normalized.windowStart.toISOString(),
    windowEnd: normalized.windowEnd.toISOString(), limit };
}

function verifyAuthorization(proof, payload, program, expectedPrincipal, governance, amountIwc) {
  const authorization = proof?.authorization;
  const signing = proof?.signing;
  requireFact(authorization && signing && authorization.programId === program.programId &&
    authorization.action === payload.action && authorization.principalId === expectedPrincipal &&
    authorization.commandEvidence?.principalId === authorization.principalId &&
    authorization.commandEvidence?.agentIdentityId === authorization.agentIdentityId &&
    authorization.commandEvidence?.nonce === authorization.nonce &&
    signing.id === authorization.signingCredentialId && signing.kind === 'signing' &&
    signing.algorithm === 'EdDSA' && signing.agentIdentityId === authorization.agentIdentityId &&
    proof.signingPrincipalId === authorization.principalId &&
    signing.keyId === authorization.commandEvidence?.signingKeyId && same(authorization.payload, payload));
  if (governance) {
    requireFact(signing.keyId === program.governanceSigningKeyId &&
      sha256Evidence(signing.publicKeyJwk) === program.governanceKeyHash);
  }
  const snapshot = proof.authoritySnapshot;
  const access = proof.access;
  const request = snapshot?.requestEvidence;
  requireFact(snapshot && access && snapshot.id === authorization.authoritySnapshotId &&
    snapshot.protocolVersion === 'iwantu-authority-snapshot/0.1' &&
    snapshot.principalId === authorization.principalId && snapshot.agentIdentityId === authorization.agentIdentityId &&
    access.id === authorization.accessCredentialId && access.kind === 'api' && access.agentIdentityId === authorization.agentIdentityId &&
    snapshot.credentialId === access.id && snapshot.credentialKeyId === access.keyId &&
    snapshot.leafMandateId === authorization.commandEvidence.mandateId &&
    snapshot.resolvedAction === payload.action && request?.action === payload.action &&
    request.commandHash === authorization.commandHash && request.payloadHash === sha256Evidence(payload) &&
    request.nonce === authorization.nonce && request.signingCredentialId === signing.id &&
    request.signingKeyId === signing.keyId && request.signatureAlgorithm === 'EdDSA' &&
    Array.isArray(snapshot.mandateChain) && snapshot.mandateChain.length >= 1 && snapshot.mandateChain.length <= 2 &&
    snapshot.mandateChain.at(-1)?.id === snapshot.leafMandateId &&
    snapshot.authorityChainHash === sha256Evidence(snapshot.mandateChain) &&
    snapshot.effectiveAuthority?.actionScopes?.includes(payload.action) &&
    same(request.economic, { singleContract: amountIwc, currency: 'IWC' }));
  if (payload.action === 'incentive.award.issue') {
    requireFact(request.counterpartyPrincipalId === payload.beneficiaryPrincipalId);
  }
  const snapshotEvidence = Object.fromEntries([
    'protocolVersion', 'principalId', 'agentIdentityId', 'credentialId', 'credentialKeyId', 'leafMandateId',
    'mandateChain', 'authorityChainHash', 'effectiveAuthority', 'requestEvidence', 'resolvedAction', 'resolvedCapabilityId',
  ].map((field) => [field, snapshot[field]]));
  snapshotEvidence.resolvedAt = factTime(snapshot.resolvedAt);
  requireFact(snapshot.evidenceHash === sha256Evidence(snapshotEvidence));
  // Verify at the immutable authorization time. Today's credential, Mandate or
  // policy status cannot invalidate an already-paid historical proof.
  const result = validateSignedCommand({
    commandEvidence: authorization.commandEvidence, signature: authorization.signature,
    publicKeyJwk: signing.publicKeyJwk, expectedAction: payload.action, payload,
    now: factTime(proof.authorizationCreatedAt),
  });
  requireFact(result.commandHash === authorization.commandHash &&
    result.payloadHash === sha256Evidence(payload));
  return authorization;
}

function verifyPosting(ledger, entryRows) {
  requireFact(ledger?.status === 'posted' && digest(ledger.transactionHash));
  const entries = entryRows.filter((entry) => entry.transactionId === ledger.id)
    .sort((left, right) => left.entryIndex - right.entryIndex);
  requireFact(entries.length >= 2 && entries.every((entry, index) => entry.entryIndex === index));
  const hash = buildLedgerPostingHash({
    type: ledger.type, referenceType: ledger.referenceType, referenceId: ledger.referenceId,
    idempotencyKey: ledger.idempotencyKey, metadata: ledger.metadata,
    entries: entries.map((entry) => ({ accountId: entry.accountId, side: entry.side,
      amount: money(entry.amount), provenance: entry.provenance ?? null })),
  });
  requireFact(ledger.transactionHash === hash);
  return hash;
}

function verifySettlement(row, entryRows) {
  const { settlement: s, contract: c, settlementLedger: ledger } = row;
  requireFact(s && c && ledger && s.id === row.settlementId && s.contractId === c.id &&
    c.lifecycleState === 'closed' && s.effectiveContractHash === c.effectiveContractHash &&
    s.supplierPrincipalId === c.supplierPrincipalId && s.supplierAgentIdentityId === c.supplierAgentIdentityId &&
    s.escrowId === c.escrowId && digest(s.settlementHash) && ledger.id === s.ledgerTransactionId &&
    ledger.status === 'posted' && digest(ledger.transactionHash));
  verifyPosting(ledger, entryRows);
  const allocation = s.allocation;
  requireFact(allocation?.currency === 'IWC');
  const gross = money(allocation.grossAmount);
  const supplier = money(allocation.supplierAmount, true);
  const refund = money(allocation.buyerRefundAmount, true);
  requireFact(amountUnits(gross) === amountUnits(supplier, true) + amountUnits(refund, true));
  const legs = entryRows.filter((entry) => entry.transactionId === ledger.id)
    .sort((left, right) => left.entryIndex - right.entryIndex);
  const expectedLegs = s.type === 'mutual_split' ? 3 : 2;
  requireFact(legs.length === expectedLegs && ledger.referenceId === c.id &&
    legs[0].side === 'debit' && money(legs[0].amount) === gross &&
    legs[0].accountType === 'principal_locked' && legs[0].accountPrincipalId === c.buyerPrincipalId &&
    legs.every((leg) => leg.accountCurrency === 'IWC'));
  const credit = (leg, principalId, value) => leg.side === 'credit' && money(leg.amount) === value &&
    leg.accountType === 'principal_available' && leg.accountPrincipalId === principalId;
  if (s.type === 'full_refund') {
    requireFact(ledger.type === 'refund' && ledger.referenceType === 'escrow_refund' &&
      credit(legs[1], c.buyerPrincipalId, refund));
  } else {
    requireFact(ledger.type === 'settlement' && ledger.referenceType === (s.type === 'mutual_split' ? 'escrow_mutual_split' : 'escrow_release') &&
      credit(legs[1], c.supplierPrincipalId, supplier));
    if (s.type === 'mutual_split') requireFact(credit(legs[2], c.buyerPrincipalId, refund));
  }
  const common = {
    contractId: c.id, effectiveContractHash: c.effectiveContractHash,
    supplierPrincipalId: c.supplierPrincipalId, supplierAgentIdentityId: c.supplierAgentIdentityId,
    escrowId: c.escrowId, currency: 'IWC', ledgerTransactionId: ledger.id,
    ledgerTransactionHash: ledger.transactionHash,
  };
  let expectedHash;
  if (s.type === 'full_settlement') {
    const { delivery, acceptance } = row;
    requireFact(delivery && acceptance && delivery.id === s.deliveryId && acceptance.id === s.acceptanceDecisionId &&
      delivery.contractId === c.id && acceptance.contractId === c.id && acceptance.deliveryId === delivery.id &&
      delivery.effectiveContractHash === c.effectiveContractHash && acceptance.effectiveContractHash === c.effectiveContractHash &&
      acceptance.deliveryHash === delivery.deliveryHash && acceptance.decision === 'accept' &&
      supplier === gross && refund === '0.00000000');
    expectedHash = hashSettlementEvidence(buildSettlementEvidence({
      ...common, amount: allocation.grossAmount, deliveryId: delivery.id, deliveryHash: delivery.deliveryHash,
      acceptanceDecisionId: acceptance.id, acceptanceDecisionHash: acceptance.decisionHash,
      acceptanceSource: acceptance.source,
    }));
  } else if (s.type === 'full_refund') {
    const source = row.supplierDefault;
    requireFact(source && source.id === s.supplierDefaultId && source.contractId === c.id &&
      source.effectiveContractHash === c.effectiveContractHash && source.supplierPrincipalId === c.supplierPrincipalId &&
      source.supplierAgentIdentityId === c.supplierAgentIdentityId && supplier === '0.00000000' && refund === gross);
    expectedHash = hashFullRefundSettlementEvidence({
      ...common, amount: allocation.grossAmount, buyerPrincipalId: c.buyerPrincipalId,
      supplierDefaultId: source.id, supplierDefaultHash: source.evidenceHash,
    });
  } else if (s.type === 'mutual_split') {
    const { agreement, dispute } = row;
    requireFact(agreement && dispute && agreement.id === s.mutualSettlementAgreementId && dispute.id === s.disputeId &&
      agreement.contractId === c.id && dispute.contractId === c.id && agreement.disputeId === dispute.id &&
      agreement.effectiveContractHash === c.effectiveContractHash && dispute.effectiveContractHash === c.effectiveContractHash &&
      agreement.disputeHash === dispute.disputeHash && agreement.buyerPrincipalId === c.buyerPrincipalId &&
      agreement.supplierPrincipalId === c.supplierPrincipalId && agreement.currency === 'IWC' &&
      money(agreement.grossAmount) === gross && money(agreement.supplierAmount) === supplier &&
      money(agreement.buyerRefundAmount) === refund);
    expectedHash = hashMutualSplitSettlementEvidence({
      ...common, grossAmount: gross, supplierAmount: supplier, buyerRefundAmount: refund,
      disputeId: dispute.id, disputeHash: dispute.disputeHash,
      mutualSettlementAgreementId: agreement.id, agreementHash: agreement.agreementHash,
    });
  } else deny();
  requireFact(expectedHash === s.settlementHash);
  return gross;
}

function verifyTerminalEvidence(row, evidenceRows) {
  const { settlement: s, contract: c } = row;
  const role = row.beneficiaryRole;
  const other = role === 'buyer' ? 'supplier' : 'buyer';
  requireFact(['buyer', 'supplier'].includes(role) && row.beneficiaryPrincipalId === c[`${role}PrincipalId`]);
  const matching = evidenceRows.filter((e) => e.settlementId === s.id && e.subjectRole === role);
  requireFact(matching.length === 2 && new Set(matching.map((e) => e.evidenceClass)).size === 2);
  for (const source of matching) {
    requireFact(['transaction', 'economic'].includes(source.evidenceClass) && source.contractId === c.id &&
      source.subjectPrincipalId === c[`${role}PrincipalId`] && source.subjectAgentIdentityId === c[`${role}AgentIdentityId`] &&
      source.counterpartyPrincipalId === c[`${other}PrincipalId`] && source.counterpartyAgentIdentityId === c[`${other}AgentIdentityId`] &&
      factTime(source.occurredAt).getTime() === factTime(row.settlementCreatedAt).getTime() &&
      source.evidence?.settlementHash === s.settlementHash && source.evidence?.settlementId === s.id &&
      source.evidence?.subjectRole === role && same(source.evidence, source.expectedEvidence));
  }
  return c[`${other}PrincipalId`];
}

function verifyAward(row, program, proofs, entryRows, evidenceRows, input) {
  const { policyRow, ledgerTransaction: ledger } = row;
  requireFact(policyRow && ledger && row.programId === program.programId && policyRow.programId === program.programId);
  const candidate = normalizePolicy(policyRow.policy);
  const policy = candidate.policy;
  requireFact(candidate.policyHash === row.policyHash && policyRow.policyHash === row.policyHash &&
    policyRow.policyVersion === policy.policyVersion && policy.issuerPrincipalId === program.governancePrincipalId);
  verifyAuthorization(proofs.get(policyRow.authorizationId), buildPolicyPayload(candidate), program,
    program.governancePrincipalId, true, policy.rewardFormula.amountIwc);
  const gross = verifySettlement(row, entryRows);
  const settlementAt = factTime(row.settlementCreatedAt);
  const postedAt = factTime(row.postedAt);
  requireFact(settlementAt <= postedAt && settlementAt >= factTime(row.policyCreatedAt) &&
    factTime(policy.effectiveFrom) >= factTime(program.createdAt) &&
    settlementAt >= factTime(policy.effectiveFrom) && settlementAt < factTime(policy.effectiveUntil) &&
    postedAt >= factTime(policy.effectiveFrom) && postedAt < factTime(policy.effectiveUntil) &&
    postedAt >= new Date(input.windowStart) && postedAt < new Date(input.windowEnd) &&
    policy.eligibleSettlementTypes.includes(row.settlement.type));
  const counterpartyPrincipalId = verifyTerminalEvidence(row, evidenceRows);
  const payload = buildAwardPayload({
    programId: program.programId, policyHash: row.policyHash, settlementId: row.settlementId,
    settlementHash: row.settlement.settlementHash, beneficiaryPrincipalId: row.beneficiaryPrincipalId,
    beneficiaryRole: row.beneficiaryRole, awardSlot: row.awardSlot, amountIwc: money(row.amountIwc),
  });
  requireFact(row.id === payload.awardId && row.awardId === payload.awardId &&
    row.beneficiaryRole === policy.beneficiaryRole && row.awardSlot === policy.awardSlot &&
    payload.amountIwc === policy.rewardFormula.amountIwc);
  verifyAuthorization(proofs.get(row.authorizationId), payload, program, program.awardIssuerPrincipalId, false, payload.amountIwc);
  const referenceId = `${program.programId}:${row.awardId}`;
  const expectedProvenance = buildCreditProvenance({
    kind: 'incentive', beneficiaryPrincipalId: row.beneficiaryPrincipalId,
    sourceReferenceType: 'protocol_incentive_award', sourceReferenceId: referenceId,
    programId: program.programId, awardId: row.awardId,
  });
  const entries = entryRows.filter((e) => e.transactionId === row.ledgerTransactionId)
    .sort((a, b) => a.entryIndex - b.entryIndex);
  requireFact(entries.length === 2 && entries[0].entryIndex === 0 && entries[1].entryIndex === 1);
  const [debit, credit] = entries;
  requireFact(debit.side === 'debit' && credit.side === 'credit' &&
    money(debit.amount) === payload.amountIwc && money(credit.amount) === payload.amountIwc &&
    debit.accountType === 'system_incentive' && debit.accountPrincipalId === null && debit.accountCurrency === 'IWC' &&
    credit.accountType === 'principal_available' && credit.accountPrincipalId === row.beneficiaryPrincipalId &&
    credit.accountCurrency === 'IWC' && same(credit.provenance, expectedProvenance));
  requireFact(ledger.id === row.ledgerTransactionId && ledger.type === 'incentive' && ledger.status === 'posted' &&
    ledger.referenceType === 'protocol_incentive_award' && ledger.referenceId === referenceId &&
    ledger.idempotencyKey === `credit:incentive-award:${referenceId}` &&
    ledger.metadata?.programId === program.programId && ledger.metadata?.awardId === row.awardId &&
    ledger.metadata?.beneficiaryPrincipalId === row.beneficiaryPrincipalId &&
    ledger.metadata?.details?.policyHash === row.policyHash && ledger.metadata?.details?.settlementId === row.settlementId &&
    ledger.metadata?.details?.authorizationId === row.authorizationId);
  const ledgerHash = verifyPosting(ledger, entryRows);
  const receiptPayload = { ...payload };
  delete receiptPayload.action;
  delete receiptPayload.currency;
  const receipt = {
    ...receiptPayload, protocol: 'iwantu.incentive-award-receipt/0.1',
    ledgerTransactionId: ledger.id, ledgerTransactionHash: ledgerHash, authorizationId: row.authorizationId,
  };
  requireFact(same(row.receipt, receipt) && row.receiptHash === sha256Evidence(receipt));
  return {
    awardId: row.awardId, programId: program.programId, policyHash: row.policyHash,
    policyVersion: policy.policyVersion, settlementId: row.settlementId,
    settlementHash: row.settlement.settlementHash, settlementType: row.settlement.type,
    settlementCreatedAt: settlementAt.toISOString(), beneficiaryRole: row.beneficiaryRole,
    awardSlot: row.awardSlot, beneficiaryPrincipalId: row.beneficiaryPrincipalId, counterpartyPrincipalId,
    amountIwc: payload.amountIwc, settlementGrossIwc: gross, ledgerTransactionId: ledger.id,
    ledgerTransactionHash: ledgerHash, receiptHash: row.receiptHash, authorizationId: row.authorizationId,
    postedAt: postedAt.toISOString(),
    policyRevokedAt: row.policyRevokedAt && factTime(row.policyRevokedAt) < new Date(input.windowEnd)
      ? factTime(row.policyRevokedAt).toISOString() : null,
  };
}

// This proves bounded historical award facts, not the entire Ledger hash chain.
// Counts and every related source are read from the same immutable MVCC view.
export async function readGovernedIncentiveAwardSources(prisma, input) {
  const normalized = inputs(input);
  if (!prisma || typeof prisma.$transaction !== 'function') deny('R8_INPUT_INVALID');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const [program] = await tx.$queryRaw`
      SELECT p.*, p."budgetIwc"::text AS "budgetIwc" FROM "r8_incentive_programs" p
      WHERE p."programId" = ${normalized.programId}
    `;
    if (!program) deny('R8_PROGRAM_NOT_FOUND');
    try {
      const registrationPayload = buildRegistrationPayload(program.registration);
      requireFact(program.programId === normalized.programId && program.registration.programId === program.programId &&
        money(program.budgetIwc) === program.registration.budgetIwc &&
        ['configurationHash', 'governancePrincipalId', 'governanceSigningKeyId', 'governanceKeyHash', 'awardIssuerPrincipalId']
          .every((field) => program[field] === program.registration[field]));
      const rows = await tx.$queryRaw`
        SELECT b.*, b."amountIwc"::text AS "amountIwc", to_jsonb(p) AS "policyRow",
          p."createdAt" AS "policyCreatedAt", to_jsonb(s) AS "settlement", s."createdAt" AS "settlementCreatedAt",
          to_jsonb(c) AS "contract", to_jsonb(t) AS "ledgerTransaction", t."postedAt" AS "postedAt",
          to_jsonb(st) AS "settlementLedger", to_jsonb(d) AS "delivery", to_jsonb(a) AS "acceptance",
          to_jsonb(sd) AS "supplierDefault", to_jsonb(dis) AS "dispute",
          CASE WHEN ag."id" IS NULL THEN NULL ELSE to_jsonb(ag) || jsonb_build_object(
            'grossAmount', ag."grossAmount"::text, 'supplierAmount', ag."supplierAmount"::text,
            'buyerRefundAmount', ag."buyerRefundAmount"::text) END AS "agreement",
          r."createdAt" AS "policyRevokedAt"
        FROM "r8_incentive_award_bindings" b
        LEFT JOIN "r8_incentive_policies" p ON p."policyHash" = b."policyHash"
        LEFT JOIN "settlements" s ON s."id" = b."settlementId"
        LEFT JOIN "contracts" c ON c."id" = s."contractId"
        LEFT JOIN "ledger_transactions" t ON t."id" = b."ledgerTransactionId"
        LEFT JOIN "ledger_transactions" st ON st."id" = s."ledgerTransactionId"
        LEFT JOIN "deliveries" d ON d."id" = s."deliveryId"
        LEFT JOIN "delivery_acceptance_decisions" a ON a."id" = s."acceptanceDecisionId"
        LEFT JOIN "supplier_defaults" sd ON sd."id" = s."supplierDefaultId"
        LEFT JOIN "disputes" dis ON dis."id" = s."disputeId"
        LEFT JOIN "mutual_settlement_agreements" ag ON ag."id" = s."mutualSettlementAgreementId"
        LEFT JOIN "r8_incentive_policy_revocations" r ON r."policyHash" = b."policyHash"
        WHERE b."programId" = ${normalized.programId} AND (t."postedAt" IS NULL OR (
          t."postedAt" >= (${normalized.windowStart}::timestamptz AT TIME ZONE 'UTC')
          AND t."postedAt" < (${normalized.windowEnd}::timestamptz AT TIME ZONE 'UTC')))
        ORDER BY t."postedAt", b."id" LIMIT ${normalized.limit + 1}
      `;
      if (rows.length > normalized.limit) deny('R8_OBSERVATION_LIMIT_EXCEEDED');
      const [count] = await tx.$queryRaw`
        SELECT count(*)::text AS "count" FROM "ledger_transactions" t
        WHERE t."status" = 'posted' AND (
          t."type" = 'incentive' OR t."referenceType" = 'protocol_incentive_award'
          OR t."metadata" ->> 'creditSource' = 'incentive'
          OR EXISTS (SELECT 1 FROM "ledger_entries" e
            LEFT JOIN "ledger_accounts" a ON a."id" = e."accountId"
            WHERE e."transactionId" = t."id" AND (
              (e."side" = 'debit' AND a."type" = 'system_incentive')
              OR e."provenance" ->> 'kind' = 'incentive'
              OR e."provenance" ->> 'sourceReferenceType' = 'protocol_incentive_award'))
        ) AND (
          t."metadata" ->> 'programId' = ${normalized.programId}
          OR (t."referenceType" = 'protocol_incentive_award' AND split_part(t."referenceId", ':', 1) = ${normalized.programId})
          OR EXISTS (SELECT 1 FROM "ledger_entries" e WHERE e."transactionId" = t."id"
            AND e."provenance" ->> 'programId' = ${normalized.programId})
        )
          AND t."postedAt" >= (${normalized.windowStart}::timestamptz AT TIME ZONE 'UTC')
          AND t."postedAt" < (${normalized.windowEnd}::timestamptz AT TIME ZONE 'UTC')
          AND NOT EXISTS (SELECT 1 FROM "r8_incentive_award_bindings" b
            WHERE b."ledgerTransactionId" = t."id" AND b."programId" = ${normalized.programId})
      `;
      requireFact(typeof count?.count === 'string' && /^(0|[1-9][0-9]*)$/.test(count.count));
      if (BigInt(count.count) + BigInt(rows.length) > BigInt(normalized.limit)) deny('R8_OBSERVATION_LIMIT_EXCEEDED');
      const ids = [...new Set([program.authorizationId, ...rows.flatMap((row) => [row.authorizationId, row.policyRow?.authorizationId])])];
      requireFact(ids.every((id) => typeof id === 'string' && digest(id)));
      const authorizations = await tx.$queryRaw(Prisma.sql`
        SELECT to_jsonb(a) AS "authorization", a."createdAt" AS "authorizationCreatedAt",
          to_jsonb(k) AS "signing", agent."principalId" AS "signingPrincipalId",
          to_jsonb(access) AS "access", to_jsonb(snap) AS "authoritySnapshot"
        FROM "r8_incentive_authorizations" a
        LEFT JOIN "agent_credentials" k ON k."id" = a."signingCredentialId"
        LEFT JOIN "agent_identities" agent ON agent."id" = k."agentIdentityId"
        LEFT JOIN "agent_credentials" access ON access."id" = a."accessCredentialId"
        LEFT JOIN "authority_snapshots" snap ON snap."id" = a."authoritySnapshotId"
        WHERE a."commandHash" IN (${Prisma.join(ids)})
      `);
      const proofs = new Map(authorizations.map((proof) => [proof.authorization.commandHash, proof]));
      verifyAuthorization(proofs.get(program.authorizationId), registrationPayload, program,
        program.governancePrincipalId, true, program.registration.budgetIwc);
      if (!rows.length) return { records: [], unboundPostedCandidateCount: Number(count.count) };
      const ledgerIds = [...new Set(rows.flatMap((row) => [row.ledgerTransactionId, row.settlement?.ledgerTransactionId]))];
      requireFact(ledgerIds.every((id) => typeof id === 'string' && id.length > 0));
      const settlementIds = [...new Set(rows.map((row) => row.settlementId))];
      const entries = await tx.$queryRaw(Prisma.sql`
        SELECT e.*, e."amount"::text AS "amount", a."type"::text AS "accountType",
          a."principalId" AS "accountPrincipalId", a."currency" AS "accountCurrency"
        FROM "ledger_entries" e LEFT JOIN "ledger_accounts" a ON a."id" = e."accountId"
        WHERE e."transactionId" IN (${Prisma.join(ledgerIds)}) ORDER BY e."transactionId", e."entryIndex"
        LIMIT ${ledgerIds.length * 3 + 1}
      `);
      requireFact(entries.length <= ledgerIds.length * 3);
      const terminalEvidence = await tx.$queryRaw(Prisma.sql`
        SELECT r.*, iwantu_build_terminal_reputation_evidence(r."settlementId", r."subjectRole", r."evidenceClass") AS "expectedEvidence"
        FROM "reputation_evidence" r WHERE r."settlementId" IN (${Prisma.join(settlementIds)})
      `);
      return {
        records: rows.map((row) => verifyAward(row, program, proofs, entries, terminalEvidence, normalized)),
        unboundPostedCandidateCount: Number(count.count),
      };
    } catch (error) {
      if (error instanceof GovernedIncentiveSourceError) throw error;
      deny();
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000, maxWait: 10_000 });
}
