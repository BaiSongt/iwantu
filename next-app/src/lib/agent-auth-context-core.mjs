export class AuthenticationContextError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AuthenticationContextError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new AuthenticationContextError(code, message, details);
}

/**
 * Classify only the access-credential family. This deliberately does not
 * infer authority from the token format.
 */
export function classifyAgentBearerToken(rawToken) {
  if (typeof rawToken !== 'string' || rawToken.length === 0) return 'unknown';
  if (rawToken.startsWith('iwantu_ac_')) return 'v2_agent_credential';
  if (rawToken.startsWith('iwantu_')) return 'legacy_user_api_key';
  return 'unknown';
}

/**
 * Preserve a legacy User/ApiKey identity for v1 compatibility without
 * fabricating a Principal, AgentIdentity or AgentCredential.
 */
export function createLegacyAgentAuthenticationContext(legacyAuth) {
  if (!legacyAuth?.user?.id || !Array.isArray(legacyAuth.scopes)) {
    deny('legacy_auth_invalid', 'Legacy authentication result is malformed');
  }

  return {
    kind: 'legacy_user_api_key',
    securityLayer: 'legacy_access_only',
    canResolveProtocolAuthority: false,
    principal: null,
    agent: null,
    credential: null,
    legacy: {
      user: {
        id: legacyAuth.user.id,
        name: legacyAuth.user.name,
        email: legacyAuth.user.email,
        role: legacyAuth.user.role,
        orgId: legacyAuth.user.orgId,
      },
      scopes: [...legacyAuth.scopes],
    },
  };
}

/**
 * Normalize an authenticated v2 AgentCredential result. Identity is proven,
 * but no Mandate or economic permission is attached here.
 */
export function createV2AgentAuthenticationContext(v2Auth) {
  if (!v2Auth?.principal?.id || !v2Auth?.agent?.id || !v2Auth?.credential?.id) {
    deny('v2_auth_invalid', 'v2 Agent authentication result is malformed');
  }

  return {
    kind: 'v2_agent_credential',
    securityLayer: 'access_identity_only',
    canResolveProtocolAuthority: true,
    principal: { ...v2Auth.principal },
    agent: { ...v2Auth.agent },
    credential: { ...v2Auth.credential },
    legacy: null,
  };
}

/**
 * Bind a separately resolved Mandate chain to the already authenticated
 * AgentIdentity. This is still NOT an executable economic-command decision:
 * signed economic payload verification remains a distinct required stage.
 */
export function bindAuthorityToAuthentication(authentication, authority) {
  if (authentication?.kind !== 'v2_agent_credential') {
    deny(
      'protocol_agent_required',
      'Legacy User/API-key authentication cannot establish v2 protocol authority',
    );
  }
  if (!authentication.canResolveProtocolAuthority) {
    deny('protocol_authority_disabled', 'Authentication context cannot resolve protocol authority');
  }
  if (!authority?.allowed) {
    deny('authority_not_resolved', 'A successful Authority resolution is required');
  }
  if (authentication.principal.id !== authority.principalId) {
    deny(
      'authenticated_principal_mismatch',
      'Resolved authority does not belong to the authenticated Principal',
    );
  }
  if (authentication.agent.id !== authority.subjectAgentIdentityId) {
    deny(
      'authenticated_agent_mismatch',
      'Resolved authority does not authorize the authenticated AgentIdentity',
    );
  }

  return {
    kind: 'authenticated_authority_context',
    securityStage: 'identity_and_authority_resolved',
    economicSignatureRequired: true,
    authentication,
    authority,
  };
}
