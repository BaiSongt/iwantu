import {
  createPublicKey,
  verify as verifyDigitalSignature,
} from 'node:crypto';
import {
  buildFirmOfferEvidence,
  canonicalOfferJson,
  hashFirmOfferEvidence,
  hashOfferTerms,
  normalizeOfferAmount,
} from './offer-protocol.mjs';
import { sha256Evidence } from './authority/authority-snapshot.mjs';

const SHA256_RE = /^[0-9a-f]{64}$/;

export class FirmOfferIntegrityError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'FirmOfferIntegrityError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new FirmOfferIntegrityError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('OFFER_INTEGRITY_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function positiveRevision(value) {
  if (!Number.isInteger(value) || value < 1) {
    deny('OFFER_INTEGRITY_INPUT_INVALID', 'revision must be a positive integer', { revision: value });
  }
  return value;
}

function assertSha256(value, field) {
  if (typeof value !== 'string' || !SHA256_RE.test(value)) {
    deny('OFFER_INTEGRITY_HASH_INVALID', `${field} must be a lowercase SHA-256 digest`, { field });
  }
}

function buildStoredAuthorityEvidence(snapshot) {
  return {
    protocolVersion: snapshot.protocolVersion,
    principalId: snapshot.principalId,
    agentIdentityId: snapshot.agentIdentityId,
    credentialId: snapshot.credentialId,
    credentialKeyId: snapshot.credentialKeyId,
    leafMandateId: snapshot.leafMandateId,
    mandateChain: snapshot.mandateChain,
    authorityChainHash: snapshot.authorityChainHash,
    effectiveAuthority: snapshot.effectiveAuthority,
    requestEvidence: snapshot.requestEvidence,
    resolvedAction: snapshot.resolvedAction,
    resolvedCapabilityId: snapshot.resolvedCapabilityId,
    resolvedAt: snapshot.resolvedAt,
  };
}

function verifyHistoricalSignature(revision, snapshot, signingCredential) {
  const request = snapshot.requestEvidence;
  const commandHash = request?.commandHash;
  assertSha256(commandHash, 'AuthoritySnapshot.requestEvidence.commandHash');

  if (!signingCredential) {
    deny('OFFER_SIGNING_CREDENTIAL_NOT_FOUND', 'Historical signing credential referenced by the Offer is missing');
  }
  if (signingCredential.kind !== 'signing') {
    deny('OFFER_SIGNING_CREDENTIAL_KIND_INVALID', 'Historical economic signature must reference a SIGNING credential');
  }
  if (signingCredential.agentIdentityId !== snapshot.agentIdentityId) {
    deny('OFFER_SIGNING_CREDENTIAL_AGENT_MISMATCH', 'Historical signing credential does not belong to the Offer Agent');
  }
  if (signingCredential.keyId !== revision.signatureKeyId) {
    deny('OFFER_SIGNING_KEY_MISMATCH', 'Stored Offer signing key does not match AuthoritySnapshot evidence');
  }
  if (signingCredential.algorithm !== revision.signatureAlgorithm || revision.signatureAlgorithm !== 'EdDSA') {
    deny('OFFER_SIGNATURE_ALGORITHM_MISMATCH', 'Stored Offer signature algorithm is not the verified M3 EdDSA algorithm');
  }
  if (!signingCredential.publicKeyJwk || typeof signingCredential.publicKeyJwk !== 'object') {
    deny('OFFER_SIGNING_PUBLIC_KEY_MISSING', 'Historical signing credential has no public verification key');
  }

  let publicKey;
  let signatureBytes;
  try {
    publicKey = createPublicKey({ key: signingCredential.publicKeyJwk, format: 'jwk' });
    signatureBytes = Buffer.from(revision.supplierSignature, 'base64url');
  } catch (error) {
    deny('OFFER_SIGNATURE_MATERIAL_INVALID', 'Stored Firm Offer signature material is malformed', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }

  if (
    signatureBytes.length === 0
    || !verifyDigitalSignature(null, Buffer.from(commandHash, 'hex'), publicKey, signatureBytes)
  ) {
    deny('OFFER_SIGNATURE_INVALID', 'Stored Firm Offer economic signature does not verify');
  }
}

/**
 * Re-verify immutable Firm Offer evidence before Contract Formation consumes it.
 *
 * This is historical integrity verification, not live authorization. It proves
 * that the persisted Task binding, Offer hash, AuthoritySnapshot, signing key,
 * and signature still form one coherent commitment record. Contract Formation
 * must separately resolve current Buyer authority and current Supplier
 * formability/kill-switch policy.
 */
export async function verifyStoredFirmOfferIntegrity(prisma, input) {
  if (!prisma || typeof prisma.offer?.findUnique !== 'function') {
    deny('OFFER_INTEGRITY_CLIENT_INVALID', 'verifyStoredFirmOfferIntegrity requires a PrismaClient');
  }
  const offerId = nonEmpty(input?.offerId, 'offerId');
  const revisionNumber = positiveRevision(input?.revision);
  const expectedOfferHash = input?.offerHash ? nonEmpty(input.offerHash, 'offerHash') : null;

  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) deny('OFFER_NOT_FOUND', 'Offer does not exist', { offerId });

  const revision = await prisma.offerRevision.findUnique({
    where: { offerId_revision: { offerId, revision: revisionNumber } },
  });
  if (!revision) {
    deny('OFFER_REVISION_NOT_FOUND', 'Offer revision does not exist', { offerId, revision: revisionNumber });
  }

  if (expectedOfferHash && revision.offerHash !== expectedOfferHash) {
    deny('OFFER_REVISION_MISMATCH', 'Requested Offer hash does not match stored immutable revision', {
      expectedOfferHash: revision.offerHash,
      providedOfferHash: expectedOfferHash,
    });
  }

  const [taskRevision, snapshot] = await Promise.all([
    prisma.taskRevision.findUnique({ where: { id: revision.taskRevisionId } }),
    prisma.authoritySnapshot.findUnique({ where: { id: revision.supplierAuthoritySnapshotId } }),
  ]);

  if (!taskRevision || !taskRevision.sealedAt) {
    deny('OFFER_TASK_REVISION_INVALID', 'Stored Firm Offer does not reference a sealed TaskRevision');
  }
  if (taskRevision.taskId !== offer.taskId || taskRevision.contentHash !== revision.taskHash) {
    deny('OFFER_TASK_BINDING_INVALID', 'Stored Firm Offer Task snapshot binding is inconsistent');
  }

  const termsHash = hashOfferTerms(revision.termsPayload);
  if (termsHash !== revision.termsHash) {
    deny('OFFER_TERMS_HASH_MISMATCH', 'Stored Firm Offer terms hash does not match immutable terms payload');
  }

  const evidence = buildFirmOfferEvidence({
    taskId: offer.taskId,
    taskRevision: taskRevision.revision,
    taskHash: taskRevision.contentHash,
    offerRevision: revision.revision,
    priceAmount: normalizeOfferAmount(revision.priceAmount.toString()),
    currency: revision.currency,
    deliveryCommitmentSeconds: revision.deliveryCommitmentSeconds,
    validUntil: revision.validUntil,
    termsPayload: revision.termsPayload,
    termsHash,
    supplierPrincipalId: offer.supplierPrincipalId,
    supplierAgentIdentityId: offer.supplierAgentIdentityId,
    nonce: revision.nonce,
  });
  const recomputedOfferHash = hashFirmOfferEvidence(evidence);
  if (recomputedOfferHash !== revision.offerHash) {
    deny('OFFER_HASH_MISMATCH', 'Stored Firm Offer hash does not match canonical immutable commitment evidence', {
      storedOfferHash: revision.offerHash,
      recomputedOfferHash,
      canonicalEvidence: canonicalOfferJson(evidence),
    });
  }

  if (!snapshot) {
    deny('OFFER_AUTHORITY_SNAPSHOT_NOT_FOUND', 'Stored Firm Offer AuthoritySnapshot is missing');
  }
  if (
    snapshot.principalId !== offer.supplierPrincipalId
    || snapshot.agentIdentityId !== offer.supplierAgentIdentityId
  ) {
    deny('OFFER_AUTHORITY_SUBJECT_MISMATCH', 'Stored AuthoritySnapshot does not belong to the Firm Offer supplier');
  }

  const expectedAction = revision.revision === 1 ? 'offer.issue' : 'offer.revise';
  const request = snapshot.requestEvidence;
  if (
    !request
    || typeof request !== 'object'
    || Array.isArray(request)
    || snapshot.resolvedAction !== expectedAction
    || request.action !== expectedAction
    || request.payloadHash !== revision.offerHash
    || request.nonce !== revision.nonce
    || request.signingKeyId !== revision.signatureKeyId
    || request.signatureAlgorithm !== revision.signatureAlgorithm
  ) {
    deny('OFFER_AUTHORITY_EVIDENCE_MISMATCH', 'AuthoritySnapshot is not bound to this exact signed Firm Offer command', {
      expectedAction,
      snapshotId: snapshot.id,
    });
  }

  const recomputedSnapshotHash = sha256Evidence(buildStoredAuthorityEvidence(snapshot));
  if (recomputedSnapshotHash !== snapshot.evidenceHash) {
    deny('OFFER_AUTHORITY_SNAPSHOT_HASH_MISMATCH', 'AuthoritySnapshot evidence hash is inconsistent');
  }

  const signingCredentialId = request.signingCredentialId;
  if (typeof signingCredentialId !== 'string' || signingCredentialId.length === 0) {
    deny('OFFER_SIGNING_CREDENTIAL_EVIDENCE_MISSING', 'AuthoritySnapshot does not identify the historical signing credential');
  }
  const signingCredential = await prisma.agentCredential.findUnique({
    where: { id: signingCredentialId },
    select: {
      id: true,
      agentIdentityId: true,
      kind: true,
      keyId: true,
      algorithm: true,
      publicKeyJwk: true,
    },
  });
  verifyHistoricalSignature(revision, snapshot, signingCredential);

  return {
    ok: true,
    code: 'OFFER_INTEGRITY_VERIFIED',
    offer,
    revision,
    taskRevision,
    authoritySnapshot: snapshot,
    signingCredential,
    offerHash: revision.offerHash,
    action: expectedAction,
  };
}
