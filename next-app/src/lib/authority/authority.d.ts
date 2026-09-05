import type { Prisma, PrismaClient } from '@prisma/client';

export class AuthorityResolutionError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown);
}

export interface AuthorityFact {
  id: string;
  version: number;
  payloadHash: string;
  issuerPrincipalId: string;
  subjectAgentIdentityId: string;
  actionScopes: string[];
  capabilityScopes: string[];
  economicLimits: Record<string, unknown>;
  resourcePolicy: Record<string, unknown>;
  dataPolicy: Record<string, unknown>;
  counterpartyPolicy: Record<string, unknown>;
  validFrom: Date | string;
  validUntil: Date | string | null;
  delegationAllowed: boolean;
  maxDelegationDepth: number;
  delegationDepth: number;
  parentMandateId: string | null;
  delegatingAgentIdentityId: string | null;
  revokedAt: Date | string | null;
  supersededAt: Date | string | null;
  principalStatus: string;
  subjectAgentStatus: string;
}

export interface AuthorityRequest {
  mandateId: string;
  subjectAgentIdentityId: string;
  action: string;
  capabilityId?: string;
  economic?: Record<string, unknown>;
  resourceRefs?: string[];
  dataRefs?: string[];
  rawDataAccess?: boolean;
  counterpartyPrincipalId?: string;
  at?: Date | string;
}

export interface AuthorityResolution {
  allowed: true;
  principalId: string;
  subjectAgentIdentityId: string;
  delegationDepth: number;
  mandateChain: Array<{
    id: string;
    version: number;
    payloadHash: string;
  }>;
  effective: {
    actionScopes: string[];
    capabilityScopes: string[];
    economicLimits: unknown;
    resourcePolicy: unknown;
    dataPolicy: unknown;
    counterpartyPolicy: unknown;
    validFrom: Date;
    validUntil: Date | null;
  };
}

export interface DelegatedMandateInput {
  parentMandateId: string;
  subjectAgentIdentityId: string;
  mandateFamilyId: string;
  version: number;
  protocolVersion?: string;
  actionScopes: string[];
  capabilityScopes: string[];
  economicLimits: Prisma.InputJsonValue;
  resourcePolicy: Prisma.InputJsonValue;
  dataPolicy: Prisma.InputJsonValue;
  counterpartyPolicy: Prisma.InputJsonValue;
  validFrom: Date;
  validUntil?: Date | null;
  payloadHash: string;
  signatureAlgorithm: string;
  signatureKeyId: string;
  signature: string;
  supersedesMandateId?: string | null;
}

export function scopePatternCovers(parentPattern: string, childOrRequestedPattern: string): boolean;
export function scopeSetAllows(grants: string[], requested: string): boolean;
export function isScopeSetNarrowerOrEqual(parentScopes: string[], childScopes: string[]): boolean;
export function isEconomicLimitsNarrowerOrEqual(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
): boolean;
export function isPolicyNarrowerOrEqual(
  parent: Record<string, unknown>,
  child: Record<string, unknown>,
): boolean;
export function assertDelegationNarrowing(parent: AuthorityFact, child: AuthorityFact): true;
export function evaluateAuthorityChain(
  chain: AuthorityFact[],
  request: AuthorityRequest,
): AuthorityResolution;
export function resolveAuthority(
  prisma: PrismaClient,
  request: AuthorityRequest,
): Promise<AuthorityResolution>;
export function createDelegatedMandate(
  prisma: PrismaClient,
  input: DelegatedMandateInput,
): Promise<unknown>;
