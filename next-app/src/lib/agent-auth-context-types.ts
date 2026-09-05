export interface LegacyAgentUserIdentity {
  id: string;
  name: string;
  email: string;
  role: string;
  orgId?: string;
}

export interface LegacyAgentAuthenticationContext {
  kind: 'legacy_user_api_key';
  securityLayer: 'legacy_access_only';
  canResolveProtocolAuthority: false;
  principal: null;
  agent: null;
  credential: null;
  legacy: {
    user: LegacyAgentUserIdentity;
    scopes: string[];
  };
}

export interface V2AgentAuthenticationContext {
  kind: 'v2_agent_credential';
  securityLayer: 'access_identity_only';
  canResolveProtocolAuthority: true;
  principal: {
    id: string;
    type: 'individual' | 'organization';
    status: 'active' | 'suspended';
  };
  agent: {
    id: string;
    name: string;
    status: 'active' | 'suspended' | 'retired';
  };
  credential: {
    id: string;
    keyId: string;
    kind: 'api';
    status: 'active';
  };
  legacy: null;
}

export type UnifiedAgentAuthenticationContext =
  | LegacyAgentAuthenticationContext
  | V2AgentAuthenticationContext;

export interface AuthorityRequestContract {
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

export interface AuthorityResolutionContract {
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

export interface AuthenticatedAuthorityContext {
  kind: 'authenticated_authority_context';
  securityStage: 'identity_and_authority_resolved';
  economicSignatureRequired: true;
  authentication: V2AgentAuthenticationContext;
  authority: AuthorityResolutionContract;
}

export type AuthenticatedAuthorityRequest = Omit<
  AuthorityRequestContract,
  'subjectAgentIdentityId'
> & {
  subjectAgentIdentityId?: string;
};
