import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

const FIRM_OFFER_PROTOCOL_VERSION = 'iwantu-firm-offer/0.1';
const MAX_INTEGER_DIGITS = 28;
const MAX_FRACTION_DIGITS = 8;

export class OfferProtocolError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'OfferProtocolError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new OfferProtocolError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('OFFER_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function normalizeJsonValue(value, field) {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      deny('OFFER_TERMS_INVALID', `${field} contains a non-finite number`, { field });
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeJsonValue(item, `${field}[${index}]`));
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeJsonValue(value[key], `${field}.${key}`)]),
    );
  }
  deny('OFFER_TERMS_INVALID', `${field} must be JSON-compatible`, { field });
}

function normalizeJsonObject(value, field) {
  const normalized = normalizeJsonValue(value ?? {}, field);
  if (!normalized || Array.isArray(normalized) || typeof normalized !== 'object') {
    deny('OFFER_TERMS_INVALID', `${field} must be a JSON object`, { field });
  }
  return normalized;
}

function canonicalize(value) {
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

export function canonicalOfferJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function normalizeOfferAmount(value) {
  const raw = typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : typeof value === 'string'
      ? value.trim()
      : '';
  const match = raw.match(
    new RegExp(`^(0|[1-9]\\d{0,${MAX_INTEGER_DIGITS - 1}})(?:\\.(\\d{1,${MAX_FRACTION_DIGITS}}))?$`),
  );
  if (!match) {
    deny(
      'OFFER_PRICE_INVALID',
      `priceAmount must be a non-negative decimal with at most ${MAX_INTEGER_DIGITS} integer digits and ${MAX_FRACTION_DIGITS} fractional digits`,
      { value: raw },
    );
  }
  return `${match[1]}.${(match[2] ?? '').padEnd(MAX_FRACTION_DIGITS, '0')}`;
}

function normalizeDeliveryCommitmentSeconds(value) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value) || value <= 0) {
    deny('OFFER_DELIVERY_COMMITMENT_INVALID', 'deliveryCommitmentSeconds must be a positive integer');
  }
  return value;
}

function normalizeValidUntil(value, now = new Date()) {
  const validUntil = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(validUntil.getTime())) {
    deny('OFFER_VALID_UNTIL_INVALID', 'validUntil must be a valid timestamp');
  }
  if (validUntil.getTime() <= now.getTime()) {
    deny('OFFER_EXPIRED', 'Firm Offer validUntil must be in the future', {
      validUntil: validUntil.toISOString(),
      now: now.toISOString(),
    });
  }
  return validUntil;
}

export function normalizeFirmOfferTerms(input, now = new Date()) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('OFFER_INPUT_INVALID', 'Firm Offer terms must be an object');
  }
  const currency = input.currency ?? 'IWC';
  if (currency !== 'IWC') {
    deny('OFFER_CURRENCY_INVALID', 'MVP Firm Offer currency must be IWC', { currency });
  }
  return {
    priceAmount: normalizeOfferAmount(input.priceAmount),
    currency,
    deliveryCommitmentSeconds: normalizeDeliveryCommitmentSeconds(
      input.deliveryCommitmentSeconds,
    ),
    validUntil: normalizeValidUntil(input.validUntil, now),
    termsPayload: normalizeJsonObject(input.termsPayload, 'termsPayload'),
    nonce: nonEmpty(input.nonce, 'nonce'),
    supplierAuthoritySnapshotId: nonEmpty(
      input.supplierAuthoritySnapshotId,
      'supplierAuthoritySnapshotId',
    ),
    signatureAlgorithm: nonEmpty(input.signatureAlgorithm, 'signatureAlgorithm'),
    signatureKeyId: nonEmpty(input.signatureKeyId, 'signatureKeyId'),
    supplierSignature: nonEmpty(input.supplierSignature, 'supplierSignature'),
  };
}

export function hashOfferTerms(termsPayload) {
  return createHash('sha256').update(canonicalOfferJson(termsPayload), 'utf8').digest('hex');
}

export function buildFirmOfferEvidence(input) {
  return {
    protocolVersion: FIRM_OFFER_PROTOCOL_VERSION,
    taskId: input.taskId,
    taskRevision: input.taskRevision,
    taskHash: input.taskHash,
    offerRevision: input.offerRevision,
    priceAmount: input.priceAmount,
    currency: input.currency,
    deliveryCommitmentSeconds: input.deliveryCommitmentSeconds,
    validUntil: input.validUntil.toISOString(),
    termsPayload: input.termsPayload,
    termsHash: input.termsHash,
    supplierPrincipalId: input.supplierPrincipalId,
    supplierAgentIdentityId: input.supplierAgentIdentityId,
    supplierAuthoritySnapshotId: input.supplierAuthoritySnapshotId,
    nonce: input.nonce,
  };
}

export function hashFirmOfferEvidence(evidence) {
  return createHash('sha256').update(canonicalOfferJson(evidence), 'utf8').digest('hex');
}

export function buildFirmOfferHash(input, now = new Date()) {
  const normalized = normalizeFirmOfferTerms(input, now);
  const termsHash = hashOfferTerms(normalized.termsPayload);
  return hashFirmOfferEvidence(buildFirmOfferEvidence({
    taskId: nonEmpty(input.taskId, 'taskId'),
    taskRevision: input.taskRevision,
    taskHash: nonEmpty(input.taskHash, 'taskHash'),
    offerRevision: input.offerRevision,
    supplierPrincipalId: nonEmpty(input.supplierPrincipalId, 'supplierPrincipalId'),
    supplierAgentIdentityId: nonEmpty(input.supplierAgentIdentityId, 'supplierAgentIdentityId'),
    ...normalized,
    termsHash,
  }));
}

async function requireActiveSupplier(tx, principalId, agentIdentityId) {
  const [principal, agent] = await Promise.all([
    tx.principal.findUnique({
      where: { id: principalId },
      select: { id: true, status: true },
    }),
    tx.agentIdentity.findUnique({
      where: { id: agentIdentityId },
      select: { id: true, principalId: true, status: true },
    }),
  ]);

  if (!principal) deny('OFFER_SUPPLIER_PRINCIPAL_NOT_FOUND', 'Supplier Principal does not exist');
  if (principal.status !== 'active') {
    deny('OFFER_SUPPLIER_PRINCIPAL_INACTIVE', 'Supplier Principal must be active', {
      principalId,
      status: principal.status,
    });
  }
  if (!agent) deny('OFFER_SUPPLIER_AGENT_NOT_FOUND', 'Supplier AgentIdentity does not exist');
  if (agent.principalId !== principalId) {
    deny('OFFER_SUPPLIER_OWNERSHIP_MISMATCH', 'Supplier AgentIdentity must belong to Supplier Principal', {
      principalId,
      agentIdentityId,
      agentPrincipalId: agent.principalId,
    });
  }
  if (agent.status !== 'active') {
    deny('OFFER_SUPPLIER_AGENT_INACTIVE', 'Supplier AgentIdentity must be active', {
      agentIdentityId,
      status: agent.status,
    });
  }
}

async function requireSupplierAuthoritySnapshot(tx, snapshotId, principalId, agentIdentityId) {
  const snapshot = await tx.authoritySnapshot.findUnique({
    where: { id: snapshotId },
    select: { id: true, principalId: true, agentIdentityId: true },
  });
  if (!snapshot) {
    deny('OFFER_AUTHORITY_SNAPSHOT_NOT_FOUND', 'Supplier AuthoritySnapshot does not exist', {
      snapshotId,
    });
  }
  if (snapshot.principalId !== principalId || snapshot.agentIdentityId !== agentIdentityId) {
    deny(
      'OFFER_AUTHORITY_SNAPSHOT_MISMATCH',
      'Supplier AuthoritySnapshot must belong to the Offer supplier Principal/Agent',
      { snapshotId, principalId, agentIdentityId },
    );
  }
  return snapshot;
}

async function lockOpenTaskAndCurrentRevision(tx, taskId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT "id", "issuerPrincipalId", "status", "currentRevision"
      FROM "tasks"
      WHERE "id" = ${taskId}
      FOR SHARE
    `,
  );
  const task = rows[0];
  if (!task) deny('OFFER_TASK_NOT_FOUND', 'Task does not exist', { taskId });
  if (task.status !== 'open') {
    deny('TASK_NOT_OPEN', 'Firm Offer requires an OPEN Task', { taskId, status: task.status });
  }

  const revision = await tx.taskRevision.findUnique({
    where: { taskId_revision: { taskId, revision: task.currentRevision } },
  });
  if (!revision || !revision.sealedAt) {
    deny('TASK_REVISION_INVALID', 'Current Task revision must exist and be sealed', {
      taskId,
      revision: task.currentRevision,
    });
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

async function createOfferRevision(tx, offer, taskRevision, revisionNumber, normalized) {
  await requireSupplierAuthoritySnapshot(
    tx,
    normalized.supplierAuthoritySnapshotId,
    offer.supplierPrincipalId,
    offer.supplierAgentIdentityId,
  );
  const termsHash = hashOfferTerms(normalized.termsPayload);
  const evidence = buildFirmOfferEvidence({
    taskId: offer.taskId,
    taskRevision: taskRevision.revision,
    taskHash: taskRevision.contentHash,
    offerRevision: revisionNumber,
    supplierPrincipalId: offer.supplierPrincipalId,
    supplierAgentIdentityId: offer.supplierAgentIdentityId,
    ...normalized,
    termsHash,
  });
  const offerHash = hashFirmOfferEvidence(evidence);

  return tx.offerRevision.create({
    data: {
      offerId: offer.id,
      revision: revisionNumber,
      taskRevisionId: taskRevision.id,
      taskHash: taskRevision.contentHash,
      priceAmount: normalized.priceAmount,
      currency: normalized.currency,
      deliveryCommitmentSeconds: normalized.deliveryCommitmentSeconds,
      validUntil: normalized.validUntil,
      termsPayload: normalized.termsPayload,
      termsHash,
      nonce: normalized.nonce,
      offerHash,
      supplierAuthoritySnapshotId: normalized.supplierAuthoritySnapshotId,
      signatureAlgorithm: normalized.signatureAlgorithm,
      signatureKeyId: normalized.signatureKeyId,
      supplierSignature: normalized.supplierSignature,
    },
  });
}

function isPrismaCode(error, code) {
  return Boolean(error && typeof error === 'object' && error.code === code);
}

export async function issueFirmOffer(prisma, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('OFFER_CLIENT_INVALID', 'issueFirmOffer requires a PrismaClient');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('OFFER_INPUT_INVALID', 'Firm Offer input must be an object');
  }
  const taskId = nonEmpty(input.taskId, 'taskId');
  const supplierPrincipalId = nonEmpty(input.supplierPrincipalId, 'supplierPrincipalId');
  const supplierAgentIdentityId = nonEmpty(
    input.supplierAgentIdentityId,
    'supplierAgentIdentityId',
  );
  const normalized = normalizeFirmOfferTerms(input, options.now ?? new Date());

  try {
    return await prisma.$transaction(async (tx) => {
      await requireActiveSupplier(tx, supplierPrincipalId, supplierAgentIdentityId);
      const { revision: taskRevision } = await lockOpenTaskAndCurrentRevision(tx, taskId);

      const existing = await tx.offer.findUnique({
        where: { taskId_supplierPrincipalId: { taskId, supplierPrincipalId } },
        select: { id: true },
      });
      if (existing) {
        deny('OFFER_CHAIN_EXISTS', 'Supplier Principal already has an Offer chain for this Task', {
          taskId,
          supplierPrincipalId,
          offerId: existing.id,
        });
      }

      const offer = await tx.offer.create({
        data: {
          taskId,
          supplierPrincipalId,
          supplierAgentIdentityId,
          status: 'active',
          currentRevision: 1,
        },
      });
      const revision = await createOfferRevision(tx, offer, taskRevision, 1, normalized);
      return { offer, revision };
    });
  } catch (error) {
    if (error instanceof OfferProtocolError) throw error;
    if (isPrismaCode(error, 'P2002')) {
      deny('OFFER_UNIQUE_CONFLICT', 'Firm Offer uniqueness or replay protection rejected the request');
    }
    throw error;
  }
}

export async function reviseFirmOffer(prisma, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('OFFER_CLIENT_INVALID', 'reviseFirmOffer requires a PrismaClient');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('OFFER_INPUT_INVALID', 'Firm Offer revision input must be an object');
  }
  const offerId = nonEmpty(input.offerId, 'offerId');
  const normalized = normalizeFirmOfferTerms(input, options.now ?? new Date());

  try {
    return await prisma.$transaction(async (tx) => {
      const offer = await lockOffer(tx, offerId);
      if (!offer) deny('OFFER_NOT_FOUND', 'Offer does not exist', { offerId });
      if (offer.status !== 'active') {
        deny('OFFER_NOT_REVISIONABLE', 'Only an active Firm Offer can be revised', {
          offerId,
          status: offer.status,
        });
      }

      await requireActiveSupplier(tx, offer.supplierPrincipalId, offer.supplierAgentIdentityId);
      const { revision: taskRevision } = await lockOpenTaskAndCurrentRevision(tx, offer.taskId);
      const revisionNumber = offer.currentRevision + 1;
      const revision = await createOfferRevision(
        tx,
        offer,
        taskRevision,
        revisionNumber,
        normalized,
      );
      const updatedOffer = await tx.offer.update({
        where: { id: offerId },
        data: { currentRevision: revisionNumber },
      });
      return { offer: updatedOffer, revision };
    });
  } catch (error) {
    if (error instanceof OfferProtocolError) throw error;
    if (isPrismaCode(error, 'P2002')) {
      deny('OFFER_UNIQUE_CONFLICT', 'Firm Offer uniqueness or replay protection rejected the request');
    }
    throw error;
  }
}

export async function loadOfferRevisionSnapshot(prisma, input) {
  const offerId = nonEmpty(input?.offerId, 'offerId');
  const revision = input?.revision;
  if (!Number.isInteger(revision) || revision < 1) {
    deny('OFFER_REVISION_INVALID', 'revision must be a positive integer', { revision });
  }
  const snapshot = await prisma.offerRevision.findUnique({
    where: { offerId_revision: { offerId, revision } },
  });
  if (!snapshot) {
    deny('OFFER_REVISION_NOT_FOUND', 'Offer revision does not exist', { offerId, revision });
  }
  return snapshot;
}

export async function loadCurrentFirmOfferSnapshot(prisma, input) {
  const offerId = nonEmpty(input?.offerId, 'offerId');
  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) deny('OFFER_NOT_FOUND', 'Offer does not exist', { offerId });
  const revision = await loadOfferRevisionSnapshot(prisma, {
    offerId,
    revision: offer.currentRevision,
  });
  return { offer, revision };
}
