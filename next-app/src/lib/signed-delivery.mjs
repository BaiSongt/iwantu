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

const DELIVERY_PROTOCOL_VERSION = 'iwantu-delivery/0.1';
const MAX_COMMAND_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;
const SHA256_RE = /^[0-9a-f]{64}$/;

export class DeliveryProtocolError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'DeliveryProtocolError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new DeliveryProtocolError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('DELIVERY_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function asDate(value, field) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    deny('DELIVERY_INPUT_INVALID', `${field} must be a valid timestamp`, { field });
  }
  return date;
}

function hashCanonical(value) {
  return createHash('sha256').update(canonicalEconomicCommandJson(value), 'utf8').digest('hex');
}

function normalizeDeliverables(value) {
  if (!Array.isArray(value) || value.length === 0) {
    deny('DELIVERY_PAYLOAD_INVALID', 'deliverables must contain at least one immutable artifact reference');
  }
  return value.map((item, index) => {
    const assetRef = nonEmpty(item?.assetRef, `deliverables[${index}].assetRef`);
    const mediaType = nonEmpty(item?.mediaType, `deliverables[${index}].mediaType`);
    const contentHash = nonEmpty(item?.contentHash, `deliverables[${index}].contentHash`).toLowerCase();
    if (!SHA256_RE.test(contentHash)) {
      deny('DELIVERY_PAYLOAD_INVALID', `deliverables[${index}].contentHash must be a lowercase SHA-256 digest`);
    }
    return { assetRef, mediaType, contentHash };
  });
}

function normalizeEvidence(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) deny('DELIVERY_PAYLOAD_INVALID', 'evidence must be an array');
  return value;
}

export function buildDeliveryEvidence(input) {
  const deliverables = normalizeDeliverables(input?.deliverables);
  const evidence = normalizeEvidence(input?.evidence);
  return {
    protocolVersion: DELIVERY_PROTOCOL_VERSION,
    deliveryIdempotencyKey: nonEmpty(input?.deliveryIdempotencyKey, 'deliveryIdempotencyKey'),
    contractId: nonEmpty(input?.contractId, 'contractId'),
    effectiveContractHash: nonEmpty(input?.effectiveContractHash, 'effectiveContractHash'),
    acceptedOfferRevisionId: nonEmpty(input?.acceptedOfferRevisionId, 'acceptedOfferRevisionId'),
    sequence: input?.sequence,
    supplierPrincipalId: nonEmpty(input?.supplierPrincipalId, 'supplierPrincipalId'),
    supplierAgentIdentityId: nonEmpty(input?.supplierAgentIdentityId, 'supplierAgentIdentityId'),
    deliverables,
    evidence,
    nonce: nonEmpty(input?.nonce, 'nonce'),
  };
}

export function hashDeliveryPayload({ deliverables, evidence }) {
  return hashCanonical({ deliverables: normalizeDeliverables(deliverables), evidence: normalizeEvidence(evidence) });
}

export function hashDeliveryEvidence(evidence) {
  if (!Number.isInteger(evidence?.sequence) || evidence.sequence < 1) {
    deny('DELIVERY_SEQUENCE_INVALID', 'Delivery sequence must be a positive integer');
  }
  return hashCanonical(evidence);
}

function assertCommandWindow(commandEvidence, now) {
  const issuedAt = new Date(commandEvidence.issuedAt);
  const expiresAt = new Date(commandEvidence.expiresAt);
  if (expiresAt.getTime() <= issuedAt.getTime()) {
    deny('ECONOMIC_COMMAND_WINDOW_INVALID', 'Delivery command expiresAt must be after issuedAt');
  }
  if (expiresAt.getTime() - issuedAt.getTime() > MAX_COMMAND_TTL_MS) {
    deny('ECONOMIC_COMMAND_WINDOW_INVALID', 'Delivery command TTL exceeds the MVP maximum');
  }
  if (issuedAt.getTime() > now.getTime() + MAX_CLOCK_SKEW_MS) {
    deny('ECONOMIC_COMMAND_NOT_YET_VALID', 'Delivery command issuedAt is too far in the future');
  }
  if (expiresAt.getTime() <= now.getTime()) {
    deny('ECONOMIC_COMMAND_EXPIRED', 'Delivery command has expired');
  }
}

async function assertLiveAccessIdentity(tx, authentication, now) {
  if (authentication?.kind !== 'v2_agent_credential') {
    deny('V2_AGENT_AUTHENTICATION_REQUIRED', 'Signed Delivery requires v2 AgentCredential authentication');
  }
  const [credential, principal, agent] = await Promise.all([
    tx.agentCredential.findUnique({
      where: { id: authentication.credential?.id ?? '' },
      select: { id: true, agentIdentityId: true, kind: true, status: true, keyId: true, validFrom: true, expiresAt: true },
    }),
    tx.principal.findUnique({ where: { id: authentication.principal?.id ?? '' }, select: { id: true, status: true } }),
    tx.agentIdentity.findUnique({ where: { id: authentication.agent?.id ?? '' }, select: { id: true, principalId: true, status: true } }),
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
    deny('ACCESS_CREDENTIAL_NOT_LIVE', 'Authenticated access credential is not live for Delivery');
  }
  if (!principal || principal.status !== 'active') deny('PRINCIPAL_NOT_ACTIVE', 'Supplier Principal is not active');
  if (!agent || agent.status !== 'active' || agent.principalId !== principal.id) {
    deny('AGENT_NOT_ACTIVE', 'Supplier AgentIdentity is not active or ownership no longer matches');
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
  if (!credential) deny('SIGNING_CREDENTIAL_NOT_FOUND', 'Delivery signing credential does not exist');
  if (credential.kind !== 'signing') deny('SIGNING_CREDENTIAL_KIND_INVALID', 'Delivery must use a signing credential');
  if (credential.agentIdentityId !== authentication.agent.id) {
    deny('SIGNING_CREDENTIAL_AGENT_MISMATCH', 'Delivery signing credential does not belong to authenticated Supplier Agent');
  }
  if (credential.status !== 'active') deny('SIGNING_CREDENTIAL_INACTIVE', 'Delivery signing credential is not active');
  if (credential.validFrom.getTime() > now.getTime()) deny('SIGNING_CREDENTIAL_NOT_YET_VALID', 'Delivery signing credential is not yet valid');
  if (credential.expiresAt && credential.expiresAt.getTime() <= now.getTime()) {
    deny('SIGNING_CREDENTIAL_EXPIRED', 'Delivery signing credential has expired');
  }
  if (signatureAlgorithm !== 'EdDSA' || credential.algorithm !== 'EdDSA') {
    deny('SIGNATURE_ALGORITHM_UNSUPPORTED', 'Signed Delivery supports EdDSA only');
  }
  if (!credential.publicKeyJwk || typeof credential.publicKeyJwk !== 'object') {
    deny('SIGNING_PUBLIC_KEY_MISSING', 'Delivery signing credential has no public verification key');
  }
  return credential;
}

function verifySignature(commandHash, signingCredential, signature) {
  const signatureValue = nonEmpty(signature, 'supplierSignature');
  let publicKey;
  let signatureBytes;
  try {
    publicKey = createPublicKey({ key: signingCredential.publicKeyJwk, format: 'jwk' });
    signatureBytes = Buffer.from(signatureValue, 'base64url');
  } catch (error) {
    deny('SIGNATURE_MATERIAL_INVALID', 'Delivery signature material is malformed', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!signatureBytes.length) deny('SIGNATURE_MATERIAL_INVALID', 'Delivery signature is empty');
  if (!verifyDigitalSignature(null, Buffer.from(commandHash, 'hex'), publicKey, signatureBytes)) {
    deny('ECONOMIC_SIGNATURE_INVALID', 'Delivery signature verification failed');
  }
}

async function loadContractForUpdate(tx, contractId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT * FROM "contracts" WHERE "id" = ${contractId} FOR UPDATE`,
  );
  return rows[0] ?? null;
}

async function loadExisting(tx, idempotencyKey) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT * FROM "deliveries" WHERE "deliveryIdempotencyKey" = ${idempotencyKey} LIMIT 1`,
  );
  return rows[0] ?? null;
}

function assertReplayMatches(existing, input, authentication) {
  const normalizedDeliverables = normalizeDeliverables(input.deliverables);
  const normalizedEvidence = normalizeEvidence(input.evidence);
  const incomingPayloadHash = hashDeliveryPayload({ deliverables: normalizedDeliverables, evidence: normalizedEvidence });
  if (
    existing.contractId !== input.contractId
    || existing.effectiveContractHash !== input.effectiveContractHash
    || existing.supplierPrincipalId !== authentication?.principal?.id
    || existing.supplierAgentIdentityId !== authentication?.agent?.id
    || existing.payloadHash !== incomingPayloadHash
    || existing.nonce !== input.nonce
  ) {
    deny('IDEMPOTENCY_CONFLICT', 'Delivery idempotency key is already bound to different evidence');
  }
}

function isSerializationFailure(error) {
  if (error && typeof error === 'object' && error.code === 'P2034') return true;
  const diagnostic = `${error?.message ?? ''} ${JSON.stringify(error?.meta ?? {})}`;
  return /could not serialize access|serialization|sqlstate.?40001|\b40001\b/i.test(diagnostic);
}

async function submitInTransaction(tx, authentication, input, now) {
  const deliveryIdempotencyKey = nonEmpty(input?.deliveryIdempotencyKey, 'deliveryIdempotencyKey');
  const contractId = nonEmpty(input?.contractId, 'contractId');
  const expectedContractHash = nonEmpty(input?.effectiveContractHash, 'effectiveContractHash');

  const existing = await loadExisting(tx, deliveryIdempotencyKey);
  if (existing) {
    assertReplayMatches(existing, input, authentication);
    return { delivery: existing, idempotent: true };
  }

  await assertLiveAccessIdentity(tx, authentication, now);
  const contract = await loadContractForUpdate(tx, contractId);
  if (!contract) deny('DELIVERY_CONTRACT_NOT_FOUND', 'Contract does not exist', { contractId });
  if (!['active', 'rework'].includes(contract.lifecycleState)) {
    deny('DELIVERY_CONTRACT_STATE_INVALID', 'Delivery requires ACTIVE or REWORK Contract', {
      lifecycleState: contract.lifecycleState,
    });
  }
  if (contract.effectiveContractHash !== expectedContractHash) {
    deny('DELIVERY_CONTRACT_HASH_MISMATCH', 'Delivery is not bound to the current effective Contract hash');
  }
  if (
    contract.supplierPrincipalId !== authentication.principal.id
    || contract.supplierAgentIdentityId !== authentication.agent.id
  ) {
    deny('DELIVERY_SUPPLIER_MISMATCH', 'Authenticated Agent is not the Contract supplier');
  }

  const sequenceRows = await tx.$queryRaw(
    Prisma.sql`SELECT COALESCE(MAX("sequence"), 0)::int AS "lastSequence" FROM "deliveries" WHERE "contractId" = ${contractId}`,
  );
  const sequence = Number(sequenceRows[0]?.lastSequence ?? 0) + 1;

  const offerRevision = await tx.offerRevision.findUnique({ where: { id: contract.acceptedOfferRevisionId } });
  if (!offerRevision) deny('DELIVERY_OFFER_REVISION_NOT_FOUND', 'Accepted Offer revision no longer resolves');
  let contractDeliveryDeadline = null;
  let deadlineStatus = 'no_explicit_deadline';
  if (offerRevision.deliveryCommitmentSeconds !== null && offerRevision.deliveryCommitmentSeconds !== undefined) {
    contractDeliveryDeadline = new Date(contract.activatedAt.getTime() + offerRevision.deliveryCommitmentSeconds * 1000);
    if (now.getTime() > contractDeliveryDeadline.getTime()) {
      deny('DELIVERY_DEADLINE_EXCEEDED', 'Protocol-valid Delivery was submitted after the contractual deadline', {
        contractDeliveryDeadline: contractDeliveryDeadline.toISOString(),
      });
    }
    deadlineStatus = 'on_time';
  }

  const deliverables = normalizeDeliverables(input?.deliverables);
  const evidence = normalizeEvidence(input?.evidence);
  const nonce = nonEmpty(input?.nonce, 'nonce');
  const deliveryEvidence = buildDeliveryEvidence({
    deliveryIdempotencyKey,
    contractId,
    effectiveContractHash: contract.effectiveContractHash,
    acceptedOfferRevisionId: contract.acceptedOfferRevisionId,
    sequence,
    supplierPrincipalId: contract.supplierPrincipalId,
    supplierAgentIdentityId: contract.supplierAgentIdentityId,
    deliverables,
    evidence,
    nonce,
  });
  const payloadHash = hashDeliveryPayload({ deliverables, evidence });
  const deliveryHash = hashDeliveryEvidence(deliveryEvidence);
  const signatureAlgorithm = nonEmpty(input?.signatureAlgorithm, 'signatureAlgorithm');
  const signingKeyId = nonEmpty(input?.signatureKeyId, 'signatureKeyId');
  const commandEvidence = buildEconomicCommandEvidence({
    action: 'delivery.submit',
    principalId: contract.supplierPrincipalId,
    agentIdentityId: contract.supplierAgentIdentityId,
    mandateId: input?.mandateId,
    payloadHash: deliveryHash,
    nonce,
    issuedAt: input?.commandIssuedAt,
    expiresAt: input?.commandExpiresAt,
    signingKeyId,
    signatureAlgorithm,
  });
  assertCommandWindow(commandEvidence, now);
  const commandHash = hashEconomicCommandEvidence(commandEvidence);
  const signingCredential = await loadSigningCredential(tx, authentication, signingKeyId, signatureAlgorithm, now);
  verifySignature(commandHash, signingCredential, input?.supplierSignature);

  const authority = await resolveAuthority(tx, {
    mandateId: commandEvidence.mandateId,
    subjectAgentIdentityId: contract.supplierAgentIdentityId,
    action: 'delivery.submit',
    at: now,
    counterpartyPrincipalId: contract.buyerPrincipalId,
  });
  const boundContext = bindAuthorityToAuthentication(authentication, authority);
  const authoritySnapshot = await captureAuthoritySnapshot(
    tx,
    boundContext,
    {
      action: 'delivery.submit',
      counterpartyPrincipalId: contract.buyerPrincipalId,
      commandHash,
      payloadHash: deliveryHash,
      nonce,
      signingCredentialId: signingCredential.id,
      signingKeyId,
      signatureAlgorithm,
    },
    now,
  );

  const id = randomUUID();
  const inserted = await tx.$queryRaw(
    Prisma.sql`
      INSERT INTO "deliveries" (
        "id", "deliveryIdempotencyKey", "contractId", "effectiveContractHash",
        "acceptedOfferRevisionId", "sequence", "supplierPrincipalId", "supplierAgentIdentityId",
        "authoritySnapshotId", "deliverables", "evidence", "payloadHash", "deliveryHash",
        "commandHash", "nonce", "signatureAlgorithm", "signingKeyId", "supplierSignature",
        "commandIssuedAt", "commandExpiresAt", "contractDeliveryDeadline", "deadlineStatus", "submittedAt"
      ) VALUES (
        ${id}, ${deliveryIdempotencyKey}, ${contractId}, ${contract.effectiveContractHash},
        ${contract.acceptedOfferRevisionId}, ${sequence}, ${contract.supplierPrincipalId}, ${contract.supplierAgentIdentityId},
        ${authoritySnapshot.id}, CAST(${JSON.stringify(deliverables)} AS jsonb), CAST(${JSON.stringify(evidence)} AS jsonb),
        ${payloadHash}, ${deliveryHash}, ${commandHash}, ${nonce}, ${signatureAlgorithm}, ${signingKeyId},
        ${nonEmpty(input?.supplierSignature, 'supplierSignature')}, ${new Date(commandEvidence.issuedAt)},
        ${new Date(commandEvidence.expiresAt)}, ${contractDeliveryDeadline}, ${deadlineStatus}, ${now}
      ) RETURNING *
    `,
  );

  await tx.$executeRaw(
    Prisma.sql`
      UPDATE "contracts"
      SET "lifecycleState" = 'acceptance_pending'::"ContractLifecycleState"
      WHERE "id" = ${contractId}
    `,
  );

  const escrow = await tx.escrow.findUnique({ where: { id: contract.escrowId } });
  if (!escrow || escrow.status !== 'locked') {
    deny('DELIVERY_ESCROW_STATE_INVALID', 'Delivery must leave Contract Escrow locked');
  }

  return {
    delivery: inserted[0],
    authoritySnapshot,
    deliveryEvidence,
    deliveryHash,
    commandHash,
    contract: { ...contract, lifecycleState: 'acceptance_pending' },
    escrow,
    idempotent: false,
  };
}

export async function submitSignedDelivery(prisma, authentication, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('PROTOCOL_CLIENT_INVALID', 'submitSignedDelivery requires a PrismaClient');
  }
  const now = asDate(options.now ?? new Date(), 'now');
  const maxRetries = Number.isInteger(options.maxRetries) && options.maxRetries >= 0 ? options.maxRetries : 3;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      return await prisma.$transaction(
        (tx) => submitInTransaction(tx, authentication, input, now),
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof DeliveryProtocolError || error instanceof SignedEconomicCommandError) throw error;
      if (isSerializationFailure(error) && attempt < maxRetries) continue;
      if (isSerializationFailure(error)) {
        deny('DELIVERY_CONCURRENCY_RETRY_EXHAUSTED', 'Delivery concurrency retries exhausted');
      }
      if (error && typeof error === 'object' && error.code === 'P2002') {
        deny('IDEMPOTENCY_CONFLICT', 'Delivery collided with existing immutable evidence');
      }
      throw error;
    }
  }

  deny('DELIVERY_SUBMISSION_FAILED', 'Delivery submission failed unexpectedly');
}