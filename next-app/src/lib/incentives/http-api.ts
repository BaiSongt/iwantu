import 'server-only';
import prisma from '@/lib/db/client';
import { authenticateV2Agent } from '@/lib/auth-agent-v2';
import { createV2AgentAuthenticationContext } from '@/lib/agent-auth-context-core.mjs';
import type { V2AgentAuthenticationContext } from '@/lib/agent-auth-context-types';
import { rateLimit } from '@/lib/rate-limit';
import { createIncentiveGovernanceService } from './governance-service.mjs';
import { normalizeTrustedPrograms } from './governance-protocol.mjs';
import {
  IncentiveHttpError, incentiveErrorResponse, incentiveJson,
  readIncentiveJson, serializeIncentiveResult,
} from './http-contract.mjs';

type CommandKind = 'register' | 'policy' | 'award';
const PROGRAM_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const AWARD_ID = /^[0-9a-f]{64}$/;

async function identity(request: Request): Promise<V2AgentAuthenticationContext> {
  // Access authentication only. Every write still resolves its exact live
  // Mandate and verifies the independent economic signature in the service.
  const authenticated = await authenticateV2Agent(request);
  if ('error' in authenticated) {
    const status = authenticated.error.status;
    if (status === 403) throw new IncentiveHttpError(403, 'R8_ACCESS_DENIED', 'Agent identity is not active');
    if (status >= 500) throw new IncentiveHttpError(503, 'R8_AUTHENTICATION_UNAVAILABLE', 'Authentication is unavailable');
    throw new IncentiveHttpError(401, 'R8_AUTHENTICATION_REQUIRED', 'A live v2 Bearer credential is required');
  }
  const authentication = createV2AgentAuthenticationContext(authenticated) as V2AgentAuthenticationContext;
  // Key on a verified, bounded database identity, not a caller-supplied IP or
  // Principal header. This limiter is per process; shared deployments need a
  // shared gateway limit as well.
  const throttle = rateLimit(`r8:${authentication.credential.id}`, { limit: 60, windowMs: 60_000 });
  if (!throttle.allowed) {
    throw Object.assign(new IncentiveHttpError(429, 'R8_RATE_LIMITED', 'Credential request limit exceeded'),
      { retryAfter: throttle.retryAfter });
  }
  return authentication;
}

function programId(value: string) {
  if (!PROGRAM_ID.test(value)) throw new IncentiveHttpError(400, 'R8_INPUT_INVALID', 'Invalid Program identifier');
  return value;
}

function serviceFor(id: string, kind: CommandKind, authentication: V2AgentAuthenticationContext) {
  let trusted;
  try {
    trusted = normalizeTrustedPrograms(JSON.parse(process.env.IWANTU_INCENTIVE_TRUSTED_PROGRAMS || '{}'));
  } catch {
    // Never include server configuration (or a JSON parser excerpt) in a reply.
    throw new IncentiveHttpError(503, 'R8_CONFIGURATION_INVALID', 'Governance configuration is unavailable');
  }
  if (Object.keys(trusted).length === 0) {
    throw new IncentiveHttpError(503, 'R8_CONFIG_DISABLED', 'Governed incentive writes are disabled');
  }
  const entry = Object.hasOwn(trusted, id) ? trusted[id] : undefined;
  const expectedPrincipal = kind === 'award' ? entry?.awardIssuerPrincipalId : entry?.governancePrincipalId;
  if (expectedPrincipal !== authentication.principal.id) {
    // Reject unrelated identities before business queries or the global Ledger
    // lock, without revealing whether a foreign Program/source exists.
    throw new IncentiveHttpError(403, 'R8_ACCESS_DENIED', 'Principal is not permitted for this Program action');
  }
  return createIncentiveGovernanceService({ trustedPrograms: trusted });
}

function failed(error: unknown) {
  // The response mapper uses an allowlist of static messages. Logging raw ORM
  // errors could also expose query data, so retain only an error class here.
  if (!(error instanceof IncentiveHttpError)) {
    console.error('[r8-api] request rejected', { type: error instanceof Error ? error.name : 'UnknownError' });
  }
  const response = incentiveErrorResponse(error);
  if (error instanceof IncentiveHttpError && error.code === 'R8_RATE_LIMITED') {
    const seconds = 'retryAfter' in error && typeof error.retryAfter === 'number' ? error.retryAfter : 60;
    response.headers.set('Retry-After', String(Math.max(1, Math.ceil(seconds))));
  }
  return response;
}

export async function executeIncentiveCommand(request: Request, kind: CommandKind, pathProgramId?: string) {
  try {
    const authentication = await identity(request);
    if (pathProgramId !== undefined) programId(pathProgramId);
    const input = await readIncentiveJson(request, kind,
      pathProgramId === undefined ? {} : { programId: pathProgramId });
    const id = kind === 'register' ? input.registration.programId : pathProgramId!;
    const governed = serviceFor(id, kind, authentication);
    // Never accept authentication, authority snapshots or trust configuration
    // from JSON. The exact input shape is enforced before this dispatch.
    const result = kind === 'register'
      ? await governed.registerProgram(prisma, authentication, input)
      : kind === 'policy'
        ? await governed.publishPolicy(prisma, authentication, input)
        : await governed.awardForSettlement(prisma, authentication, input);
    return incentiveJson(serializeIncentiveResult(kind, result), result.idempotent ? 200 : 201);
  } catch (error) {
    return failed(error);
  }
}

export async function readIncentiveProgram(request: Request, pathProgramId: string) {
  try {
    const authentication = await identity(request);
    const id = programId(pathProgramId);
    const [program] = await prisma.$queryRaw<Array<{
      programId: string; governancePrincipalId: string; awardIssuerPrincipalId: string;
      budgetIwc: string; configurationHash: string; createdAt: Date;
    }>>`
      SELECT "programId", "governancePrincipalId", "awardIssuerPrincipalId",
        "budgetIwc"::text AS "budgetIwc", "configurationHash", "createdAt"
      FROM "r8_incentive_programs"
      WHERE "programId" = ${id}
        AND ("governancePrincipalId" = ${authentication.principal.id}
          OR "awardIssuerPrincipalId" = ${authentication.principal.id})
    `;
    if (!program) throw new IncentiveHttpError(404, 'R8_PROGRAM_NOT_FOUND', 'Program is not visible to this Principal');
    const policies = await prisma.$queryRaw<Array<{ policy: unknown; policyHash: string; createdAt: Date }>>`
      SELECT "policy", "policyHash", "createdAt" FROM "r8_incentive_policies"
      WHERE "programId" = ${id} ORDER BY "createdAt" DESC, "policyHash" ASC LIMIT 51
    `;
    return incentiveJson({ program, policies: policies.slice(0, 50), hasMorePolicies: policies.length > 50 });
  } catch (error) {
    return failed(error);
  }
}

export async function readIncentiveAward(request: Request, pathProgramId: string, awardId: string) {
  try {
    const authentication = await identity(request);
    const id = programId(pathProgramId);
    if (!AWARD_ID.test(awardId)) throw new IncentiveHttpError(400, 'R8_INPUT_INVALID', 'Invalid award identifier');
    const [binding] = await prisma.$queryRaw<Array<{
      awardId: string; programId: string; policyHash: string; settlementId: string;
      beneficiaryRole: string; awardSlot: string; beneficiaryPrincipalId: string;
      amountIwc: string; ledgerTransactionId: string; receiptHash: string;
      authorizationId: string; createdAt: Date; ledgerTransactionHash: string;
    }>>`
      SELECT b."awardId", b."programId", b."policyHash", b."settlementId", b."beneficiaryRole",
        b."awardSlot", b."beneficiaryPrincipalId", b."amountIwc"::text AS "amountIwc",
        b."ledgerTransactionId", b."receiptHash", b."authorizationId", b."createdAt",
        t."transactionHash" AS "ledgerTransactionHash"
      FROM "r8_incentive_award_bindings" b
      JOIN "r8_incentive_programs" p ON p."programId" = b."programId"
      JOIN "ledger_transactions" t ON t."id" = b."ledgerTransactionId"
      WHERE b."programId" = ${id} AND b."awardId" = ${awardId}
        AND (p."governancePrincipalId" = ${authentication.principal.id}
          OR p."awardIssuerPrincipalId" = ${authentication.principal.id}
          OR b."beneficiaryPrincipalId" = ${authentication.principal.id})
    `;
    if (!binding) throw new IncentiveHttpError(404, 'R8_AWARD_NOT_FOUND', 'Award is not visible to this Principal');
    return incentiveJson({ award: { ...binding, currency: 'IWC' } });
  } catch (error) {
    return failed(error);
  }
}
