import type { AuthorityResolution } from './authority/authority.mjs';

export class AuthenticationContextError extends Error {
  code: string;
  details?: unknown;
  constructor(code: string, message: string, details?: unknown);
}

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

export interface AuthenticatedAuthorityContext {
  kind: 'authenticated_authority_context';
  securityStage: 'identity_and_authority_resolved';
  economicSignatureRequired: true;
  authentication: V2AgentAuthenticationContext;
  authority: AuthorityResolution;
}

export function classifyAgentBearerToken(
  rawToken: string,
): 'v2_agent_credential' | 'legacy_user_api_key' | 'unknown';

export function createLegacyAgentAuthenticationContext(legacyAuth: {
  user: LegacyAgentUserIdentity;
  scopes: string[];
}): LegacyAgentAuthenticationContext;

export function createV2AgentAuthenticationContext(v2Auth: {
  principal: V2AgentAuthenticationContext['principal'];
  agent: V2AgentAuthenticationContext['agent'];
  credential: V2AgentAuthenticationContext['credential'];
}): V2AgentAuthenticationContext;

export function bindAuthorityToAuthentication(
  authentication: UnifiedAgentAuthenticationContext,
  authority: AuthorityResolution,
): AuthenticatedAuthorityContext;
