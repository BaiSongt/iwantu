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
import { formAuthorizedContract } from './contract-formation.mjs';
import {
  SignedEconomicCommandError,
  buildEconomicCommandEvidence,
  canonicalEconomicCommandJson,
  hashEconomicCommandEvidence,
} from './signed-economic-command.mjs';

const ACCEPTANCE_PROTOCOL_VERSION = 'iwantu-offer-acceptance/0.1';
const RECEIPT_PROTOCOL_VERSION = 'iwantu-offer-acceptance-receipt/0.1';
const MAX_COMMAND_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const DECIMAL_RE = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/;

function deny(code, message, details) {
  throw new SignedEconomicCommandError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('ECONOMIC_COMMAND_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function positiveRevision(value, field) {
  if (!Number.isInteger(value) || value < 1) {
    deny('OFFER_REVISION_INVALID', `${field} must be a positive integer`, { field, value });
  }
  return value;
}

function asDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    deny('ECONOMIC_COMMAND_INVALID', `${field} must be a valid timestamp`, { field });
  }
  return date;
}

function hashCanonical(value) {
  return createHash('sha256').update(canonicalEconomicCommandJson(value), 'utf8').digest('hex');
}

export function buildOfferAcceptanceEvidence(input) {
  return {
    protocolVersion: ACCEPTANCE_PROTOCOL_VERSION,
    formationIdempotencyKey: nonEmpty(input?.formationIdempotencyKey, 'formationIdempotencyKey'),
    taskId: nonEmpty(input?.taskId, 'taskId'),
    taskRevision: positiveRevision(input?.taskRevision, 'taskRevision'),
    taskHash: nonEmpty(input?.taskHash, 'taskHash'),
    offerId: nonEmpty(input?.offerId, 'offerId'),
    offerRevision: positiveRevision(input?.offerRevision, 'offerRevision'),
    offerHash: nonEmpty(input?.offerHash, 'offerHash'),
    buyerPrincipalId: nonEmpty(input?.buyerPrincipalId, 'buyerPrincipalId'),
    buyerAgentIdentityId: nonEmpty(input?.buyerAgentIdentityId, 'buyerAgentIdentityId'),
    supplierPrincipalId: nonEmpty(input?.supplierPrincipalId, 'supplierPrincipalId'),
    priceAmount: nonEmpty(input?.priceAmount, 'priceAmount'),
    currency: nonEmpty(input?.currency, 'currency'),
    nonce: nonEmpty(input?.nonce, 'nonce'),
  };
}

export function hashOfferAcceptanceEvidence(evidence) {
  return hashCanonical(evidence);
}

function assertCommandWindow(evidence, now) {
  const issuedAt = new Date(evidence.issuedAt);
  const expiresAt = new Date(evidence.expiresAt);
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    deny('ECONOMIC_COMMAND_WINDOW_INVALID', 'Economic command expiresAt must be after issuedAt');
  }
  if (expiresAt.getTime() - issuedAt.getTime() > MAX_COMMAND_TTL_MS) {
    deny('ECONOMIC_COMMAND_WINDOW_INVALID', 'Economic command TTL exceeds the MVP maximum');
  }
  if (issuedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    deny('ECONOMIC_COMMAND_NOT_YET_VALID', 'Economic command issuedAt is too far in the future');
  }
  if (expiresAt.getTime() <= now.getTime()) {
    deny('ECONOMIC_COMMAND_EXPIRED', 'Economic command has expired');
  }
}

function decimalMinorUnits(value, field) {
  const raw = typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  const match = raw.match(DECIMAL_RE);
  if (!match) {
    deny('ECONOMIC_LIMIT_INVALID', `${field} must be a non-negative decimal with at most 8 decimals`, { field });
  }
  return BigInt(match[1]) * 100000000n + BigInt((match[2] ?? '').padEnd(8, '0'));
}

function assertAcceptanceEconomicLimit(authority, priceAmount, currency) {
  const limits = authority?.effective?.economicLimits;
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    deny('ECONOMIC_LIMIT_INVALID', 'Resolved Buyer Mandate has no usable economic limits');
  }
  if (limits.currency !== undefined && limits.currency !== currency) {
    deny('ECONOMIC_CURRENCY_DENIED', 'Resolved Buyer Mandate currency does not authorize this acceptance');
  }
  if (limits.singleContract === undefined) {
    deny('ECONOMIC_LIMIT_MISSING', 'Resolved Buyer Mandate must define singleContract for offer.accept');
  }
  if (decimalMinorUnits(priceAmount, 'priceAmount') > decimalMinorUnits(limits.singleContract, 'economicLimits.singleContract')) {
    deny('ECONOMIC_LIMIT_EXCEEDED', 'Offer price exceeds Buyer Mandate singleContract limit', {
      priceAmount,
      singleContract: String(limits.singleContract),
    });
  }
}

async function assertLiveAccessIdentity(tx, authentication, now) {
  if (authentication?.kind !== 'v2_agent_credential') {
    deny('V2_AGENT_AUTHENTICATION_REQUIRED', 'Signed Offer acceptance requires v2 AgentCredential authentication');
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
    deny('ACCESS_CREDENTIAL_NOT_LIVE', 'Authenticated access credential is not live for a new commitment');
  }
  if (!principal || principal.status !== 'active') deny('PRINCIPAL_NOT_ACTIVE', 'Authenticated Principal is not active');
  if (!agent || agent.status !== 'active' || agent.principalId !== principal.id) {
    deny('AGENT_NOT_ACTIVE', 'Authenticated AgentIdentity is not active or ownership no longer matches');
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
  if (!credential) deny('SIGNING_CREDENTIAL_NOT_FOUND', 'Economic signing credential does not exist');
  if (credential.kind !== 'signing') deny('SIGNING_CREDENTIAL_KIND_INVALID', 'Acceptance must use a signing credential');
  if (credential.agentIdentityId !== authentication.agent.id) {
    deny('SIGNING_CREDENTIAL_AGENT_MISMATCH', 'Signing credential does not belong to authenticated Buyer AgentIdentity');
  }
  if (credential.status !== 'active') deny('SIGNING_CREDENTIAL_INACTIVE', 'Signing credential is not active');
  if (credential.validFrom.getTime() > now.getTime()) deny('SIGNING_CREDENTIAL_NOT_YET_VALID', 'Signing credential is not yet valid');
  if (credential.expiresAt && credential.expiresAt.getTime() <= now.getTime()) {
    deny('SIGNING_CREDENTIAL_EXPIRED', 'Signing credential has expired');
  }
  if (signatureAlgorithm !== 'EdDSA' || credential.algorithm !== 'EdDSA') {
    deny('SIGNATURE_ALGORITHM_UNSUPPORTED', 'Signed Offer acceptance supports EdDSA only');
  }
  if (!credential.publicKeyJwk || typeof credential.publicKeyJwk !== 'object') {
    deny('SIGNING_PUBLIC_KEY_MISSING', 'Signing credential has no public verification key');
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
    deny('SIGNATURE_MATERIAL_INVALID', 'Economic signature material is malformed', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!signatureBytes.length) deny('SIGNATURE_MATERIAL_INVALID', 'Economic signature is empty');
  if (!verifyDigitalSignature(null, Buffer.from(commandHash, 'hex'), publicKey, signatureBytes)) {
    deny('ECONOMIC_SIGNATURE_INVALID', 'Offer acceptance signature verification failed');
  }
}

async function loadAcceptanceTarget(tx, offerId, offerRevision, offerHash, now) {
  const offer = await tx.offer.findUnique({ where: { id: offerId } });
  if (!offer) deny('OFFER_NOT_FOUND', 'Offer does not exist', { offerId });
  const task = await tx.task.findUnique({ where: { id: offer.taskId } });
  if (!task) deny('TASK_NOT_FOUND', 'Task does not exist', { taskId: offer.taskId });
  if (task.status !== 'open') deny('TASK_NOT_OPEN', 'Offer acceptance requires an OPEN Task', { taskId: task.id, status: task.status });
  if (offer.status !== 'active') deny('OFFER_NOT_ACTIVE', 'Offer acceptance requires an ACTIVE Firm Offer', { offerId, status: offer.status });
  if (offer.currentRevision !== offerRevision) {
    deny('OFFER_SUPERSEDED', 'Acceptance must bind the current Offer revision', {
      requestedRevision: offerRevision,
      currentRevision: offer.currentRevision,
    });
  }
  const revision = await tx.offerRevision.findUnique({
    where: { offerId_revision: { offerId, revision: offerRevision } },
  });
  if (!revision || revision.offerHash !== offerHash) {
    deny('OFFER_REVISION_MISMATCH', 'Acceptance Offer hash does not match immutable current revision');
  }
  if (revision.validUntil.getTime() <= now.getTime()) deny('OFFER_EXPIRED', 'Selected Firm Offer has expired');
  const taskRevision = await tx.taskRevision.findUnique({
    where: { taskId_revision: { taskId: task.id, revision: task.currentRevision } },
  });
  if (!taskRevision || !taskRevision.sealedAt) deny('TASK_REVISION_INVALID', 'Current Task revision is missing or unsealed');
  if (revision.taskRevisionId !== taskRevision.id || revision.taskHash !== taskRevision.contentHash) {
    deny('TASK_REVISION_MISMATCH', 'Selected Firm Offer is bound to a stale Task revision');
  }
  return { offer, revision, task, taskRevision };
}

function assertReplayMatches(receipt, authentication, input, now) {
  if (
    receipt.offerId !== input.offerId
    || receipt.offerRevision !== input.offerRevision
    || receipt.offerHash !== input.offerHash
    || receipt.formationIdempotencyKey !== input.formationIdempotencyKey
    || receipt.buyerPrincipalId !== authentication?.principal?.id
    || receipt.buyerAgentIdentityId !== authentication?.agent?.id
  ) {
    deny('ECONOMIC_COMMAND_REPLAY', 'Acceptance nonce has already been consumed by different evidence');
  }
  if (receipt.commandExpiresAt.getTime() <= now.getTime()) {
    deny('ECONOMIC_COMMAND_EXPIRED', 'Previously verified acceptance command has expired');
  }
}

async function authorizeAcceptance(prisma, authentication, input, now) {
  return prisma.$transaction(async (tx) => {
    const nonce = nonEmpty(input?.nonce, 'nonce');
    const replayRows = await tx.$queryRaw(
      Prisma.sql`SELECT * FROM "offer_acceptance_receipts" WHERE "nonce" = ${nonce} LIMIT 1`,
    );
    if (replayRows[0]) {
      assertReplayMatches(replayRows[0], authentication, input, now);
      const authoritySnapshot = await tx.authoritySnapshot.findUnique({ where: { id: replayRows[0].authoritySnapshotId } });
      return { receipt: replayRows[0], authoritySnapshot, acceptanceHash: replayRows[0].acceptanceHash, commandHash: replayRows[0].commandHash };
    }

    const offerRevision = positiveRevision(input?.offerRevision, 'offerRevision');
    const offerHash = nonEmpty(input?.offerHash, 'offerHash');
    const target = await loadAcceptanceTarget(tx, nonEmpty(input?.offerId, 'offerId'), offerRevision, offerHash, now);
    await assertLiveAccessIdentity(tx, authentication, now);
    if (
      target.task.issuerPrincipalId !== authentication.principal.id
      || target.task.issuerAgentIdentityId !== authentication.agent.id
    ) {
      deny('BUYER_TASK_AUTH_MISMATCH', 'Authenticated Buyer Agent is not the Task issuer');
    }

    const acceptanceEvidence = buildOfferAcceptanceEvidence({
      formationIdempotencyKey: input.formationIdempotencyKey,
      taskId: target.task.id,
      taskRevision: target.taskRevision.revision,
      taskHash: target.taskRevision.contentHash,
      offerId: target.offer.id,
      offerRevision,
      offerHash,
      buyerPrincipalId: target.task.issuerPrincipalId,
      buyerAgentIdentityId: target.task.issuerAgentIdentityId,
      supplierPrincipalId: target.offer.supplierPrincipalId,
      priceAmount: String(target.revision.priceAmount),
      currency: target.revision.currency,
      nonce,
    });
    const acceptanceHash = hashOfferAcceptanceEvidence(acceptanceEvidence);
    const signatureAlgorithm = nonEmpty(input?.signatureAlgorithm, 'signatureAlgorithm');
    const signingKeyId = nonEmpty(input?.signatureKeyId, 'signatureKeyId');
    const commandEvidence = buildEconomicCommandEvidence({
      action: 'offer.accept',
      principalId: target.task.issuerPrincipalId,
      agentIdentityId: target.task.issuerAgentIdentityId,
      mandateId: input.mandateId,
      payloadHash: acceptanceHash,
      nonce,
      issuedAt: input.commandIssuedAt,
      expiresAt: input.commandExpiresAt,
      signingKeyId,
      signatureAlgorithm,
    });
    assertCommandWindow(commandEvidence, now);
    const commandHash = hashEconomicCommandEvidence(commandEvidence);
    const signingCredential = await loadSigningCredential(tx, authentication, signingKeyId, signatureAlgorithm, now);
    verifySignature(commandHash, signingCredential, input.buyerSignature);

    const authority = await resolveAuthority(tx, {
      mandateId: commandEvidence.mandateId,
      subjectAgentIdentityId: target.task.issuerAgentIdentityId,
      action: 'offer.accept',
      at: now,
      counterpartyPrincipalId: target.offer.supplierPrincipalId,
    });
    assertAcceptanceEconomicLimit(authority, String(target.revision.priceAmount), target.revision.currency);
    const boundContext = bindAuthorityToAuthentication(authentication, authority);
    const authoritySnapshot = await captureAuthoritySnapshot(
      tx,
      boundContext,
      {
        action: 'offer.accept',
        economic: { singleContract: String(target.revision.priceAmount), currency: target.revision.currency },
        counterpartyPrincipalId: target.offer.supplierPrincipalId,
        commandHash,
        payloadHash: acceptanceHash,
        nonce,
        signingCredentialId: signingCredential.id,
        signingKeyId,
        signatureAlgorithm,
      },
      now,
    );

    const receiptEvidence = {
      protocolVersion: RECEIPT_PROTOCOL_VERSION,
      formationIdempotencyKey: acceptanceEvidence.formationIdempotencyKey,
      taskId: acceptanceEvidence.taskId,
      taskRevision: acceptanceEvidence.taskRevision,
      taskHash: acceptanceEvidence.taskHash,
      offerId: acceptanceEvidence.offerId,
      offerRevisionId: target.revision.id,
      offerRevision: acceptanceEvidence.offerRevision,
      offerHash: acceptanceEvidence.offerHash,
      acceptanceHash,
      commandHash,
      buyerPrincipalId: acceptanceEvidence.buyerPrincipalId,
      buyerAgentIdentityId: acceptanceEvidence.buyerAgentIdentityId,
      supplierPrincipalId: acceptanceEvidence.supplierPrincipalId,
      authoritySnapshotId: authoritySnapshot.id,
      authorityEvidenceHash: authoritySnapshot.evidenceHash,
      nonce,
      signatureAlgorithm,
      signingKeyId,
      buyerSignature: nonEmpty(input.buyerSignature, 'buyerSignature'),
      commandIssuedAt: new Date(commandEvidence.issuedAt).toISOString(),
      commandExpiresAt: new Date(commandEvidence.expiresAt).toISOString(),
      acceptedAt: now.toISOString(),
    };
    const receiptHash = hashCanonical(receiptEvidence);
    const receiptId = randomUUID();
    await tx.$executeRaw(
      Prisma.sql`
        INSERT INTO "offer_acceptance_receipts" (
          "id", "formationIdempotencyKey", "taskId", "taskRevision", "taskHash",
          "offerId", "offerRevisionId", "offerRevision", "offerHash", "acceptanceHash", "commandHash",
          "buyerPrincipalId", "buyerAgentIdentityId", "supplierPrincipalId", "authoritySnapshotId",
          "nonce", "signatureAlgorithm", "signingKeyId", "buyerSignature",
          "commandIssuedAt", "commandExpiresAt", "receiptHash", "acceptedAt"
        ) VALUES (
          ${receiptId}, ${receiptEvidence.formationIdempotencyKey}, ${receiptEvidence.taskId}, ${receiptEvidence.taskRevision}, ${receiptEvidence.taskHash},
          ${receiptEvidence.offerId}, ${receiptEvidence.offerRevisionId}, ${receiptEvidence.offerRevision}, ${receiptEvidence.offerHash}, ${acceptanceHash}, ${commandHash},
          ${receiptEvidence.buyerPrincipalId}, ${receiptEvidence.buyerAgentIdentityId}, ${receiptEvidence.supplierPrincipalId}, ${authoritySnapshot.id},
          ${nonce}, ${signatureAlgorithm}, ${signingKeyId}, ${receiptEvidence.buyerSignature},
          ${new Date(receiptEvidence.commandIssuedAt)}, ${new Date(receiptEvidence.commandExpiresAt)}, ${receiptHash}, ${now}
        )
      `,
    );
    return { receipt: { id: receiptId, ...receiptEvidence, receiptHash }, authoritySnapshot, acceptanceHash, commandHash };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

/**
 * Canonical M4-02 entry path for Buyer acceptance of a Supplier Firm Offer.
 *
 * The signed command is authenticated, signature-verified, resolved against a
 * live Buyer Mandate, snapshotted, and persisted as immutable acceptance
 * evidence before the M4-01 atomic Contract Formation boundary runs. The DB
 * formation gate independently requires this receipt, so unsigned callers
 * cannot create a new Contract by supplying an arbitrary AuthoritySnapshot.
 */
export async function acceptSignedFirmOffer(prisma, authentication, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('PROTOCOL_CLIENT_INVALID', 'acceptSignedFirmOffer requires a PrismaClient');
  }
  const now = asDate(options.now ?? new Date(), 'now');
  const authorized = await authorizeAcceptance(prisma, authentication, input, now);
  const formation = await formAuthorizedContract(
    prisma,
    {
      formationIdempotencyKey: nonEmpty(input?.formationIdempotencyKey, 'formationIdempotencyKey'),
      offerId: nonEmpty(input?.offerId, 'offerId'),
      offerRevision: positiveRevision(input?.offerRevision, 'offerRevision'),
      offerHash: nonEmpty(input?.offerHash, 'offerHash'),
      buyerAcceptanceHash: authorized.acceptanceHash,
      buyerAuthoritySnapshotId: authorized.authoritySnapshot.id,
    },
    { now, maxRetries: options.maxRetries },
  );
  return {
    ...formation,
    acceptanceReceipt: authorized.receipt,
    buyerAuthoritySnapshot: authorized.authoritySnapshot,
    acceptanceHash: authorized.acceptanceHash,
    commandHash: authorized.commandHash,
  };
}
