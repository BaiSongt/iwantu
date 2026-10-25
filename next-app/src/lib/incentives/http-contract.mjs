import { z } from 'zod';

export const INCENTIVE_BODY_LIMIT = 32_768;

export class IncentiveHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'IncentiveHttpError';
    this.status = status;
    this.code = code;
  }
}

const privateHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const identifier = z.string().min(1).max(200).refine((value) =>
  value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const safeKey = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/);
const digest = z.string().regex(/^[0-9a-f]{64}$/);
const timestamp = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
  .refine((value) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value);
const positiveAmount = z.string().regex(/^(0|[1-9][0-9]{0,27})\.[0-9]{8}$/)
  .refine((value) => value !== '0.00000000');
const command = z.object({
  protocolVersion: z.literal('iwantu-economic-command/0.1'),
  action: z.enum(['incentive.program.register', 'incentive.policy.publish', 'incentive.policy.revoke', 'incentive.award.issue']),
  principalId: identifier,
  agentIdentityId: identifier,
  mandateId: identifier,
  payloadHash: digest,
  nonce: identifier,
  issuedAt: timestamp,
  expiresAt: timestamp,
  signingKeyId: identifier,
  signatureAlgorithm: z.literal('EdDSA'),
}).strict();
const signature = z.string().regex(/^[A-Za-z0-9_-]{86}$/);
const policy = z.object({
  protocol: z.literal('iwantu.incentive-program-policy/0.2'),
  programId: safeKey,
  policyVersion: safeKey,
  issuerPrincipalId: identifier,
  triggerType: z.literal('terminal_settlement'),
  eligibleSettlementTypes: z.array(z.enum(['full_settlement', 'full_refund', 'mutual_split']))
    .min(1).max(3).refine((values) => new Set(values).size === values.length),
  beneficiaryRole: z.enum(['buyer', 'supplier']),
  awardSlot: safeKey,
  rewardFormula: z.object({ kind: z.literal('fixed_amount'), amountIwc: positiveAmount }).strict(),
  effectiveFrom: timestamp,
  effectiveUntil: timestamp,
  deduplicationScope: z.literal('program_settlement_role_slot'),
}).strict();
const schemas = {
  register: z.object({
    registration: z.object({
      protocol: z.literal('iwantu.incentive-program-registration/0.1'),
      programId: safeKey,
      budgetIwc: positiveAmount,
    }).strict(),
    commandEvidence: command,
    signature,
  }).strict(),
  policy: z.object({ policy, commandEvidence: command, signature }).strict(),
  revoke: z.object({
    revocation: z.object({
      protocol: z.literal('iwantu.incentive-policy-revocation/0.1'),
      programId: safeKey,
      policyHash: digest,
      reasonCode: z.enum(['security', 'policy_error', 'superseded', 'operational']),
    }).strict(),
    commandEvidence: command,
    signature,
  }).strict(),
  award: z.object({
    programId: safeKey,
    policyHash: digest,
    settlementId: identifier,
    commandEvidence: command,
    signature,
  }).strict(),
};
const actions = {
  register: 'incentive.program.register',
  policy: 'incentive.policy.publish',
  revoke: 'incentive.policy.revoke',
  award: 'incentive.award.issue',
};

function fail(status, code) {
  throw new IncentiveHttpError(status, code, 'Invalid incentive HTTP request');
}

// Body limits apply to actual bytes, including requests with absent or false
// Content-Length. A total read deadline also bounds unfinished/trickling bodies.
// bodyTimeoutMs is a trusted caller option for tests, never a request field.
/**
 * @param {Request} request
 * @param {string} kind
 * @param {{programId?: string, policyHash?: string, bodyTimeoutMs?: number}} [options]
 */
export async function readIncentiveJson(request, kind, { programId, policyHash, bodyTimeoutMs = 10_000 } = {}) {
  if (!Object.hasOwn(schemas, kind)) fail(400, 'R8_INPUT_INVALID');
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 1 || bodyTimeoutMs > 10_000) {
    fail(500, 'R8_INTERNAL_ERROR');
  }
  const mediaType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase();
  if (mediaType !== 'application/json') fail(415, 'R8_UNSUPPORTED_MEDIA_TYPE');
  const encoding = request.headers.get('content-encoding')?.trim().toLowerCase();
  if (encoding && encoding !== 'identity') fail(415, 'R8_UNSUPPORTED_MEDIA_TYPE');
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared.trim())) fail(400, 'R8_INVALID_JSON');
    if (BigInt(declared.trim()) > BigInt(INCENTIVE_BODY_LIMIT)) {
      void request.body?.cancel().catch(() => {});
      fail(413, 'R8_BODY_TOO_LARGE');
    }
  }
  if (!request.body) fail(400, 'R8_INVALID_JSON');
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  let cancelled = false;
  const cancelReader = () => {
    if (cancelled) return;
    cancelled = true;
    // Cancellation itself may depend on a stalled underlying transport.
    // Do not await it before responding to the bounded read failure.
    void reader.cancel().catch(() => {});
  };
  let timer;
  let onAbort;
  const interrupted = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new IncentiveHttpError(408, 'R8_BODY_TIMEOUT', 'Request body deadline exceeded'));
      cancelReader();
    }, bodyTimeoutMs);
    onAbort = () => {
      reject(new IncentiveHttpError(400, 'R8_INVALID_JSON', 'Request body was aborted'));
      cancelReader();
    };
    if (request.signal?.aborted) onAbort();
    else request.signal?.addEventListener('abort', onAbort, { once: true });
  });
  try {
    const receive = async () => {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > INCENTIVE_BODY_LIMIT) {
          cancelReader();
          fail(413, 'R8_BODY_TOO_LARGE');
        }
        chunks.push(value);
      }
    };
    await Promise.race([interrupted, receive()]);
  } catch (error) {
    if (error instanceof IncentiveHttpError) throw error;
    fail(400, 'R8_INVALID_JSON');
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', onAbort);
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let body;
  try {
    body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail(400, 'R8_INVALID_JSON');
  }
  const parsed = schemas[kind].safeParse(body);
  if (!parsed.success || parsed.data.commandEvidence.action !== actions[kind]) {
    fail(400, 'R8_INPUT_INVALID');
  }
  const actualProgram = kind === 'register' ? parsed.data.registration.programId
    : kind === 'policy' ? parsed.data.policy.programId
      : kind === 'revoke' ? parsed.data.revocation.programId : parsed.data.programId;
  if (programId !== undefined && actualProgram !== programId) fail(400, 'R8_PATH_MISMATCH');
  if (policyHash !== undefined && (kind !== 'revoke' || parsed.data.revocation.policyHash !== policyHash)) {
    fail(400, 'R8_PATH_MISMATCH');
  }
  return parsed.data;
}

// Messages and exposed codes are fixed, never derived from SQL, credentials,
// signatures or Error.message. Database diagnostics remain server-only.
const errors = {
  R8_INVALID_JSON: [400, 'Request body must contain valid UTF-8 JSON.'],
  R8_INPUT_INVALID: [400, 'Invalid incentive command fields.'],
  R8_PATH_MISMATCH: [400, 'Program in the command does not match the request path.'],
  R8_BODY_TOO_LARGE: [413, 'Incentive request exceeds the 32768-byte limit.'],
  R8_BODY_TIMEOUT: [408, 'Incentive request body was not received in time.'],
  R8_UNSUPPORTED_MEDIA_TYPE: [415, 'Use an uncompressed application/json request body.'],
  R8_AUTHENTICATION_REQUIRED: [401, 'A valid v2 Agent API credential is required.'],
  R8_AUTHENTICATION_UNAVAILABLE: [503, 'Incentive authentication is temporarily unavailable.'],
  R8_ACCESS_DENIED: [403, 'Access to this incentive operation is denied.'],
  R8_RATE_LIMITED: [429, 'Too many incentive requests. Try again later.'],
  R8_CONFIG_DISABLED: [503, 'This incentive Program is not enabled.'],
  R8_CONFIGURATION_INVALID: [503, 'Incentive configuration is unavailable.'],
  R8_INTERNAL_ERROR: [500, 'Incentive operation failed.'],
  R8_IDENTITY_MISMATCH: [403, 'Command signer does not match the authenticated identity.'],
  R8_CREDENTIAL_NOT_LIVE: [403, 'The credential is not usable for a new incentive operation.'],
  R8_TRUST_DENIED: [403, 'The signer is not authorized for this incentive Program.'],
  R8_GOVERNANCE_REVOKED: [403, 'Governance is not usable for new incentive operations.'],
  R8_EXPLICIT_ACTION_REQUIRED: [403, 'An explicit incentive action grant is required.'],
  R8_ECONOMIC_LIMIT_EXCEEDED: [403, 'The incentive command exceeds its authorized limit.'],
  R8_BENEFICIARY_NOT_ACTIVE: [403, 'The beneficiary cannot receive a new incentive.'],
  R8_PROGRAM_NOT_FOUND: [404, 'Incentive Program was not found.'],
  R8_POLICY_NOT_FOUND: [404, 'Published incentive policy was not found.'],
  R8_SETTLEMENT_NOT_FOUND: [404, 'Terminal Settlement was not found.'],
  R8_AWARD_NOT_FOUND: [404, 'Incentive award was not found.'],
  R8_PROGRAM_ALREADY_REGISTERED: [409, 'The incentive Program is already registered.'],
  R8_POLICY_REVOKED: [409, 'The incentive policy is revoked for new awards.'],
  R8_POLICY_ALREADY_REVOKED: [409, 'The incentive policy is already revoked.'],
  R8_COMMAND_REPLAY: [409, 'Nonce or signed command conflicts with a committed operation.'],
  R8_ENTITLEMENT_CONFLICT: [409, 'The incentive entitlement was already consumed.'],
  R8_PROGRAM_BUDGET_EXCEEDED: [409, 'The incentive Program budget is insufficient.'],
  R8_PROGRAM_HISTORY_UNBOUND: [409, 'Existing Program history requires a separate migration decision.'],
  R8_LEDGER_ACCOUNTS_MISSING: [409, 'Required incentive accounts are not available.'],
  R8_POLICY_INELIGIBLE: [422, 'Policy is not eligible for this Program.'],
  R8_REVOCATION_INVALID: [422, 'Incentive policy revocation could not be verified.'],
  R8_SETTLEMENT_INELIGIBLE: [422, 'Settlement is not eligible under the incentive policy.'],
  R8_POLICY_HASH_INVALID: [500, 'Stored incentive policy could not be verified.'],
  R8_APPEND_ONLY: [409, 'Committed incentive evidence cannot be changed.'],
  R8_AUTHORIZATION_BINDING_INVALID: [403, 'Incentive authorization could not be verified.'],
  R8_AWARD_ISSUER_DENIED: [403, 'The award issuer is not authorized.'],
  R8_GOVERNANCE_KEY_DENIED: [403, 'The governance credential is not authorized.'],
  R8_AWARD_BINDING_INVALID: [422, 'Incentive award evidence could not be verified.'],
  R8_AWARD_LEDGER_INVALID: [409, 'Incentive Ledger evidence could not be verified.'],
  R8_GOVERNED_AWARD_BINDING_REQUIRED: [409, 'A governed award requires its atomic binding receipt.'],
  R8_POLICY_INVALID: [422, 'Incentive policy could not be verified.'],
  R8_PROGRAM_REGISTRATION_INVALID: [422, 'Program registration could not be verified.'],
  INCENTIVE_GOVERNANCE_INPUT_INVALID: [400, 'Invalid incentive command fields.'],
  INCENTIVE_PROGRAM_POLICY_DRAFT_INVALID: [400, 'Invalid incentive policy fields.'],
  INCENTIVE_SIGNATURE_INVALID: [403, 'Incentive command signature is invalid.'],
  INCENTIVE_COMMAND_WINDOW_INVALID: [400, 'Incentive command time window is invalid or expired.'],
  INCENTIVE_PROGRAM_BUDGET_EXCEEDED: [409, 'The requested Program budget exceeds its configured cap.'],
  INCENTIVE_POSTED_BUDGET_COVERAGE_DRAFT_FAILED: [409, 'Historical incentive coverage requires review.'],
  LEDGER_ACCOUNT_OVERDRAFT: [409, 'The incentive pool has insufficient available credit.'],
  LEDGER_ACCOUNT_INACTIVE: [409, 'An incentive account is inactive.'],
  LEDGER_ACCOUNT_NOT_FOUND: [409, 'A required incentive account was not found.'],
  LEDGER_TRANSACTION_HASH_CONFLICT: [409, 'Incentive Ledger evidence conflicts with an existing transaction.'],
  R8_STATE_CONFLICT: [409, 'Incentive state conflicts with the requested operation.'],
};

export function incentiveJson(data, status = 200) {
  return Response.json(data, { status, headers: privateHeaders });
}

export function incentiveErrorResponse(error) {
  let code = Object.hasOwn(errors, error?.code) ? error.code : 'R8_INTERNAL_ERROR';
  if (error?.name === 'AuthorityResolutionError' || error?.name === 'AuthenticationContextError') {
    code = 'R8_ACCESS_DENIED';
  } else if (error?.code === 'P2002' || (error?.code === 'P2010' && error?.meta?.code === '23505')) {
    code = 'R8_STATE_CONFLICT';
  } else if (error?.code === 'P2025') {
    code = 'R8_PROGRAM_NOT_FOUND';
  } else if (error?.code === 'P2010') {
    const diagnostic = typeof error.meta?.message === 'string' ? error.meta.message : '';
    const matched = diagnostic.match(/\bR8_[A-Z_]+\b/)?.[0];
    if (matched && Object.hasOwn(errors, matched)) code = matched;
  }
  const [status, message] = errors[code];
  return incentiveJson({ error: { code, message } }, status);
}

function pick(record, names) {
  return Object.fromEntries(names.map((name) => [name, record[name]]));
}

export function serializeIncentiveResult(kind, result) {
  if (kind === 'register') {
    return {
      program: pick(result.program, [
        'programId', 'governancePrincipalId', 'awardIssuerPrincipalId', 'budgetIwc', 'configurationHash', 'createdAt',
      ]),
      authorizationId: result.authorization.commandHash,
      idempotent: result.idempotent,
    };
  }
  if (kind === 'policy') {
    const stored = result.policy.policy;
    return {
      policy: {
        ...pick(stored, [
          'protocol', 'programId', 'policyVersion', 'issuerPrincipalId', 'triggerType',
          'eligibleSettlementTypes', 'beneficiaryRole', 'awardSlot', 'effectiveFrom',
          'effectiveUntil', 'deduplicationScope',
        ]),
        rewardFormula: pick(stored.rewardFormula, ['kind', 'amountIwc']),
      },
      policyHash: result.policy.policyHash,
      createdAt: result.policy.createdAt,
      authorizationId: result.authorization.commandHash,
      idempotent: result.idempotent,
    };
  }
  if (kind === 'award') {
    return {
      award: {
        ...pick(result.binding, [
          'awardId', 'programId', 'policyHash', 'settlementId', 'beneficiaryRole',
          'awardSlot', 'beneficiaryPrincipalId', 'amountIwc', 'ledgerTransactionId',
          'receiptHash', 'authorizationId', 'createdAt',
        ]),
        currency: 'IWC',
        ledgerTransactionHash: result.ledgerTransaction.transactionHash,
      },
      idempotent: result.idempotent,
    };
  }
  if (kind === 'revoke') {
    return {
      revocation: pick(result.revocation, [
        'id', 'programId', 'policyHash', 'reasonCode', 'authorizationId', 'revocationHash', 'createdAt',
      ]),
      idempotent: result.idempotent,
    };
  }
  throw new IncentiveHttpError(500, 'R8_INTERNAL_ERROR', 'Unknown incentive response kind');
}
