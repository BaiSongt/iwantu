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
  SignedEconomicCommandError,
  buildEconomicCommandEvidence,
  canonicalEconomicCommandJson,
  hashEconomicCommandEvidence,
} from './signed-economic-command.mjs';

const WITHDRAWAL_PROTOCOL_VERSION = 'iwantu-offer-withdrawal/0.1';
const RECEIPT_PROTOCOL_VERSION = 'iwantu-offer-withdrawal-receipt/0.1';
const MAX_COMMAND_TTL_MS = 10 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 60 * 1000;

function deny(code, message, details) {
  throw new SignedEconomicCommandError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('ECONOMIC_COMMAND_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function positiveRevision(value) {
  if (!Number.isInteger(value) || value < 1) {
    deny('OFFER_REVISION_INVALID', 'revision must be a positive integer', { revision: value });
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

export function buildOfferWithdrawalEvidence(input) {
  return {
    protocolVersion: WITHDRAWAL_PROTOCOL_VERSION,
    offerId: nonEmpty(input?.offerId, 'offerId'),
    revision: positiveRevision(input?.revision),
    offerHash: nonEmpty(input?.offerHash, 'offerHash'),
    supplierPrincipalId: nonEmpty(input?.supplierPrincipalId, 'supplierPrincipalId'),
    supplierAgentIdentityId: nonEmpty(input?.supplierAgentIdentityId, 'supplierAgentIdentityId'),
    nonce: nonEmpty(input?.nonce, 'nonce'),
  };
}

export function hashOfferWithdrawalEvidence(evidence) {
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

async function assertLiveAccessIdentity(tx, authentication, now) {
  if (authentication?.kind !== 'v2_agent_credential') {
    deny('V2_AGENT_AUTHENTICATION_REQUIRED', 'Signed Offer withdrawal requires v2 AgentCredential authentication');
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
    deny('ACCESS_CREDENTIAL_NOT_LIVE', 'Authenticated access credential is not live');
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
  if (credential.kind !== 'signing') deny('SIGNING_CREDENTIAL_KIND_INVALID', 'Withdrawal must use a signing credential');
  if (credential.agentIdentityId !== authentication.agent.id) {
    deny('SIGNING_CREDENTIAL_AGENT_MISMATCH', 'Signing credential does not belong to authenticated AgentIdentity');
  }
  if (credential.status !== 'active') deny('SIGNING_CREDENTIAL_INACTIVE', 'Signing credential is not active');
  if (credential.validFrom.getTime() > now.getTime()) deny('SIGNING_CREDENTIAL_NOT_YET_VALID', 'Signing credential is not yet valid');
  if (credential.expiresAt && credential.expiresAt.getTime() <= now.getTime()) {
    deny('SIGNING_CREDENTIAL_EXPIRED', 'Signing credential has expired');
  }
  if (signatureAlgorithm !== 'EdDSA' || credential.algorithm !== 'EdDSA') {
    deny('SIGNATURE_ALGORITHM_UNSUPPORTED', 'Signed Offer withdrawal supports EdDSA only');
  }
  if (!credential.publicKeyJwk || typeof credential.publicKeyJwk !== 'object') {
    deny('SIGNING_PUBLIC_KEY_MISSING', 'Signing credential has no public verification key');
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
    deny('SIGNATURE_MATERIAL_INVALID', 'Economic signature material is malformed', {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  if (!signatureBytes.length) deny('SIGNATURE_MATERIAL_INVALID', 'Economic signature is empty');
  if (!verifyDigitalSignature(null, Buffer.from(commandHash, 'hex'), publicKey, signatureBytes)) {
    deny('ECONOMIC_SIGNATURE_INVALID', 'Offer withdrawal signature verification failed');
  }
}

async function lockTask(tx, taskId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT "id", "issuerPrincipalId", "status" FROM "tasks" WHERE "id" = ${taskId} FOR SHARE`,
  );
  return rows[0] ?? null;
}

async function lockOffer(tx, offerId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`SELECT "id", "taskId", "supplierPrincipalId", "supplierAgentIdentityId", "status", "currentRevision" FROM "offers" WHERE "id" = ${offerId} FOR UPDATE`,
  );
  return rows[0] ?? null;
}

export async function withdrawSignedFirmOffer(prisma, authentication, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('PROTOCOL_CLIENT_INVALID', 'withdrawSignedFirmOffer requires a PrismaClient');
  }
  const now = asDate(options.now ?? new Date(), 'now');
  const offerId = nonEmpty(input?.offerId, 'offerId');
  const revision = positiveRevision(input?.revision);
  const offerHash = nonEmpty(input?.offerHash, 'offerHash');
  const nonce = nonEmpty(input?.nonce, 'nonce');
  const signingKeyId = nonEmpty(input?.signatureKeyId, 'signatureKeyId');
  const signatureAlgorithm = nonEmpty(input?.signatureAlgorithm, 'signatureAlgorithm');

  return prisma.$transaction(async (tx) => {
    const envelope = await tx.offer.findUnique({ where: { id: offerId }, select: { taskId: true } });
    if (!envelope) deny('OFFER_NOT_FOUND', 'Offer does not exist', { offerId });
    const task = await lockTask(tx, envelope.taskId);
    if (!task) deny('TASK_NOT_FOUND', 'Task does not exist', { taskId: envelope.taskId });
    const offer = await lockOffer(tx, offerId);
    if (!offer) deny('OFFER_NOT_FOUND', 'Offer does not exist', { offerId });

    const existingReceipt = await tx.$queryRaw(
      Prisma.sql`SELECT * FROM "offer_withdrawal_receipts" WHERE "offerId" = ${offerId} LIMIT 1`,
    );
    if (offer.status === 'withdrawn' && existingReceipt[0]) {
      if (
        existingReceipt[0].offerRevision === revision
        && existingReceipt[0].offerHash === offerHash
        && existingReceipt[0].nonce === nonce
      ) {
        return { offer: await tx.offer.findUnique({ where: { id: offerId } }), receipt: existingReceipt[0] };
      }
      deny('OFFER_ALREADY_WITHDRAWN', 'Firm Offer has already been withdrawn with different command evidence');
    }
    if (offer.status !== 'active') {
      deny('OFFER_NOT_WITHDRAWABLE', 'Only an active Firm Offer can be withdrawn', { offerId, status: offer.status });
    }
    if (
      offer.supplierPrincipalId !== authentication?.principal?.id
      || offer.supplierAgentIdentityId !== authentication?.agent?.id
    ) {
      deny('OFFER_SUPPLIER_AUTH_MISMATCH', 'Authenticated Agent does not own this Firm Offer chain');
    }
    if (offer.currentRevision !== revision) {
      deny('OFFER_SUPERSEDED', 'Withdrawal must bind the current Offer revision', {
        requestedRevision: revision,
        currentRevision: offer.currentRevision,
      });
    }
    const offerRevision = await tx.offerRevision.findUnique({
      where: { offerId_revision: { offerId, revision } },
      select: { offerHash: true },
    });
    if (!offerRevision || offerRevision.offerHash !== offerHash) {
      deny('OFFER_REVISION_MISMATCH', 'Withdrawal Offer hash does not match immutable current revision');
    }

    await assertLiveAccessIdentity(tx, authentication, now);
    const withdrawalEvidence = buildOfferWithdrawalEvidence({
      offerId,
      revision,
      offerHash,
      supplierPrincipalId: offer.supplierPrincipalId,
      supplierAgentIdentityId: offer.supplierAgentIdentityId,
      nonce,
    });
    const withdrawalHash = hashOfferWithdrawalEvidence(withdrawalEvidence);
    const commandEvidence = buildEconomicCommandEvidence({
      action: 'offer.withdraw',
      principalId: offer.supplierPrincipalId,
      agentIdentityId: offer.supplierAgentIdentityId,
      mandateId: input.mandateId,
      payloadHash: withdrawalHash,
      nonce,
      issuedAt: input.commandIssuedAt,
      expiresAt: input.commandExpiresAt,
      signingKeyId,
      signatureAlgorithm,
    });
    assertCommandWindow(commandEvidence, now);
    const commandHash = hashEconomicCommandEvidence(commandEvidence);
    const signingCredential = await loadSigningCredential(
      tx,
      authentication,
      signingKeyId,
      signatureAlgorithm,
      now,
    );
    verifySignature(commandHash, signingCredential, input.supplierSignature);

    const authority = await resolveAuthority(tx, {
      mandateId: commandEvidence.mandateId,
      subjectAgentIdentityId: offer.supplierAgentIdentityId,
      action: 'offer.withdraw',
      at: now,
      counterpartyPrincipalId: task.issuerPrincipalId,
    });
    const boundContext = bindAuthorityToAuthentication(authentication, authority);
    const authoritySnapshot = await captureAuthoritySnapshot(
      tx,
      boundContext,
      {
        action: 'offer.withdraw',
        counterpartyPrincipalId: task.issuerPrincipalId,
        commandHash,
        payloadHash: withdrawalHash,
        nonce,
        signingCredentialId: signingCredential.id,
        signingKeyId,
        signatureAlgorithm,
      },
      now,
    );

    const receiptEvidence = {
      protocolVersion: RECEIPT_PROTOCOL_VERSION,
      offerId,
      offerRevision: revision,
      offerHash,
      withdrawalHash,
      commandHash,
      supplierPrincipalId: offer.supplierPrincipalId,
      supplierAgentIdentityId: offer.supplierAgentIdentityId,
      authoritySnapshotId: authoritySnapshot.id,
      authorityEvidenceHash: authoritySnapshot.evidenceHash,
      nonce,
      signingKeyId,
      signatureAlgorithm,
      supplierSignature: nonEmpty(input.supplierSignature, 'supplierSignature'),
      withdrawnAt: now.toISOString(),
    };
    const receiptHash = hashCanonical(receiptEvidence);
    const receiptId = randomUUID();
    await tx.$executeRaw(
      Prisma.sql`
        INSERT INTO "offer_withdrawal_receipts" (
          "id", "offerId", "offerRevision", "offerHash", "withdrawalHash", "commandHash",
          "supplierPrincipalId", "supplierAgentIdentityId", "authoritySnapshotId", "nonce",
          "signatureAlgorithm", "signingKeyId", "supplierSignature", "receiptHash", "withdrawnAt"
        ) VALUES (
          ${receiptId}, ${offerId}, ${revision}, ${offerHash}, ${withdrawalHash}, ${commandHash},
          ${offer.supplierPrincipalId}, ${offer.supplierAgentIdentityId}, ${authoritySnapshot.id}, ${nonce},
          ${signatureAlgorithm}, ${signingKeyId}, ${input.supplierSignature}, ${receiptHash}, ${now}
        )
      `,
    );
    const updatedOffer = await tx.offer.update({ where: { id: offerId }, data: { status: 'withdrawn' } });
    return {
      offer: updatedOffer,
      authoritySnapshot,
      commandHash,
      receipt: { id: receiptId, ...receiptEvidence, receiptHash },
    };
  });
}
