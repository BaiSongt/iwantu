import { createHash } from 'node:crypto';

export class AuthoritySnapshotError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AuthoritySnapshotError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new AuthoritySnapshotError(code, message, details);
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

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function sha256Evidence(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

function normalizeStringArray(value, field) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    deny('snapshot_request_invalid', `${field} must be an array of non-empty strings`);
  }
  return [...new Set(value)].sort();
}

function optionalString(value, field) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length === 0) {
    deny('snapshot_request_invalid', `${field} must be a non-empty string when supplied`);
  }
  return value;
}

function normalizeRequestEvidence(request) {
  if (!request || typeof request !== 'object') {
    deny('snapshot_request_invalid', 'AuthoritySnapshot requires request evidence');
  }
  if (typeof request.action !== 'string' || request.action.length === 0) {
    deny('snapshot_action_missing', 'AuthoritySnapshot requires the resolved action');
  }

  return {
    action: request.action,
    capabilityId: request.capabilityId ?? null,
    capabilityIds: normalizeStringArray(request.capabilityIds, 'capabilityIds'),
    economic: request.economic ?? null,
    resourceRefs: normalizeStringArray(request.resourceRefs, 'resourceRefs'),
    dataRefs: normalizeStringArray(request.dataRefs, 'dataRefs'),
    rawDataAccess: request.rawDataAccess ?? false,
    counterpartyPrincipalId: request.counterpartyPrincipalId ?? null,
    commandHash: optionalString(request.commandHash, 'commandHash'),
    payloadHash: optionalString(request.payloadHash, 'payloadHash'),
    nonce: optionalString(request.nonce, 'nonce'),
    signingCredentialId: optionalString(request.signingCredentialId, 'signingCredentialId'),
    signingKeyId: optionalString(request.signingKeyId, 'signingKeyId'),
    signatureAlgorithm: optionalString(request.signatureAlgorithm, 'signatureAlgorithm'),
  };
}

/**
 * Build immutable historical evidence from the authenticated authority context.
 * This function does not resolve authority and cannot authorize a new command.
 * The caller must already have passed live authentication + Mandate resolution
 * for the same Agent/Principal and, for economic commands, signature checks.
 */
export function buildAuthoritySnapshot(boundContext, request, resolvedAt = new Date()) {
  if (boundContext?.kind !== 'authenticated_authority_context') {
    deny('authenticated_authority_required', 'Snapshot requires an authenticated Authority context');
  }
  if (boundContext.securityStage !== 'identity_and_authority_resolved') {
    deny('authority_stage_invalid', 'Authority has not reached the expected resolved stage');
  }

  const { authentication, authority } = boundContext;
  if (authentication?.kind !== 'v2_agent_credential') {
    deny('v2_agent_required', 'AuthoritySnapshot requires v2 AgentCredential identity');
  }
  if (!authority?.allowed || !Array.isArray(authority.mandateChain) || authority.mandateChain.length < 1) {
    deny('authority_resolution_invalid', 'AuthoritySnapshot requires a successful Mandate resolution');
  }
  if (authentication.principal.id !== authority.principalId) {
    deny('snapshot_principal_mismatch', 'Authenticated Principal does not match resolved authority');
  }
  if (authentication.agent.id !== authority.subjectAgentIdentityId) {
    deny('snapshot_agent_mismatch', 'Authenticated Agent does not match resolved authority');
  }

  const requestEvidence = normalizeRequestEvidence(request);
  const mandateChain = authority.mandateChain.map((entry) => ({
    id: entry.id,
    version: entry.version,
    payloadHash: entry.payloadHash,
  }));
  const authorityChainHash = sha256Evidence(mandateChain);
  const resolvedAtDate = resolvedAt instanceof Date ? resolvedAt : new Date(resolvedAt);
  if (Number.isNaN(resolvedAtDate.getTime())) {
    deny('snapshot_time_invalid', 'AuthoritySnapshot resolvedAt is invalid');
  }

  const evidence = {
    protocolVersion: 'iwantu-authority-snapshot/0.1',
    principalId: authentication.principal.id,
    agentIdentityId: authentication.agent.id,
    credentialId: authentication.credential.id,
    credentialKeyId: authentication.credential.keyId,
    leafMandateId: mandateChain.at(-1).id,
    mandateChain,
    authorityChainHash,
    effectiveAuthority: authority.effective,
    requestEvidence,
    resolvedAction: requestEvidence.action,
    resolvedCapabilityId: requestEvidence.capabilityId,
    resolvedAt: resolvedAtDate,
  };

  return {
    ...evidence,
    evidenceHash: sha256Evidence(evidence),
  };
}

/**
 * Persist a snapshot as evidence only. No API in this module accepts a snapshot
 * as authority input; new commitments must call the live Authority Resolver.
 */
export async function captureAuthoritySnapshot(
  prisma,
  boundContext,
  request,
  resolvedAt = new Date(),
) {
  const snapshot = buildAuthoritySnapshot(boundContext, request, resolvedAt);
  return prisma.authoritySnapshot.create({ data: snapshot });
}
