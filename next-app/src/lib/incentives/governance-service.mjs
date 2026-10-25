import { Prisma } from '@prisma/client';
import { bindAuthorityToAuthentication } from '../agent-auth-context-core.mjs';
import { resolveAuthority } from '../authority/authority.mjs';
import { captureAuthoritySnapshot, sha256Evidence } from '../authority/authority-snapshot.mjs';
import { buildCreditProvenance } from '../ledger/credit-foundation.mjs';
import { postLedgerTransactionInTransaction } from '../ledger/ledger-posting.mjs';
import { inspectPostedIncentiveBudgetCoverageDraft } from '../integrity/incentive-posted-budget-coverage-draft.mjs';
import {
  IncentiveGovernanceError,
  amountUnits,
  buildAwardPayload,
  buildPolicyPayload,
  buildRegistrationPayload,
  normalizePolicy,
  normalizeRegistration,
  normalizeTrustedPrograms,
  validateSignedCommand,
} from './governance-protocol.mjs';

const deny = (code, message) => { throw new IncentiveGovernanceError(code, message); };

function fields(input, expected) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype ||
      Object.keys(input).length !== expected.length || expected.some((key) => !Object.hasOwn(input, key))) {
    deny('R8_INPUT_INVALID', 'Command contains missing or unexpected fields');
  }
}

async function atomic(prisma, work) {
  return prisma.$transaction(async (tx) => {
    // Same lock and order as M2. Never lock Contract/Escrow rows after this:
    // settlement writers acquire those rows BEFORE the Ledger lock.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(4921178337::bigint)::text`;
    return work(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 30_000, maxWait: 10_000 });
}

async function programRow(tx, programId) {
  const rows = await tx.$queryRaw`
    SELECT *, "budgetIwc"::text AS "budgetIwc" FROM "r8_incentive_programs"
    WHERE "programId" = ${programId}
  `;
  return rows[0] ?? null;
}

async function bindingRow(tx, awardId) {
  const rows = await tx.$queryRaw`
    SELECT *, "amountIwc"::text AS "amountIwc" FROM "r8_incentive_award_bindings"
    WHERE "id" = ${awardId}
  `;
  return rows[0] ?? null;
}

async function replayAuthorization(tx, authentication, input, payload) {
  const commandHash = sha256Evidence(input.commandEvidence);
  const rows = await tx.$queryRaw`
    SELECT * FROM "r8_incentive_authorizations" WHERE "commandHash" = ${commandHash}
  `;
  const stored = rows[0];
  if (!stored) return null;
  if (authentication?.kind !== 'v2_agent_credential' ||
      stored.principalId !== authentication.principal?.id ||
      stored.agentIdentityId !== authentication.agent?.id ||
      stored.accessCredentialId !== authentication.credential?.id ||
      stored.signature !== input.signature || sha256Evidence(stored.payload) !== sha256Evidence(payload)) {
    deny('R8_COMMAND_REPLAY', 'Replay differs from the original authenticated signed command');
  }
  // An exact committed replay reads immutable results, consumes no nonce and
  // creates no new economic obligation, even after the original command expires.
  return stored;
}

function liveCredential(record, now, kind) {
  return record && record.kind === kind && record.status === 'active' &&
    record.validFrom <= now && (!record.expiresAt || record.expiresAt > now);
}

async function authorize(tx, authentication, input, payload, registration, amountIwc) {
  if (authentication?.kind !== 'v2_agent_credential' || authentication.canResolveProtocolAuthority !== true) {
    deny('R8_AUTHENTICATION_REQUIRED', 'Governed incentives require v2 access authentication');
  }
  const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS "now"`;
  const evidence = input.commandEvidence;
  if (evidence?.principalId !== authentication.principal?.id || evidence?.agentIdentityId !== authentication.agent?.id) {
    deny('R8_IDENTITY_MISMATCH', 'Command signer differs from authenticated identity');
  }
  const [access, signing, principal, agent] = await Promise.all([
    tx.agentCredential.findUnique({ where: { id: authentication.credential?.id ?? '' } }),
    tx.agentCredential.findUnique({ where: { keyId: evidence.signingKeyId ?? '' } }),
    tx.principal.findUnique({ where: { id: evidence.principalId } }),
    tx.agentIdentity.findUnique({ where: { id: evidence.agentIdentityId } }),
  ]);
  if (!principal || principal.status !== 'active' || !agent || agent.status !== 'active' ||
      agent.principalId !== principal.id || !liveCredential(access, now, 'api') ||
      access.keyId !== authentication.credential.keyId || access.agentIdentityId !== agent.id ||
      !liveCredential(signing, now, 'signing') || signing.agentIdentityId !== agent.id || signing.algorithm !== 'EdDSA') {
    deny('R8_CREDENTIAL_NOT_LIVE', 'Stored Principal, Agent or credential is not currently usable');
  }
  const isAward = payload.action === 'incentive.award.issue';
  const expectedPrincipal = isAward ? registration.awardIssuerPrincipalId : registration.governancePrincipalId;
  if (principal.id !== expectedPrincipal || (!isAward &&
      (signing.keyId !== registration.governanceSigningKeyId ||
        sha256Evidence(signing.publicKeyJwk) !== registration.governanceKeyHash))) {
    deny('R8_TRUST_DENIED', 'Signer is not the explicitly configured governance owner or award executor');
  }
  const proof = validateSignedCommand({
    commandEvidence: evidence, signature: input.signature, publicKeyJwk: signing.publicKeyJwk,
    expectedAction: payload.action, payload, now,
  });
  const authority = await resolveAuthority(tx, {
    mandateId: evidence.mandateId, subjectAgentIdentityId: agent.id, action: payload.action, at: now,
    ...(isAward ? { counterpartyPrincipalId: payload.beneficiaryPrincipalId } : {}),
  });
  const bound = bindAuthorityToAuthentication(authentication, authority);
  if (!authority.effective.actionScopes.includes(payload.action)) {
    deny('R8_EXPLICIT_ACTION_REQUIRED', 'Wildcard authority cannot authorize incentive governance');
  }
  const limits = authority.effective.economicLimits;
  if (limits?.currency !== 'IWC' || typeof limits.singleContract !== 'string' ||
      amountUnits(amountIwc) > amountUnits(limits.singleContract)) {
    deny('R8_ECONOMIC_LIMIT_EXCEEDED', 'Explicit exact IWC commitment limit is missing or insufficient');
  }
  const used = await tx.$queryRaw`
    SELECT "commandHash" FROM "r8_incentive_authorizations"
    WHERE "principalId" = ${principal.id} AND "nonce" = ${evidence.nonce}
  `;
  if (used.length) deny('R8_COMMAND_REPLAY', 'Nonce was consumed by another R8 action or payload');
  const snapshot = await captureAuthoritySnapshot(tx, bound, {
    action: payload.action, commandHash: proof.commandHash, payloadHash: proof.payloadHash,
    nonce: evidence.nonce, signingCredentialId: signing.id, signingKeyId: signing.keyId,
    signatureAlgorithm: 'EdDSA', economic: { singleContract: amountIwc, currency: 'IWC' },
    ...(isAward ? { counterpartyPrincipalId: payload.beneficiaryPrincipalId } : {}),
  }, now);
  const [authorization] = await tx.$queryRaw`
    INSERT INTO "r8_incentive_authorizations" (
      "commandHash", "programId", "action", "principalId", "agentIdentityId",
      "accessCredentialId", "signingCredentialId", "authoritySnapshotId", "nonce",
      "commandEvidence", "payload", "signature"
    ) VALUES (
      ${proof.commandHash}, ${registration.programId}, ${payload.action}, ${principal.id}, ${agent.id},
      ${access.id}, ${signing.id}, ${snapshot.id}, ${evidence.nonce},
      ${JSON.stringify(evidence)}::jsonb, ${JSON.stringify(payload)}::jsonb, ${input.signature}
    ) RETURNING *
  `;
  return authorization;
}

// Construct this service in trusted server setup. There is deliberately no HTTP
// route or implicit admin fallback; missing configuration disables all writes.
export function createIncentiveGovernanceService({ trustedPrograms = {} } = {}) {
  const trusted = normalizeTrustedPrograms(trustedPrograms);
  function configured(programId) {
    if (!Object.hasOwn(trusted, programId)) deny('R8_CONFIG_DISABLED', 'No trusted configuration for this Program');
    return trusted[programId];
  }
  async function requireProgram(tx, programId) {
    const entry = configured(programId);
    const program = await programRow(tx, programId);
    if (!program) deny('R8_PROGRAM_NOT_FOUND', 'Program must be registered before publication or awards');
    const expected = normalizeRegistration({
      protocol: program.registration.protocol, programId, budgetIwc: program.budgetIwc,
    }, entry);
    if (sha256Evidence(expected) !== sha256Evidence(program.registration)) {
      deny('R8_TRUST_DENIED', 'Current trusted configuration differs from the immutable registration');
    }
    return program;
  }
  async function rootLive(tx, program) {
    const key = await tx.agentCredential.findUnique({ where: { keyId: program.governanceSigningKeyId } });
    const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS "now"`;
    const agent = key && await tx.agentIdentity.findUnique({ where: { id: key.agentIdentityId } });
    const owner = await tx.principal.findUnique({ where: { id: program.governancePrincipalId } });
    if (!liveCredential(key, now, 'signing') || key.algorithm !== 'EdDSA' || !agent || agent.status !== 'active' ||
        agent.principalId !== program.governancePrincipalId || owner?.status !== 'active' ||
        sha256Evidence(key.publicKeyJwk) !== program.governanceKeyHash) {
      deny('R8_GOVERNANCE_REVOKED', 'Configured governance key or owner is no longer live');
    }
  }

  return Object.freeze({
    async registerProgram(prisma, authentication, input) {
      fields(input, ['registration', 'commandEvidence', 'signature']);
      const registration = normalizeRegistration(input.registration, configured(input.registration.programId));
      const payload = buildRegistrationPayload(registration);
      return atomic(prisma, async (tx) => {
        const replay = await replayAuthorization(tx, authentication, input, payload);
        if (replay) return { program: await programRow(tx, registration.programId), authorization: replay, idempotent: true };
        if (await programRow(tx, registration.programId)) deny('R8_PROGRAM_ALREADY_REGISTERED', 'Registration is immutable');
        const coverage = await inspectPostedIncentiveBudgetCoverageDraft(tx, { programId: registration.programId });
        if (amountUnits(coverage.programPostedSpendIwc, true) !== 0n) {
          deny('R8_PROGRAM_HISTORY_UNBOUND', 'An existing legacy Program requires a separate signed migration decision');
        }
        const authorization = await authorize(tx, authentication, input, payload, registration, registration.budgetIwc);
        await tx.$executeRaw`
          INSERT INTO "r8_incentive_programs" (
            "programId", "governancePrincipalId", "governanceSigningKeyId", "governanceKeyHash",
            "awardIssuerPrincipalId", "budgetIwc", "configurationHash", "registration", "authorizationId"
          ) VALUES (
            ${registration.programId}, ${registration.governancePrincipalId}, ${registration.governanceSigningKeyId},
            ${registration.governanceKeyHash}, ${registration.awardIssuerPrincipalId},
            ${registration.budgetIwc}::numeric, ${registration.configurationHash},
            ${JSON.stringify(registration)}::jsonb, ${authorization.commandHash}
          )
        `;
        return { program: await programRow(tx, registration.programId), authorization, idempotent: false };
      });
    },

    async publishPolicy(prisma, authentication, input) {
      fields(input, ['policy', 'commandEvidence', 'signature']);
      const candidate = normalizePolicy(input.policy);
      const payload = buildPolicyPayload(candidate);
      return atomic(prisma, async (tx) => {
        const program = await requireProgram(tx, candidate.policy.programId);
        const replay = await replayAuthorization(tx, authentication, input, payload);
        if (replay) {
          const [policy] = await tx.$queryRaw`SELECT * FROM "r8_incentive_policies" WHERE "policyHash" = ${candidate.policyHash}`;
          return { policy, authorization: replay, idempotent: true };
        }
        await rootLive(tx, program);
        if (candidate.policy.issuerPrincipalId !== program.governancePrincipalId ||
            new Date(candidate.policy.effectiveFrom) < program.createdAt ||
            amountUnits(candidate.policy.rewardFormula.amountIwc) > amountUnits(program.budgetIwc)) {
          deny('R8_POLICY_INELIGIBLE', 'Policy owner, prospective interval or amount is invalid for this Program');
        }
        const authorization = await authorize(tx, authentication, input, payload, program.registration,
          candidate.policy.rewardFormula.amountIwc);
        const [policy] = await tx.$queryRaw`
          INSERT INTO "r8_incentive_policies" ("policyHash", "programId", "policyVersion", "policy", "authorizationId")
          VALUES (${candidate.policyHash}, ${program.programId}, ${candidate.policy.policyVersion},
            ${JSON.stringify(candidate.policy)}::jsonb, ${authorization.commandHash}) RETURNING *
        `;
        return { policy, authorization, idempotent: false };
      });
    },

    async awardForSettlement(prisma, authentication, input) {
      fields(input, ['programId', 'policyHash', 'settlementId', 'commandEvidence', 'signature']);
      configured(input.programId);
      return atomic(prisma, async (tx) => {
        const program = await requireProgram(tx, input.programId);
        const [policyRow] = await tx.$queryRaw`
          SELECT * FROM "r8_incentive_policies" WHERE "programId" = ${input.programId} AND "policyHash" = ${input.policyHash}
        `;
        if (!policyRow) deny('R8_POLICY_NOT_FOUND', 'Award must refer to a published immutable policy');
        const candidate = normalizePolicy(policyRow.policy);
        if (candidate.policyHash !== policyRow.policyHash) deny('R8_POLICY_HASH_INVALID', 'Stored policy digest differs');
        const policy = candidate.policy;
        // Terminal Settlement and immutable Contract parties are facts; no row
        // locks here, preserving existing Contract/Escrow -> Ledger lock order.
        const [settlement] = await tx.$queryRaw`
          SELECT s.*, c."buyerPrincipalId", c."supplierPrincipalId"
          FROM "settlements" s JOIN "contracts" c ON c."id" = s."contractId"
          WHERE s."id" = ${input.settlementId}
        `;
        if (!settlement) deny('R8_SETTLEMENT_NOT_FOUND', 'Only actual terminal Settlement facts can trigger an award');
        const beneficiaryPrincipalId = policy.beneficiaryRole === 'buyer'
          ? settlement.buyerPrincipalId : settlement.supplierPrincipalId;
        const payload = buildAwardPayload({
          programId: program.programId, policyHash: candidate.policyHash, settlementId: settlement.id,
          settlementHash: settlement.settlementHash, beneficiaryPrincipalId,
          beneficiaryRole: policy.beneficiaryRole, awardSlot: policy.awardSlot,
          amountIwc: policy.rewardFormula.amountIwc,
        });
        const replay = await replayAuthorization(tx, authentication, input, payload);
        if (replay) {
          const binding = await bindingRow(tx, payload.awardId);
          const ledgerTransaction = await tx.ledgerTransaction.findUnique({
            where: { id: binding.ledgerTransactionId }, include: { entries: { orderBy: { entryIndex: 'asc' } } },
          });
          return { binding, ledgerTransaction, authorization: replay, idempotent: true };
        }
        await rootLive(tx, program);
        const beneficiary = await tx.principal.findUnique({ where: { id: beneficiaryPrincipalId } });
        if (beneficiary?.status !== 'active') {
          deny('R8_BENEFICIARY_NOT_ACTIVE', 'New discretionary awards require an active beneficiary Principal');
        }
        const [{ now }] = await tx.$queryRaw`SELECT clock_timestamp() AS "now"`;
        if (!policy.eligibleSettlementTypes.includes(settlement.type) ||
            settlement.createdAt < policyRow.createdAt || settlement.createdAt < new Date(policy.effectiveFrom) ||
            settlement.createdAt >= new Date(policy.effectiveUntil) ||
            now < new Date(policy.effectiveFrom) || now >= new Date(policy.effectiveUntil)) {
          deny('R8_SETTLEMENT_INELIGIBLE', 'Settlement must prospectively qualify under the published policy interval');
        }
        if (await bindingRow(tx, payload.awardId)) {
          deny('R8_ENTITLEMENT_CONFLICT', 'Program/Settlement/role/slot entitlement was already consumed');
        }
        const coverage = await inspectPostedIncentiveBudgetCoverageDraft(tx, { programId: program.programId });
        if (amountUnits(coverage.programPostedSpendIwc, true) + amountUnits(payload.amountIwc) > amountUnits(program.budgetIwc)) {
          deny('R8_PROGRAM_BUDGET_EXCEEDED', 'Shared Program budget is insufficient across all policy versions');
        }
        const authorization = await authorize(tx, authentication, input, payload, program.registration, payload.amountIwc);
        // Settled buyers/suppliers already have economic accounts. Do not create
        // accounts while holding Ledger: other writers bootstrap before it.
        const [pool, available] = await Promise.all([
          tx.ledgerAccount.findFirst({ where: { principalId: null, type: 'system_incentive', currency: 'IWC' } }),
          tx.ledgerAccount.findFirst({ where: { principalId: beneficiaryPrincipalId, type: 'principal_available', currency: 'IWC' } }),
        ]);
        if (!pool || !available) deny('R8_LEDGER_ACCOUNTS_MISSING', 'Existing Incentive pool and beneficiary accounts are required');
        const referenceId = `${program.programId}:${payload.awardId}`;
        const ledgerTransaction = await postLedgerTransactionInTransaction(tx, {
          type: 'incentive', referenceType: 'protocol_incentive_award', referenceId,
          idempotencyKey: `credit:incentive-award:${referenceId}`,
          metadata: { programId: program.programId, awardId: payload.awardId, beneficiaryPrincipalId,
            details: { policyHash: candidate.policyHash, settlementId: settlement.id, authorizationId: authorization.commandHash } },
          entries: [
            { accountId: pool.id, side: 'debit', amount: payload.amountIwc },
            { accountId: available.id, side: 'credit', amount: payload.amountIwc,
              provenance: buildCreditProvenance({ kind: 'incentive', beneficiaryPrincipalId,
                sourceReferenceType: 'protocol_incentive_award', sourceReferenceId: referenceId,
                programId: program.programId, awardId: payload.awardId }) },
          ],
        });
        const receipt = {
          protocol: 'iwantu.incentive-award-receipt/0.1', programId: program.programId,
          policyHash: candidate.policyHash, settlementId: settlement.id, settlementHash: settlement.settlementHash,
          beneficiaryPrincipalId, beneficiaryRole: policy.beneficiaryRole, awardSlot: policy.awardSlot,
          amountIwc: payload.amountIwc, awardId: payload.awardId, ledgerTransactionId: ledgerTransaction.id,
          ledgerTransactionHash: ledgerTransaction.transactionHash, authorizationId: authorization.commandHash,
        };
        await tx.$executeRaw`
          INSERT INTO "r8_incentive_award_bindings" (
            "id", "awardId", "programId", "policyHash", "settlementId", "beneficiaryRole", "awardSlot",
            "beneficiaryPrincipalId", "amountIwc", "ledgerTransactionId", "authorizationId", "receipt", "receiptHash"
          ) VALUES (
            ${payload.awardId}, ${payload.awardId}, ${program.programId}, ${candidate.policyHash}, ${settlement.id},
            ${policy.beneficiaryRole}, ${policy.awardSlot}, ${beneficiaryPrincipalId}, ${payload.amountIwc}::numeric,
            ${ledgerTransaction.id}, ${authorization.commandHash}, ${JSON.stringify(receipt)}::jsonb, ${sha256Evidence(receipt)}
          )
        `;
        return { binding: await bindingRow(tx, payload.awardId), ledgerTransaction, authorization, idempotent: false };
      });
    },
  });
}

export function createIncentiveGovernanceServiceFromEnvironment(env = process.env) {
  return createIncentiveGovernanceService({
    trustedPrograms: env.IWANTU_INCENTIVE_TRUSTED_PROGRAMS
      ? JSON.parse(env.IWANTU_INCENTIVE_TRUSTED_PROGRAMS) : {},
  });
}
