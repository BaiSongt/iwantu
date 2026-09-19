import { createHash } from 'node:crypto';
import { canonicalEconomicCommandJson } from './signed-economic-command.mjs';

export const MAX_REWORK_ATTEMPTS = 10;
export const MAX_REWORK_WINDOW_SECONDS = 7 * 24 * 60 * 60;

export class ReworkPolicyError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ReworkPolicyError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new ReworkPolicyError(code, message, details);
}

export function resolveContractDeliveryPolicy(termsPayload) {
  const policy = termsPayload && typeof termsPayload === 'object'
    ? termsPayload.deliveryPolicy
    : undefined;

  if (policy === undefined || policy === null) {
    return Object.freeze({
      maxAttempts: 1,
      reworkWindowSeconds: null,
      explicitRework: false,
    });
  }
  if (typeof policy !== 'object' || Array.isArray(policy)) {
    deny('REWORK_POLICY_INVALID', 'deliveryPolicy must be an object');
  }

  const maxAttempts = policy.maxAttempts ?? 1;
  if (
    !Number.isInteger(maxAttempts)
    || maxAttempts < 1
    || maxAttempts > MAX_REWORK_ATTEMPTS
  ) {
    deny(
      'REWORK_POLICY_INVALID',
      `deliveryPolicy.maxAttempts must be an integer between 1 and ${MAX_REWORK_ATTEMPTS}`,
    );
  }

  const reworkWindowSeconds = policy.reworkWindowSeconds ?? null;
  if (maxAttempts > 1) {
    if (
      !Number.isInteger(reworkWindowSeconds)
      || reworkWindowSeconds < 1
      || reworkWindowSeconds > MAX_REWORK_WINDOW_SECONDS
    ) {
      deny(
        'REWORK_POLICY_INVALID',
        `deliveryPolicy.reworkWindowSeconds must be an integer between 1 and ${MAX_REWORK_WINDOW_SECONDS} when maxAttempts > 1`,
      );
    }
  } else if (reworkWindowSeconds !== null && reworkWindowSeconds !== undefined) {
    deny(
      'REWORK_POLICY_INVALID',
      'deliveryPolicy.reworkWindowSeconds requires maxAttempts > 1',
    );
  }

  return Object.freeze({
    maxAttempts,
    reworkWindowSeconds: maxAttempts > 1 ? reworkWindowSeconds : null,
    explicitRework: maxAttempts > 1,
  });
}

export function buildReworkAuthorizationEvidence(input) {
  return {
    protocolVersion: 'iwantu-rework-authorization/0.1',
    contractId: String(input.contractId),
    effectiveContractHash: String(input.effectiveContractHash),
    rejectionDecisionId: String(input.rejectionDecisionId),
    rejectionDecisionHash: String(input.rejectionDecisionHash),
    deliveryId: String(input.deliveryId),
    deliveryHash: String(input.deliveryHash),
    rejectedSequence: Number(input.rejectedSequence),
    nextSequence: Number(input.nextSequence),
    maxAttempts: Number(input.maxAttempts),
    reworkWindowSeconds: Number(input.reworkWindowSeconds),
    reworkDeadline: new Date(input.reworkDeadline).toISOString(),
  };
}

export function hashReworkAuthorizationEvidence(evidence) {
  return createHash('sha256')
    .update(canonicalEconomicCommandJson(buildReworkAuthorizationEvidence(evidence)), 'utf8')
    .digest('hex');
}
