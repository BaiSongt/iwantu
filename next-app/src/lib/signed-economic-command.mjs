import {
  createHash,
  createPublicKey,
  verify as verifyDigitalSignature,
} from 'node:crypto';
import { Prisma } from '@prisma/client';
import { bindAuthorityToAuthentication } from './agent-auth-context-core.mjs';
import {
  resolveAuthority,
  scopeSetAllows,
} from './authority/authority.mjs';
import { captureAuthoritySnapshot } from './authority/authority-snapshot.mjs';
import {
  buildFirmOfferEvidence,
  hashFirmOfferEvidence,
  hashOfferTerms,
  normalizeFirmOfferTerms,
} from './offer-protocol.mjs';

const ECONOMIC_COMMAND_PROTOCOL_VERSION = 'iwantu-economic-command/0.1';
const MAX_COMMAND_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const SHA256_RE = /^[0-9a-f]{64}$/;
const DECIMAL_RE = /^(0|[1-9]\d*)(?:\.(\d{1,8}))?$/;

export class SignedEconomicCommandError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'SignedEconomicCommandError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new SignedEconomicCommandError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('ECONOMIC_COMMAND_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function asDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    deny('ECONOMIC_COMMAND_INVALID', `${field} must be a valid timestamp`, { field });
  }
  return date;
}

function canonicalize(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalEconomicCommandJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function buildEconomicCommandEvidence(input) {
  const payloadHash = nonEmpty(input?.payloadHash, 'payloadHash');
  if (!SHA256_RE.test(payloadHash)) {
    deny('ECONOMIC_COMMAND_INVALID', 'payloadHash must be a lowercase SHA-256 hex digest');
  }
  const issuedAt = asDate(input.issuedAt, 'issuedAt');
  const expiresAt = asDate(input.expiresAt, 'expiresAt');

  return {
    protocolVersion: ECONOMIC_COMMAND_PROTOCOL_VERSION,
    action: nonEmpty(input.action, 'action'),
    principalId: nonEmpty(input.principalId, 'principalId'),
    agentIdentityId: nonEmpty(input.agentIdentityId, 'agentIdentityId'),
    mandateId: nonEmpty(input.mandateId, 'mandateId'),
    payloadHash,
    nonce: nonEmpty(input.nonce, 'nonce'),
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
    signingKeyId: nonEmpty(input.signingKeyId, 'signingKeyId'),
    signatureAlgorithm: nonEmpty(input.signatureAlgorithm, 'signatureAlgorithm'),
  };
}

export function hashEconomicCommandEvidence(evidence) {
  return createHash('sha256')
    .update(canonicalEconomicCommandJson(evidence), 'utf8')
    .digest('hex');
}

function assertCommandWindow(evidence, now) {
  const issuedAt = new Date(evidence.issuedAt);
  const expiresAt = new Date(evidence.expiresAt);
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    deny('ECONOMIC_COMMAND_WINDOW_INVALID', 'Economic command expiresAt must be after issuedAt');
  }
  if (expiresAt.getTime() - issuedAt.getTime() > MAX_COMMAND_TTL_MS) {
    deny('ECONOMIC_COMMAND_WINDOW_INVALID', 'Economic command TTL exceeds the MVP maximum', {
      maxTtlMs: MAX_COMMAND_TTL_MS,
    });
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
    deny('ECONOMIC_LIMIT_INVALID', `${field} must be a non-negative decimal with at most 8 decimals`, {
      field,
      value: raw,
    });
  }
  return BigInt(match[1]) * 100000000n + BigInt((match[2] ?? '').padEnd(8, '0'));
}

function assertExactOfferEconomicLimit(authority, priceAmount, currency) {
  const limits = authority?.effective?.economicLimits;
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
    deny('ECONOMIC_LIMIT_INVALID', 'Resolved Mandate has no usable economic limits');
  }
  if (limits.currency !== undefined && limits.currency !== currency) {
    deny('ECONOMIC_CURRENCY_DENIED', 'Resolved Mandate currency does not authorize this Offer', {
      allowedCurrency: limits.currency,
      requestedCurrency: currency,
    });
  }
  if (limits.singleContract === undefined) {
    deny('ECONOMIC_LIMIT_MISSING', 'Resolved Mandate must define singleContract for Firm Offer commands');
  }
  const requested = decimalMinorUnits(priceAmount, 'priceAmount');
  const allowed = decimalMinorUnits(limits.singleContract, 'economicLimits.singleContract');
  if (requested > allowed) {
    deny('ECONOMIC_LIMIT_EXCEEDED', 'Firm Offer price exceeds Mandate singleContract limit', {
      priceAmount,
      singleContract: String(limits.singleContract),
    });
  }
}

async function assertLiveAccessIdentity(tx, authentication, now) {
  if (authentication?.kind !== 'v2_agent_credential') {
    deny('V2_AGENT_AUTHENTICATION_REQUIRED', 'Signed economic command requires v2 AgentCredential authentication');
  }

  const [credential, principal, agent] = await Promise.all([
    tx.agentCredential.findUnique({
      where: { id: authentication.credential?.id ?? '' },
      select: {
        id: true,
        agentIdentityId: true,
        kind: true,
        status: true,
        keyId: true,
        validFrom: true,
        expiresAt: true,
      },
    }),
    tx.principal.findUnique({
      where: { id: authentication.principal?.id ?? '' },
      select: { id: true, status: true },
    }),
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
  if (!principal || principal.status !== 'active') {
    deny('PRINCIPAL_NOT_ACTIVE', 'Authenticated Principal is not active');
  }
  if (
    !agent
    || agent.status !== 'active'
    || agent.principalId !== principal.id
  ) {
    deny('AGENT_NOT_ACTIVE', 'Authenticated AgentIdentity is not active or ownership no longer matches');
  }
  return { credential, principal, agent };
}

async function loadSigningCredential(tx, authentication, evidence, now) {
  const credential = await tx.agentCredential.findUnique({
    where: { keyId: evidence.signingKeyId },
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

  if (!credential) {
    deny('SIGNING_CREDENTIAL_NOT_FOUND', 'Economic signing credential does not exist');
  }
  if (credential.kind !== 'signing') {
    deny('SIGNING_CREDENTIAL_KIND_INVALID', 'Economic command must use a signing credential, not an access credential');
  }
  if (credential.agentIdentityId !== authentication.agent.id) {
    deny('SIGNING_CREDENTIAL_AGENT_MISMATCH', 'Signing credential does not belong to authenticated AgentIdentity');
  }
  if (credential.status !== 'active') {
    deny('SIGNING_CREDENTIAL_INACTIVE', 'Signing credential is not active');
  }
  if (credential.validFrom.getTime() > now.getTime()) {
    deny('SIGNING_CREDENTIAL_NOT_YET_VALID', 'Signing credential is not yet valid');
  }
  if (credential.expiresAt && credential.expiresAt.getTime() <= now.getTime()) {
    deny('SIGNING_CREDENTIAL_EXPIRED', 'Signing credential has expired');
  }
  if (evidence.signatureAlgorithm !== 'EdDSA' || credential.algorithm !== 'EdDSA') {
    deny('SIGNATURE_ALGORITHM_UNSUPPORTED', 'M3-04 supports EdDSA economic signatures only');
  }
  if (!credential.publicKeyJwk || typeof credential.publicKeyJwk !== 'object') {
    deny('SIGNING_PUBLIC_KEY_MISSING', 'Signing credential has no public verification key');
  }
  return credential;
}

function verifyCommandSignature(evidence, commandHash, signingCredential, signature) {
  const signatureValue = nonEmpty(signature, 'supplierSignature');
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
  if (signatureBytes.length === 0) {
    deny('SIGNATURE_MATERIAL_INVALID', 'Economic signature is empty');
  }

  const valid = verifyDigitalSignature(
    null,
    Buffer.from(commandHash, 'hex'),
    publicKey,
    signatureBytes,
  );
  if (!valid) {
    deny('ECONOMIC_SIGNATURE_INVALID', 'Economic command signature verification failed');
  }
  return true;
}

function assertCapabilitiesWithinAuthority(authority, requiredCapabilityIds) {
  const grants = authority?.effective?.capabilityScopes;
  for (const capabilityId of requiredCapabilityIds) {
    if (!scopeSetAllows(grants, capabilityId)) {
      deny('CAPABILITY_NOT_AUTHORIZED', 'Mandate does not authorize a required Task capability', {
        capabilityId,
      });
    }
  }
}

async function authorizeOfferCommandInTx(tx, authentication, prepared, input, now) {
  await assertLiveAccessIdentity(tx, authentication, now);

  const evidence = buildEconomicCommandEvidence({
    action: prepared.action,
    principalId: authentication.principal.id,
    agentIdentityId: authentication.agent.id,
    mandateId: input.mandateId,
    payloadHash: prepared.offerHash,
    nonce: prepared.normalized.nonce,
    issuedAt: input.commandIssuedAt,
    expiresAt: input.commandExpiresAt,
    signingKeyId: prepared.normalized.signatureKeyId,
    signatureAlgorithm: prepared.normalized.signatureAlgorithm,
  });
  assertCommandWindow(evidence, now);
  const commandHash = hashEconomicCommandEvidence(evidence);
  const signingCredential = await loadSigningCredential(tx, authentication, evidence, now);
  verifyCommandSignature(
    evidence,
    commandHash,
    signingCredential,
    prepared.normalized.supplierSignature,
  );

  const authority = await resolveAuthority(tx, {
    mandateId: evidence.mandateId,
    subjectAgentIdentityId: authentication.agent.id,
    action: prepared.action,
    at: now,
    counterpartyPrincipalId: prepared.task.issuerPrincipalId,
  });
  assertCapabilitiesWithinAuthority(authority, prepared.requiredCapabilityIds);
  assertExactOfferEconomicLimit(
    authority,
    prepared.normalized.priceAmount,
    prepared.normalized.currency,
  );

  const boundContext = bindAuthorityToAuthentication(authentication, authority);
  const snapshot = await captureAuthoritySnapshot(
    tx,
    boundContext,
    {
      action: prepared.action,
      capabilityIds: prepared.requiredCapabilityIds,
      economic: {
        singleContract: prepared.normalized.priceAmount,
        currency: prepared.normalized.currency,
      },
      counterpartyPrincipalId: prepared.task.issuerPrincipalId,
      commandHash,
      payloadHash: prepared.offerHash,
      nonce: prepared.normalized.nonce,
      signingCredentialId: signingCredential.id,
      signingKeyId: signingCredential.keyId,
      signatureAlgorithm: evidence.signatureAlgorithm,
    },
    now,
  );

  return { evidence, commandHash, signingCredential, authority, snapshot };
}

async function lockOpenTaskWithCapabilities(tx, taskId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT "id", "issuerPrincipalId", "issuerAgentIdentityId", "status", "currentRevision"
      FROM "tasks"
      WHERE "id" = ${taskId}
      FOR SHARE
    `,
  );
  const task = rows[0] ?? null;
  if (!task) deny('TASK_NOT_FOUND', 'Task does not exist', { taskId });
  if (task.status !== 'open') {
    deny('TASK_NOT_OPEN', 'Firm Offer requires an OPEN Task', { taskId, status: task.status });
  }
  const revision = await tx.taskRevision.findUnique({
    where: { taskId_revision: { taskId, revision: task.currentRevision } },
    include: { capabilityRequirements: { orderBy: { capabilityId: 'asc' } } },
  });
  if (!revision || !revision.sealedAt) {
    deny('TASK_REVISION_INVALID', 'Current Task revision does not exist or is not sealed');
  }
  return { task, revision };
}

async function lockOffer(tx, offerId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT "id", "taskId", "supplierPrincipalId", "supplierAgentIdentityId", "status", "currentRevision"
      FROM "offers"
      WHERE "id" = ${offerId}
      FOR UPDATE
    `,
  );
  return rows[0] ?? null;
}

function prepareOfferRevision(action, task, taskRevision, offerRevision, principalId, agentIdentityId, input, now) {
  if (input.supplierAuthoritySnapshotId !== undefined && input.supplierAuthoritySnapshotId !== null) {
    deny('CALLER_AUTHORITY_SNAPSHOT_FORBIDDEN', 'Signed command path creates live AuthoritySnapshot server-side');
  }
  const normalized = normalizeFirmOfferTerms(input, now);
  if (!normalized.signatureAlgorithm || !normalized.signatureKeyId || !normalized.supplierSignature) {
    deny('SIGNATURE_EVIDENCE_REQUIRED', 'Signed Firm Offer requires signatureAlgorithm, signatureKeyId and supplierSignature');
  }
  const termsHash = hashOfferTerms(normalized.termsPayload);
  const offerEvidence = buildFirmOfferEvidence({
    taskId: task.id,
    taskRevision: taskRevision.revision,
    taskHash: taskRevision.contentHash,
    offerRevision,
    supplierPrincipalId: principalId,
    supplierAgentIdentityId: agentIdentityId,
    ...normalized,
    termsHash,
  });
  const offerHash = hashFirmOfferEvidence(offerEvidence);
  const requiredCapabilityIds = taskRevision.capabilityRequirements.map(
    (requirement) => requirement.capabilityId,
  );
  return {
    action,
    task,
    taskRevision,
    offerRevision,
    normalized,
    termsHash,
    offerEvidence,
    offerHash,
    requiredCapabilityIds,
  };
}

async function assertNonceUnused(tx, nonce) {
  const existing = await tx.offerRevision.findUnique({
    where: { nonce },
    select: { offerId: true, revision: true, offerHash: true },
  });
  if (existing) {
    deny('ECONOMIC_COMMAND_REPLAY', 'Firm Offer command nonce has already been consumed', {
      nonce,
      ...existing,
    });
  }
}

function offerRevisionData(offerId, prepared, snapshot) {
  return {
    offerId,
    revision: prepared.offerRevision,
    taskRevisionId: prepared.taskRevision.id,
    taskHash: prepared.taskRevision.contentHash,
    priceAmount: prepared.normalized.priceAmount,
    currency: prepared.normalized.currency,
    deliveryCommitmentSeconds: prepared.normalized.deliveryCommitmentSeconds,
    validUntil: prepared.normalized.validUntil,
    termsPayload: prepared.normalized.termsPayload,
    termsHash: prepared.termsHash,
    nonce: prepared.normalized.nonce,
    offerHash: prepared.offerHash,
    supplierAuthoritySnapshotId: snapshot.id,
    signatureAlgorithm: prepared.normalized.signatureAlgorithm,
    signatureKeyId: prepared.normalized.signatureKeyId,
    supplierSignature: prepared.normalized.supplierSignature,
  };
}

function isPrismaCode(error, code) {
  return Boolean(error && typeof error === 'object' && error.code === code);
}

/**
 * Canonical M3-04 path for a new Supplier Firm Offer commitment.
 *
 * Order is intentionally:
 * access identity -> exact Offer hash -> economic signature -> live Mandate ->
 * capability/economic/counterparty policy -> AuthoritySnapshot -> Offer write.
 */
export async function issueSignedFirmOffer(prisma, authentication, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('PROTOCOL_CLIENT_INVALID', 'issueSignedFirmOffer requires a PrismaClient');
  }
  const now = asDate(options.now ?? new Date(), 'now');
  const taskId = nonEmpty(input?.taskId, 'taskId');

  try {
    return await prisma.$transaction(async (tx) => {
      const { task, revision: taskRevision } = await lockOpenTaskWithCapabilities(tx, taskId);
      await assertLiveAccessIdentity(tx, authentication, now);

      if (input.supplierPrincipalId && input.supplierPrincipalId !== authentication.principal.id) {
        deny('SUPPLIER_PRINCIPAL_MISMATCH', 'Caller-supplied Supplier Principal does not match authentication');
      }
      if (input.supplierAgentIdentityId && input.supplierAgentIdentityId !== authentication.agent.id) {
        deny('SUPPLIER_AGENT_MISMATCH', 'Caller-supplied Supplier Agent does not match authentication');
      }

      const existing = await tx.offer.findUnique({
        where: {
          taskId_supplierPrincipalId: {
            taskId,
            supplierPrincipalId: authentication.principal.id,
          },
        },
        select: { id: true },
      });
      if (existing) {
        deny('OFFER_CHAIN_EXISTS', 'Supplier Principal already has an Offer chain for this Task', {
          taskId,
          offerId: existing.id,
        });
      }

      const prepared = prepareOfferRevision(
        'offer.issue',
        task,
        taskRevision,
        1,
        authentication.principal.id,
        authentication.agent.id,
        input,
        now,
      );
      await assertNonceUnused(tx, prepared.normalized.nonce);
      const authorization = await authorizeOfferCommandInTx(
        tx,
        authentication,
        prepared,
        input,
        now,
      );

      const offer = await tx.offer.create({
        data: {
          taskId,
          supplierPrincipalId: authentication.principal.id,
          supplierAgentIdentityId: authentication.agent.id,
          status: 'active',
          currentRevision: 1,
        },
      });
      const revision = await tx.offerRevision.create({
        data: offerRevisionData(offer.id, prepared, authorization.snapshot),
      });
      return {
        offer,
        revision,
        authoritySnapshot: authorization.snapshot,
        commandHash: authorization.commandHash,
      };
    });
  } catch (error) {
    if (error instanceof SignedEconomicCommandError) throw error;
    if (isPrismaCode(error, 'P2002')) {
      deny('ECONOMIC_COMMAND_REPLAY_OR_CONFLICT', 'Signed Firm Offer command collided with immutable protocol evidence');
    }
    throw error;
  }
}

/**
 * Canonical M3-04 path for a Supplier Firm Offer revision. Task -> Offer lock
 * order is preserved, and every revision receives fresh live authority evidence.
 */
export async function reviseSignedFirmOffer(prisma, authentication, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('PROTOCOL_CLIENT_INVALID', 'reviseSignedFirmOffer requires a PrismaClient');
  }
  const now = asDate(options.now ?? new Date(), 'now');
  const offerId = nonEmpty(input?.offerId, 'offerId');

  try {
    return await prisma.$transaction(async (tx) => {
      const envelope = await tx.offer.findUnique({
        where: { id: offerId },
        select: { id: true, taskId: true },
      });
      if (!envelope) deny('OFFER_NOT_FOUND', 'Offer does not exist', { offerId });

      const { task, revision: taskRevision } = await lockOpenTaskWithCapabilities(
        tx,
        envelope.taskId,
      );
      const offer = await lockOffer(tx, offerId);
      if (!offer) deny('OFFER_NOT_FOUND', 'Offer does not exist', { offerId });
      if (offer.status !== 'active') {
        deny('OFFER_NOT_REVISIONABLE', 'Only an active Firm Offer can be revised', {
          offerId,
          status: offer.status,
        });
      }
      await assertLiveAccessIdentity(tx, authentication, now);
      if (
        offer.supplierPrincipalId !== authentication.principal.id
        || offer.supplierAgentIdentityId !== authentication.agent.id
      ) {
        deny('OFFER_SUPPLIER_AUTH_MISMATCH', 'Authenticated Agent does not own this Firm Offer chain');
      }

      const prepared = prepareOfferRevision(
        'offer.revise',
        task,
        taskRevision,
        offer.currentRevision + 1,
        offer.supplierPrincipalId,
        offer.supplierAgentIdentityId,
        input,
        now,
      );
      await assertNonceUnused(tx, prepared.normalized.nonce);
      const authorization = await authorizeOfferCommandInTx(
        tx,
        authentication,
        prepared,
        input,
        now,
      );

      const revision = await tx.offerRevision.create({
        data: offerRevisionData(offer.id, prepared, authorization.snapshot),
      });
      const updatedOffer = await tx.offer.update({
        where: { id: offer.id },
        data: { currentRevision: prepared.offerRevision },
      });
      return {
        offer: updatedOffer,
        revision,
        authoritySnapshot: authorization.snapshot,
        commandHash: authorization.commandHash,
      };
    });
  } catch (error) {
    if (error instanceof SignedEconomicCommandError) throw error;
    if (isPrismaCode(error, 'P2002')) {
      deny('ECONOMIC_COMMAND_REPLAY_OR_CONFLICT', 'Signed Firm Offer command collided with immutable protocol evidence');
    }
    throw error;
  }
}
