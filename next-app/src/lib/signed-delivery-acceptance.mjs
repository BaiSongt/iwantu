import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as verifyDigitalSignature,
} from 'node:crypto';
import { Prisma } from '@prisma/client';
import { bindAuthorityToAuthentication } from './agent-auth-context-core.mjs';
import { resolveAuthority } from './authority/authority.mjs';
import { captureAuthoritySnapshot } from './authority/authority-snapshot.mjs';
import {
  buildEconomicCommandEvidence,
  canonicalEconomicCommandJson,
  hashEconomicCommandEvidence,
  SignedEconomicCommandError,
} from './signed-economic-command.mjs';
import {
  buildReworkAuthorizationEvidence,
  hashReworkAuthorizationEvidence,
  resolveContractDeliveryPolicy,
  ReworkPolicyError,
} from './rework-policy.mjs';

const ACCEPTANCE_PROTOCOL_VERSION = 'iwantu-delivery-acceptance/0.1';
const MAX_COMMAND_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const REJECTION_REASON_CODES = new Set([
  'MISSING_OUTPUT',
  'FORMAT_INVALID',
  'CONSTRAINT_NOT_MET',
  'INCOMPLETE',
  'DEADLINE_EXCEEDED',
  'OTHER',
]);

export class DeliveryAcceptanceProtocolError extends SignedEconomicCommandError {
  constructor(code, message, details = undefined) {
    super(code, message, details);
    this.name = 'DeliveryAcceptanceProtocolError';
  }
}

function deny(code, message, details) {
  throw new DeliveryAcceptanceProtocolError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('ACCEPTANCE_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function normalizeDecision(value) {
  if (value !== 'accept' && value !== 'reject') {
    deny('ACCEPTANCE_DECISION_INVALID', 'decision must be accept or reject');
  }
  return value;
}

function normalizeReason(decision, reasonCode, reasonDetail) {
  if (decision === 'accept') {
    if (reasonCode !== undefined && reasonCode !== null && reasonCode !== '') {
      deny('ACCEPTANCE_REASON_INVALID', 'accept decisions must not carry a rejection reason code');
    }
    return { reasonCode: null, reasonDetail: null };
  }
  const code = nonEmpty(reasonCode, 'reasonCode');
  if (!REJECTION_REASON_CODES.has(code)) {
    deny('ACCEPTANCE_REASON_INVALID', 'reject decision uses an unsupported reason code', { reasonCode: code });
  }
  const detail = reasonDetail === undefined || reasonDetail === null || reasonDetail === ''
    ? null
    : String(reasonDetail).trim();
  return { reasonCode: code, reasonDetail: detail };
}

function hashCanonical(value) {
  return createHash('sha256').update(canonicalEconomicCommandJson(value), 'utf8').digest('hex');
}

export function buildDeliveryAcceptanceEvidence(input) {
  const decision = normalizeDecision(input?.decision);
  const reason = normalizeReason(decision, input?.reasonCode, input?.reasonDetail);
  return {
    protocolVersion: ACCEPTANCE_PROTOCOL_VERSION,
    decisionIdempotencyKey: nonEmpty(input?.decisionIdempotencyKey, 'decisionIdempotencyKey'),
    contractId: nonEmpty(input?.contractId, 'contractId'),
    effectiveContractHash: nonEmpty(input?.effectiveContractHash, 'effectiveContractHash'),
    deliveryId: nonEmpty(input?.deliveryId, 'deliveryId'),
    deliveryHash: nonEmpty(input?.deliveryHash, 'deliveryHash'),
    decision,
    reasonCode: reason.reasonCode,
    reasonDetail: reason.reasonDetail,
    buyerPrincipalId: nonEmpty(input?.buyerPrincipalId, 'buyerPrincipalId'),
    buyerAgentIdentityId: nonEmpty(input?.buyerAgentIdentityId, 'buyerAgentIdentityId'),
    nonce: nonEmpty(input?.nonce, 'nonce'),
  };
}

export function hashDeliveryAcceptanceEvidence(evidence) {
  return hashCanonical(buildDeliveryAcceptanceEvidence(evidence));
}

function assertCommandWindow(commandEvidence, now) {
  const issuedAt = new Date(commandEvidence.issuedAt);
  const expiresAt = new Date(commandEvidence.expiresAt);
  if (Number.isNaN(issuedAt.getTime()) || Number.isNaN(expiresAt.getTime())) {
    deny('ECONOMIC_COMMAND_WINDOW_INVALID', 'Acceptance command timestamps must be valid');
  }
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    deny('ECONOMIC_COMMAND_WINDOW_INVALID', 'Acceptance command expiresAt must be after issuedAt');
  }
  if (expiresAt.getTime() - issuedAt.getTime() > MAX_COMMAND_TTL_MS) {
    deny('ECONOMIC_COMMAND_WINDOW_INVALID', 'Acceptance command TTL exceeds the MVP maximum');
  }
  if (issuedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    deny('ECONOMIC_COMMAND_NOT_YET_VALID', 'Acceptance command issuedAt is too far in the future');
  }
  if (expiresAt.getTime() <= now.getTime()) {
    deny('ECONOMIC_COMMAND_EXPIRED', 'Acceptance command has expired');
  }
}

async function assertLiveAccessIdentity(tx, authentication, now) {
  if (authentication?.kind !== 'v2_agent_credential') {
    deny('V2_AGENT_AUTHENTICATION_REQUIRED', 'Signed Delivery acceptance requires v2 AgentCredential authentication');
  }
  const [credential, principal, agent] = await Promise.all([
    tx.agentCredential.findUnique({
      where: { id: authentication.credential?.id ?? '' },
      select: { id: true, agentIdentityId: true, kind: true, status: true, keyId: true, validFrom: true, expiresAt: true },
    }),
    tx.principal.findUnique({ where: { id: authentication.principal?.id ?? '' }, select: { id: true, status: true } }),
    tx.agentIdentity.findUnique({
      where: { id: authentication.agent?.id ?? '' },
      select: { id: true, principalId: true, status: true },
    }),
  ]);
  if (
    !credential
    || credential.kind !== 'api'
    || credential.status !== 'active'
    || credential.keyId !== authentication.credential.keyId
    || credential.agentIdentityId !== authentication.agent.id
    || credential.validFrom.getTime() > now.getTime()
    || (credential.expiresAt && credential.expiresAt.getTime() <= now.getTime())
  ) {
    deny('ACCESS_CREDENTIAL_NOT_LIVE', 'Authenticated Buyer access credential is not live');
  }
  if (!principal || principal.status !== 'active') deny('PRINCIPAL_NOT_ACTIVE', 'Buyer Principal is not active');
  if (!agent || agent.status !== 'active' || agent.principalId !== principal.id) {
    deny('AGENT_NOT_ACTIVE', 'Buyer AgentIdentity is not active or ownership no longer matches');
  }
}

async function loadSigningCredential(tx, authentication, signingKeyId, signatureAlgorithm, now) {
  const credential = await tx.agentCredential.findUnique({
    where: { keyId: signingKeyId },
    select: {
      id: true,
      agentIdentityId: true,
      kind: true,
      status: true,
      keyId: true,
      publicKeyJwk: true,
      algorithm: true,
      validFrom: true,
      expiresAt: true,
    },
  });
  if (!credential) deny('SIGNING_CREDENTIAL_NOT_FOUND', 'Acceptance signing credential does not exist');
  if (credential.kind !== 'signing') deny('SIGNING_CREDENTIAL_KIND_INVALID', 'Acceptance must use a signing credential');
  if (credential.agentIdentityId !== authentication.agent.id) {
    deny('SIGNING_CREDENTIAL_AGENT_MISMATCH', 'Acceptance signing credential does not belong to authenticated Buyer Agent');
  }
  if (credential.status !== 'active') deny('SIGNING_CREDENTIAL_INACTIVE', 'Acceptance signing credential is not active');
  if (credential.validFrom.getTime() > now.getTime()) deny('SIGNING_CREDENTIAL_NOT_YET_VALID', 'Acceptance signing credential is not yet valid');
  if (credential.expiresAt && credential.expiresAt.getTime() <= now.getTime()) {
    deny('SIGNING_CREDENTIAL_EXPIRED', 'Acceptance signing credential has expired');
  }
  if (signatureAlgorithm !== 'EdDSA' || credential.algorithm !== 'EdDSA') {
    deny('SIGNATURE_ALGORITHM_UNSUPPORTED', 'Signed Delivery acceptance supports EdDSA only');
  }
  if (!credential.publicKeyJwk || typeof credential.publicKeyJwk !== 'object') {
    deny('SIGNING_PUBLIC_KEY_MISSING', 'Acceptance signing credential has no public verification key');
  }
  return credential;
}

function verifySignature(commandHash, signingCredential, signature) {
  const signatureValue = nonEmpty(signature, 'buyerSignature');
  let publicKey;
  let signatureBytes;
  try {
    publicKey = createPublicKey({ key: signingCredential.publicKeyJwk, format: 'jwk' });
    signatureBytes = Buffer.from(signatureValue, 'base64url');
  } catch (error) {
    deny('SIGNATURE_MATERIAL_INVALID', 'Acceptance signature material is malformed', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!signatureBytes.length) deny('SIGNATURE_MATERIAL_INVALID', 'Acceptance signature is empty');
  if (!verifyDigitalSignature(null, Buffer.from(commandHash, 'hex'), publicKey, signatureBytes)) {
    deny('ECONOMIC_SIGNATURE_INVALID', 'Delivery acceptance signature verification failed');
  }
}

async function loadContractForUpdate(tx, contractId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT * FROM "contracts" WHERE "id" = ${contractId} FOR UPDATE`,
  );
  return rows[0] ?? null;
}

async function loadLatestDelivery(tx, contractId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT * FROM "deliveries" WHERE "contractId" = ${contractId} ORDER BY "sequence" DESC LIMIT 1`,
  );
  return rows[0] ?? null;
}

async function loadExisting(tx, idempotencyKey) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT * FROM "delivery_acceptance_decisions" WHERE "decisionIdempotencyKey" = ${idempotencyKey} LIMIT 1`,
  );
  return rows[0] ?? null;
}

function assertReplayMatches(existing, authentication, input) {
  if (
    existing.contractId !== input.contractId
    || existing.deliveryId !== input.deliveryId
    || existing.effectiveContractHash !== input.effectiveContractHash
    || existing.deliveryHash !== input.deliveryHash
    || existing.decision !== input.decision
    || existing.buyerPrincipalId !== authentication?.principal?.id
    || existing.buyerAgentIdentityId !== authentication?.agent?.id
    || existing.nonce !== input.nonce
  ) {
    deny('IDEMPOTENCY_CONFLICT', 'Acceptance idempotency key is already bound to different evidence');
  }
}

function isSerializationFailure(error) {
  if (error && typeof error === 'object' && error.code === 'P2034') return true;
  const diagnostic = `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`;
  return /could not serialize access|serialization|sqlstate.?40001|\b40001\b/i.test(diagnostic);
}


async function resolveRejectionDisposition(tx, contract, delivery, rejectionDecision, now) {
  const offerRevision = await tx.offerRevision.findUnique({
    where: { id: contract.acceptedOfferRevisionId },
    select: { termsPayload: true },
  });
  if (!offerRevision) {
    deny('REWORK_OFFER_REVISION_NOT_FOUND', 'Accepted Offer revision no longer resolves');
  }

  let policy;
  try {
    policy = resolveContractDeliveryPolicy(offerRevision.termsPayload);
  } catch (error) {
    if (error instanceof ReworkPolicyError) {
      deny('REWORK_POLICY_INVALID', error.message, error.details);
    }
    throw error;
  }

  if (!policy.explicitRework || delivery.sequence >= policy.maxAttempts) {
    return { nextState: 'disputed', reworkAuthorization: null, policy };
  }

  const reworkDeadline = new Date(now.getTime() + policy.reworkWindowSeconds * 1000);
  const evidence = buildReworkAuthorizationEvidence({
    contractId: contract.id,
    effectiveContractHash: contract.effectiveContractHash,
    rejectionDecisionId: rejectionDecision.id,
    rejectionDecisionHash: rejectionDecision.decisionHash,
    deliveryId: delivery.id,
    deliveryHash: delivery.deliveryHash,
    rejectedSequence: delivery.sequence,
    nextSequence: delivery.sequence + 1,
    maxAttempts: policy.maxAttempts,
    reworkWindowSeconds: policy.reworkWindowSeconds,
    reworkDeadline,
  });
  const evidenceHash = hashReworkAuthorizationEvidence(evidence);
  const id = randomUUID();

  const rows = await tx.$queryRaw(
    Prisma.sql`
      INSERT INTO "rework_authorizations" (
        "id", "contractId", "rejectionDecisionId", "deliveryId",
        "effectiveContractHash", "deliveryHash", "rejectedSequence",
        "nextSequence", "maxAttempts", "reworkWindowSeconds",
        "reworkDeadline", "evidenceHash"
      ) VALUES (
        ${id}, ${contract.id}, ${rejectionDecision.id}, ${delivery.id},
        ${contract.effectiveContractHash}, ${delivery.deliveryHash}, ${delivery.sequence},
        ${delivery.sequence + 1}, ${policy.maxAttempts}, ${policy.reworkWindowSeconds},
        ${reworkDeadline}, ${evidenceHash}
      )
      RETURNING *
    `,
  );

  return { nextState: 'rework', reworkAuthorization: rows[0], policy };
}

async function decideInTransaction(tx, authentication, input, now) {
  const idempotencyKey = nonEmpty(input?.decisionIdempotencyKey, 'decisionIdempotencyKey');
  const existing = await loadExisting(tx, idempotencyKey);
  if (existing) {
    assertReplayMatches(existing, authentication, input);
    const contractRows = await tx.$queryRaw(Prisma.sql`SELECT * FROM "contracts" WHERE "id" = ${existing.contractId}`);
    const escrow = contractRows[0]?.escrowId
      ? await tx.escrow.findUnique({ where: { id: contractRows[0].escrowId } })
      : null;
    const reworkAuthorization = existing.decision === 'reject'
      ? (await tx.$queryRaw(
          Prisma.sql`
            SELECT * FROM "rework_authorizations"
            WHERE "rejectionDecisionId" = ${existing.id}
            LIMIT 1
          `,
        ))[0] ?? null
      : null;
    return {
      acceptanceDecision: existing,
      contract: contractRows[0] ?? null,
      escrow,
      reworkAuthorization,
      idempotent: true,
    };
  }

  await assertLiveAccessIdentity(tx, authentication, now);
  const contractId = nonEmpty(input?.contractId, 'contractId');
  const contract = await loadContractForUpdate(tx, contractId);
  if (!contract) deny('ACCEPTANCE_CONTRACT_NOT_FOUND', 'Contract does not exist', { contractId });
  if (contract.lifecycleState !== 'acceptance_pending') {
    deny('ACCEPTANCE_CONTRACT_STATE_INVALID', 'Buyer decision requires ACCEPTANCE_PENDING Contract', {
      lifecycleState: contract.lifecycleState,
    });
  }
  if (
    contract.buyerPrincipalId !== authentication.principal.id
    || contract.buyerAgentIdentityId !== authentication.agent.id
  ) {
    deny('ACCEPTANCE_BUYER_MISMATCH', 'Authenticated Agent is not the Contract buyer');
  }
  if (contract.effectiveContractHash !== nonEmpty(input?.effectiveContractHash, 'effectiveContractHash')) {
    deny('ACCEPTANCE_CONTRACT_HASH_MISMATCH', 'Buyer decision is not bound to the current effective Contract hash');
  }

  const delivery = await loadLatestDelivery(tx, contractId);
  if (!delivery) deny('ACCEPTANCE_DELIVERY_NOT_FOUND', 'Contract has no protocol-valid Delivery');
  if (delivery.id !== nonEmpty(input?.deliveryId, 'deliveryId')) {
    deny('ACCEPTANCE_REQUIRES_LATEST_DELIVERY', 'Buyer decision must bind the latest Delivery');
  }
  if (delivery.deliveryHash !== nonEmpty(input?.deliveryHash, 'deliveryHash')) {
    deny('ACCEPTANCE_DELIVERY_HASH_MISMATCH', 'Buyer decision Delivery hash does not match immutable evidence');
  }

  const decision = normalizeDecision(input?.decision);
  const reason = normalizeReason(decision, input?.reasonCode, input?.reasonDetail);
  const nonce = nonEmpty(input?.nonce, 'nonce');
  const acceptanceEvidence = buildDeliveryAcceptanceEvidence({
    decisionIdempotencyKey: idempotencyKey,
    contractId,
    effectiveContractHash: contract.effectiveContractHash,
    deliveryId: delivery.id,
    deliveryHash: delivery.deliveryHash,
    decision,
    reasonCode: reason.reasonCode,
    reasonDetail: reason.reasonDetail,
    buyerPrincipalId: contract.buyerPrincipalId,
    buyerAgentIdentityId: contract.buyerAgentIdentityId,
    nonce,
  });
  const decisionHash = hashCanonical(acceptanceEvidence);
  const action = decision === 'accept' ? 'delivery.accept' : 'delivery.reject';
  const signatureAlgorithm = nonEmpty(input?.signatureAlgorithm, 'signatureAlgorithm');
  const signingKeyId = nonEmpty(input?.signatureKeyId, 'signatureKeyId');
  const commandEvidence = buildEconomicCommandEvidence({
    action,
    principalId: contract.buyerPrincipalId,
    agentIdentityId: contract.buyerAgentIdentityId,
    mandateId: input?.mandateId,
    payloadHash: decisionHash,
    nonce,
    issuedAt: input?.commandIssuedAt,
    expiresAt: input?.commandExpiresAt,
    signingKeyId,
    signatureAlgorithm,
  });
  assertCommandWindow(commandEvidence, now);
  const commandHash = hashEconomicCommandEvidence(commandEvidence);
  const signingCredential = await loadSigningCredential(tx, authentication, signingKeyId, signatureAlgorithm, now);
  verifySignature(commandHash, signingCredential, input?.buyerSignature);

  const authority = await resolveAuthority(tx, {
    mandateId: commandEvidence.mandateId,
    subjectAgentIdentityId: contract.buyerAgentIdentityId,
    action,
    at: now,
    counterpartyPrincipalId: contract.supplierPrincipalId,
  });
  const boundContext = bindAuthorityToAuthentication(authentication, authority);
  const authoritySnapshot = await captureAuthoritySnapshot(
    tx,
    boundContext,
    {
      action,
      counterpartyPrincipalId: contract.supplierPrincipalId,
      commandHash,
      payloadHash: decisionHash,
      nonce,
      signingCredentialId: signingCredential.id,
      signingKeyId,
      signatureAlgorithm,
      contractId,
      deliveryId: delivery.id,
      deliveryHash: delivery.deliveryHash,
      decision,
    },
    now,
  );

  const id = randomUUID();
  const inserted = await tx.$queryRaw(
    Prisma.sql`
      INSERT INTO "delivery_acceptance_decisions" (
        "id", "decisionIdempotencyKey", "contractId", "deliveryId",
        "effectiveContractHash", "deliveryHash", "decision", "source",
        "reasonCode", "reasonDetail", "buyerPrincipalId", "buyerAgentIdentityId",
        "authoritySnapshotId", "decisionHash", "commandHash", "nonce",
        "signatureAlgorithm", "signingKeyId", "buyerSignature",
        "commandIssuedAt", "commandExpiresAt", "decidedAt"
      ) VALUES (
        ${id}, ${idempotencyKey}, ${contractId}, ${delivery.id},
        ${contract.effectiveContractHash}, ${delivery.deliveryHash}, ${decision}, 'buyer_signed',
        ${reason.reasonCode}, ${reason.reasonDetail}, ${contract.buyerPrincipalId}, ${contract.buyerAgentIdentityId},
        ${authoritySnapshot.id}, ${decisionHash}, ${commandHash}, ${nonce},
        ${signatureAlgorithm}, ${signingKeyId}, ${nonEmpty(input?.buyerSignature, 'buyerSignature')},
        ${new Date(commandEvidence.issuedAt)}, ${new Date(commandEvidence.expiresAt)}, ${now}
      )
      RETURNING *
    `,
  );

  let reworkAuthorization = null;
  if (decision === 'reject') {
    const disposition = await resolveRejectionDisposition(
      tx,
      contract,
      delivery,
      inserted[0],
      now,
    );
    reworkAuthorization = disposition.reworkAuthorization;
    await tx.$executeRaw(
      Prisma.sql`
        UPDATE "contracts"
        SET "lifecycleState" = ${disposition.nextState}::"ContractLifecycleState"
        WHERE "id" = ${contractId}
      `,
    );
  }

  const contractRows = await tx.$queryRaw(Prisma.sql`SELECT * FROM "contracts" WHERE "id" = ${contractId}`);
  const escrow = contract.escrowId ? await tx.escrow.findUnique({ where: { id: contract.escrowId } }) : null;
  if (!escrow || escrow.status !== 'locked') {
    deny('ACCEPTANCE_ESCROW_STATE_INVALID', 'Buyer decision must not release or refund Escrow');
  }

  return {
    acceptanceDecision: inserted[0],
    authoritySnapshot,
    contract: contractRows[0],
    escrow,
    reworkAuthorization,
    idempotent: false,
  };
}

export async function decideSignedDelivery(prisma, authentication, input, options = {}) {
  const now = options.now instanceof Date ? new Date(options.now.getTime()) : new Date(options.now ?? Date.now());
  const maxAttempts = options.maxSerializationAttempts ?? 3;
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => decideInTransaction(tx, authentication, input, now),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      lastError = error;
      if (!isSerializationFailure(error) || attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
}
