export class AuthorityResolutionError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'AuthorityResolutionError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new AuthorityResolutionError(code, message, details);
}

function asDate(value) {
  if (value instanceof Date) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    deny('invalid_time', 'Authority fact contains an invalid timestamp');
  }
  return date;
}

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Scope syntax intentionally stays small in M1-05:
 * - `*` covers everything;
 * - `namespace.*` covers descendants of `namespace`;
 * - all other values are exact ids.
 */
export function scopePatternCovers(parentPattern, childOrRequestedPattern) {
  if (parentPattern === '*') return true;
  if (parentPattern === childOrRequestedPattern) return true;

  if (!parentPattern.endsWith('.*')) return false;
  const parentPrefix = parentPattern.slice(0, -2);

  if (childOrRequestedPattern === '*') return false;
  if (childOrRequestedPattern.endsWith('.*')) {
    const childPrefix = childOrRequestedPattern.slice(0, -2);
    return childPrefix.startsWith(`${parentPrefix}.`);
  }

  return childOrRequestedPattern.startsWith(`${parentPrefix}.`);
}

export function scopeSetAllows(grants, requested) {
  if (!Array.isArray(grants) || grants.length === 0) return false;
  return grants.some((grant) => scopePatternCovers(grant, requested));
}

export function isScopeSetNarrowerOrEqual(parentScopes, childScopes) {
  if (!Array.isArray(parentScopes) || !Array.isArray(childScopes)) return false;
  return childScopes.every((childScope) =>
    parentScopes.some((parentScope) =>
      scopePatternCovers(parentScope, childScope),
    ),
  );
}

function arrayIsSubset(parent, child) {
  return child.every((item) => parent.includes(item));
}

function arrayIsSuperset(parent, child) {
  return parent.every((item) => child.includes(item));
}

function isEconomicValueNarrowerOrEqual(parent, child) {
  if (typeof parent === 'number') {
    return typeof child === 'number' && Number.isFinite(child) && child <= parent;
  }

  if (typeof parent === 'boolean') {
    return typeof child === 'boolean' && (parent || child === false);
  }

  if (typeof parent === 'string') {
    return typeof child === 'string' && (parent === '*' || child === parent);
  }

  if (Array.isArray(parent)) {
    return Array.isArray(child) && arrayIsSubset(parent, child);
  }

  if (isPlainObject(parent)) {
    return isEconomicLimitsNarrowerOrEqual(parent, child);
  }

  return deepEqual(parent, child);
}

/**
 * Parent constraints cannot disappear in a child. Additional numeric caps or
 * `false` boolean constraints are allowed because they only reduce authority.
 * Unknown additional shapes fail closed.
 */
export function isEconomicLimitsNarrowerOrEqual(parent, child) {
  if (!isPlainObject(parent) || !isPlainObject(child)) return false;

  for (const [key, parentValue] of Object.entries(parent)) {
    if (!hasOwn(child, key)) return false;
    if (!isEconomicValueNarrowerOrEqual(parentValue, child[key])) return false;
  }

  for (const [key, childValue] of Object.entries(child)) {
    if (hasOwn(parent, key)) continue;
    if (typeof childValue === 'number' && Number.isFinite(childValue)) continue;
    if (childValue === false) continue;
    return false;
  }

  return true;
}

const ALLOWLIST_KEYS = new Set([
  'allow',
  'allowlist',
  'allowedResourceRefs',
  'allowedDataRefs',
]);
const DENYLIST_KEYS = new Set([
  'deny',
  'denylist',
  'deniedResourceRefs',
  'deniedDataRefs',
]);
const BOOLEAN_REDUCTION_KEYS = new Set(['rawDataAccess']);

/**
 * Policy narrowing is intentionally conservative. Known allowlists may only
 * shrink, denylists may only grow, and rawDataAccess can go true -> false but
 * never false -> true. Unknown changed/added policy semantics fail closed.
 */
export function isPolicyNarrowerOrEqual(parent, child) {
  if (!isPlainObject(parent) || !isPlainObject(child)) return false;
  const keys = new Set([...Object.keys(parent), ...Object.keys(child)]);

  for (const key of keys) {
    const parentHas = hasOwn(parent, key);
    const childHas = hasOwn(child, key);
    const parentValue = parent[key];
    const childValue = child[key];

    if (ALLOWLIST_KEYS.has(key)) {
      if (parentHas) {
        if (!childHas || !Array.isArray(parentValue) || !Array.isArray(childValue)) {
          return false;
        }
        if (!arrayIsSubset(parentValue, childValue)) return false;
      } else if (!Array.isArray(childValue)) {
        return false;
      }
      continue;
    }

    if (DENYLIST_KEYS.has(key)) {
      if (parentHas) {
        if (!childHas || !Array.isArray(parentValue) || !Array.isArray(childValue)) {
          return false;
        }
        if (!arrayIsSuperset(parentValue, childValue)) return false;
      } else if (!Array.isArray(childValue)) {
        return false;
      }
      continue;
    }

    if (BOOLEAN_REDUCTION_KEYS.has(key)) {
      if (parentHas) {
        if (typeof parentValue !== 'boolean' || typeof childValue !== 'boolean') {
          return false;
        }
        if (parentValue === false && childValue !== false) return false;
      } else if (childValue !== false) {
        return false;
      }
      continue;
    }

    if (!parentHas || !childHas || !deepEqual(parentValue, childValue)) {
      return false;
    }
  }

  return true;
}

function validWindowContains(parent, child) {
  const parentFrom = asDate(parent.validFrom).getTime();
  const childFrom = asDate(child.validFrom).getTime();
  if (childFrom < parentFrom) return false;

  if (parent.validUntil == null) return true;
  if (child.validUntil == null) return false;
  return asDate(child.validUntil).getTime() <= asDate(parent.validUntil).getTime();
}

/**
 * Enforces the core delegation invariant across every authority dimension that
 * M1 currently models. It is used both before issuance and again during
 * resolution, so malformed/bypassed rows cannot grant economic authority.
 */
export function assertDelegationNarrowing(parent, child) {
  if (child.issuerPrincipalId !== parent.issuerPrincipalId) {
    deny('delegation_root_changed', 'Delegation cannot change the root Principal');
  }
  if (child.parentMandateId !== parent.id) {
    deny('delegation_parent_mismatch', 'Delegated Mandate must reference its parent');
  }
  if (child.delegatingAgentIdentityId !== parent.subjectAgentIdentityId) {
    deny('delegator_mismatch', 'Only the parent Mandate subject Agent may delegate');
  }
  if (child.delegationDepth !== parent.delegationDepth + 1) {
    deny('delegation_depth_invalid', 'Delegation depth must advance exactly one hop');
  }
  if (!parent.delegationAllowed || child.delegationDepth > parent.maxDelegationDepth) {
    deny('delegation_not_allowed', 'Parent Mandate does not allow this delegation depth');
  }
  if (child.delegationDepth > 1) {
    deny('delegation_depth_exceeded', 'MVP delegation depth is limited to one hop');
  }
  if (child.delegationAllowed || child.maxDelegationDepth !== 0) {
    deny('delegation_child_redelegates', 'MVP sub-Agent Mandates cannot delegate further');
  }
  if (!validWindowContains(parent, child)) {
    deny('delegation_time_expansion', 'Delegated Mandate cannot expand the parent validity window');
  }
  if (!isScopeSetNarrowerOrEqual(parent.actionScopes, child.actionScopes)) {
    deny('delegation_action_expansion', 'Delegated action scope exceeds parent authority');
  }
  if (!isScopeSetNarrowerOrEqual(parent.capabilityScopes, child.capabilityScopes)) {
    deny('delegation_capability_expansion', 'Delegated capability scope exceeds parent authority');
  }
  if (!isEconomicLimitsNarrowerOrEqual(parent.economicLimits, child.economicLimits)) {
    deny('delegation_economic_expansion', 'Delegated economic limits exceed parent authority');
  }
  if (!isPolicyNarrowerOrEqual(parent.resourcePolicy, child.resourcePolicy)) {
    deny('delegation_resource_expansion', 'Delegated resource policy exceeds parent authority');
  }
  if (!isPolicyNarrowerOrEqual(parent.dataPolicy, child.dataPolicy)) {
    deny('delegation_data_expansion', 'Delegated data policy exceeds parent authority');
  }
  if (!isPolicyNarrowerOrEqual(parent.counterpartyPolicy, child.counterpartyPolicy)) {
    deny('delegation_counterparty_expansion', 'Delegated counterparty policy exceeds parent authority');
  }

  return true;
}

function isActiveAt(mandate, at) {
  const timestamp = at.getTime();
  if (asDate(mandate.validFrom).getTime() > timestamp) return false;
  if (mandate.validUntil != null && asDate(mandate.validUntil).getTime() <= timestamp) {
    return false;
  }
  if (mandate.revokedAt != null && asDate(mandate.revokedAt).getTime() <= timestamp) {
    return false;
  }
  if (mandate.supersededAt != null && asDate(mandate.supersededAt).getTime() <= timestamp) {
    return false;
  }
  return true;
}

function assertEconomicRequestWithinLimits(limits, request, path = '') {
  if (!isPlainObject(request)) {
    deny('economic_request_invalid', 'Economic request must be an object');
  }
  if (!isPlainObject(limits)) {
    deny('economic_limits_invalid', 'Mandate economic limits must be an object');
  }

  for (const [key, requestedValue] of Object.entries(request)) {
    const fullKey = path ? `${path}.${key}` : key;
    if (!hasOwn(limits, key)) {
      deny('economic_limit_missing', `Mandate has no limit for ${fullKey}`);
    }
    const limitValue = limits[key];

    if (typeof requestedValue === 'number') {
      if (typeof limitValue !== 'number' || requestedValue > limitValue) {
        deny('economic_limit_exceeded', `Economic request exceeds ${fullKey}`);
      }
      continue;
    }

    if (isPlainObject(requestedValue)) {
      assertEconomicRequestWithinLimits(limitValue, requestedValue, fullKey);
      continue;
    }

    if (!deepEqual(limitValue, requestedValue)) {
      deny('economic_constraint_mismatch', `Economic constraint does not match ${fullKey}`);
    }
  }
}

function refsAllowed(policy, allowKey, refs) {
  if (!refs || refs.length === 0) return true;
  const allowlist = policy?.[allowKey];
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false;
  return refs.every((ref) => allowlist.some((grant) => scopePatternCovers(grant, ref)));
}

function counterpartyAllowed(policy, principalId) {
  if (!principalId) return true;
  const denylist = policy?.deny ?? policy?.denylist;
  if (Array.isArray(denylist) && denylist.some((entry) => scopePatternCovers(entry, principalId))) {
    return false;
  }

  const allowlist = policy?.allow ?? policy?.allowlist;
  if (allowlist === undefined) return true;
  if (!Array.isArray(allowlist) || allowlist.length === 0) return false;
  return allowlist.some((entry) => scopePatternCovers(entry, principalId));
}

function minValidUntil(chain) {
  const times = chain
    .map((mandate) => mandate.validUntil)
    .filter((value) => value != null)
    .map((value) => asDate(value).getTime());
  return times.length === 0 ? null : new Date(Math.min(...times));
}

function maxValidFrom(chain) {
  return new Date(
    Math.max(...chain.map((mandate) => asDate(mandate.validFrom).getTime())),
  );
}

/**
 * Resolves one explicit Mandate chain. M1-05 does not auto-select the “best”
 * Mandate: callers must name the authority fact they are presenting, which is
 * safer and preserves deterministic auditability for later AuthoritySnapshot.
 */
export function evaluateAuthorityChain(chain, request) {
  if (!Array.isArray(chain) || chain.length < 1 || chain.length > 2) {
    deny('authority_chain_invalid', 'MVP authority chain must contain one or two Mandates');
  }

  const at = request.at ? asDate(request.at) : new Date();
  const root = chain[0];
  const leaf = chain[chain.length - 1];

  if (root.delegationDepth !== 0 || root.parentMandateId != null) {
    deny('authority_root_invalid', 'Authority chain must start with a root Mandate');
  }

  if (chain.length === 2) {
    assertDelegationNarrowing(root, leaf);
  } else if (leaf.delegationDepth !== 0) {
    deny('authority_parent_missing', 'Delegated authority requires its parent Mandate');
  }

  if (request.subjectAgentIdentityId !== leaf.subjectAgentIdentityId) {
    deny('authority_subject_mismatch', 'Presented Mandate does not authorize this AgentIdentity');
  }

  for (const mandate of chain) {
    if (mandate.principalStatus !== 'active') {
      deny('principal_not_active', 'Root Principal is not active');
    }
    if (mandate.subjectAgentStatus !== 'active') {
      deny('agent_not_active', 'An Agent in the authority chain is not active');
    }
    if (!isActiveAt(mandate, at)) {
      deny('mandate_not_active', 'Mandate is not effective at the requested time');
    }
    if (!scopeSetAllows(mandate.actionScopes, request.action)) {
      deny('action_not_authorized', `Mandate does not authorize ${request.action}`);
    }
    if (
      request.capabilityId &&
      !scopeSetAllows(mandate.capabilityScopes, request.capabilityId)
    ) {
      deny('capability_not_authorized', `Mandate does not authorize ${request.capabilityId}`);
    }
    if (request.economic) {
      assertEconomicRequestWithinLimits(mandate.economicLimits, request.economic);
    }
    if (!refsAllowed(mandate.resourcePolicy, 'allowedResourceRefs', request.resourceRefs)) {
      deny('resource_not_authorized', 'Requested resource is outside Mandate resource policy');
    }
    if (!refsAllowed(mandate.dataPolicy, 'allowedDataRefs', request.dataRefs)) {
      deny('data_not_authorized', 'Requested data is outside Mandate data policy');
    }
    if (request.rawDataAccess === true && mandate.dataPolicy?.rawDataAccess !== true) {
      deny('raw_data_not_authorized', 'Mandate does not authorize raw data access');
    }
    if (!counterpartyAllowed(mandate.counterpartyPolicy, request.counterpartyPrincipalId)) {
      deny('counterparty_not_authorized', 'Counterparty is outside Mandate policy');
    }
  }

  return {
    allowed: true,
    principalId: root.issuerPrincipalId,
    subjectAgentIdentityId: leaf.subjectAgentIdentityId,
    delegationDepth: leaf.delegationDepth,
    mandateChain: chain.map((mandate) => ({
      id: mandate.id,
      version: mandate.version,
      payloadHash: mandate.payloadHash,
    })),
    effective: {
      actionScopes: [...leaf.actionScopes],
      capabilityScopes: [...leaf.capabilityScopes],
      economicLimits: leaf.economicLimits,
      resourcePolicy: leaf.resourcePolicy,
      dataPolicy: leaf.dataPolicy,
      counterpartyPolicy: leaf.counterpartyPolicy,
      validFrom: maxValidFrom(chain),
      validUntil: minValidUntil(chain),
    },
  };
}

function toAuthorityFact(record) {
  return {
    id: record.id,
    version: record.version,
    payloadHash: record.payloadHash,
    issuerPrincipalId: record.issuerPrincipalId,
    subjectAgentIdentityId: record.subjectAgentIdentityId,
    actionScopes: record.actionScopes,
    capabilityScopes: record.capabilityScopes,
    economicLimits: record.economicLimits,
    resourcePolicy: record.resourcePolicy,
    dataPolicy: record.dataPolicy,
    counterpartyPolicy: record.counterpartyPolicy,
    validFrom: record.validFrom,
    validUntil: record.validUntil,
    delegationAllowed: record.delegationAllowed,
    maxDelegationDepth: record.maxDelegationDepth,
    delegationDepth: record.delegationDepth,
    parentMandateId: record.parentMandateId,
    delegatingAgentIdentityId: record.delegatingAgentIdentityId,
    revokedAt: record.revocation?.revokedAt ?? null,
    supersededAt: record.supersededBy?.validFrom ?? null,
    principalStatus: record.issuerPrincipal.status,
    subjectAgentStatus: record.subjectAgent.status,
  };
}

const mandateAuthorityInclude = {
  revocation: true,
  supersededBy: { select: { validFrom: true } },
  issuerPrincipal: { select: { status: true } },
  subjectAgent: { select: { status: true } },
};

/**
 * Prisma adapter for deterministic authority resolution. It accepts a specific
 * Mandate id instead of searching/ranking Mandates implicitly.
 */
export async function resolveAuthority(prisma, request) {
  const leaf = await prisma.mandate.findUnique({
    where: { id: request.mandateId },
    include: {
      ...mandateAuthorityInclude,
      parentMandate: {
        include: mandateAuthorityInclude,
      },
    },
  });

  if (!leaf) {
    deny('mandate_not_found', 'Presented Mandate does not exist');
  }

  const chain = leaf.parentMandate
    ? [toAuthorityFact(leaf.parentMandate), toAuthorityFact(leaf)]
    : [toAuthorityFact(leaf)];

  return evaluateAuthorityChain(chain, request);
}

/**
 * Controlled one-hop delegated Mandate issuance. Signature verification itself
 * is deliberately not folded into this service; M1-06 will connect request
 * authentication/signature verification to this already fail-closed authority
 * layer. No raw signing key material is handled here.
 */
export async function createDelegatedMandate(prisma, input) {
  const parent = await prisma.mandate.findUnique({
    where: { id: input.parentMandateId },
    include: mandateAuthorityInclude,
  });
  if (!parent) {
    deny('parent_mandate_not_found', 'Parent Mandate does not exist');
  }

  const subjectAgent = await prisma.agentIdentity.findUnique({
    where: { id: input.subjectAgentIdentityId },
    select: { status: true },
  });
  if (!subjectAgent || subjectAgent.status !== 'active') {
    deny('delegated_subject_not_active', 'Delegated subject Agent must be active');
  }

  const parentFact = toAuthorityFact(parent);
  const candidate = {
    ...input,
    issuerPrincipalId: parent.issuerPrincipalId,
    parentMandateId: parent.id,
    delegatingAgentIdentityId: parent.subjectAgentIdentityId,
    delegationDepth: parent.delegationDepth + 1,
    delegationAllowed: false,
    maxDelegationDepth: 0,
    principalStatus: parent.issuerPrincipal.status,
    subjectAgentStatus: subjectAgent.status,
    revokedAt: null,
    supersededAt: null,
  };

  // Issuance itself must be based on currently usable parent authority at the
  // child validFrom boundary, and the child must be a strict subset/equal.
  evaluateAuthorityChain([parentFact], {
    mandateId: parent.id,
    subjectAgentIdentityId: parent.subjectAgentIdentityId,
    action: input.actionScopes[0],
    capabilityId: input.capabilityScopes[0],
    at: input.validFrom,
  });
  assertDelegationNarrowing(parentFact, candidate);

  return prisma.mandate.create({
    data: {
      mandateFamilyId: input.mandateFamilyId,
      version: input.version,
      protocolVersion: input.protocolVersion,
      issuerPrincipalId: parent.issuerPrincipalId,
      subjectAgentIdentityId: input.subjectAgentIdentityId,
      actionScopes: input.actionScopes,
      capabilityScopes: input.capabilityScopes,
      economicLimits: input.economicLimits,
      resourcePolicy: input.resourcePolicy,
      dataPolicy: input.dataPolicy,
      counterpartyPolicy: input.counterpartyPolicy,
      validFrom: input.validFrom,
      validUntil: input.validUntil,
      delegationAllowed: false,
      maxDelegationDepth: 0,
      payloadHash: input.payloadHash,
      signatureAlgorithm: input.signatureAlgorithm,
      signatureKeyId: input.signatureKeyId,
      signature: input.signature,
      supersedesMandateId: input.supersedesMandateId,
      parentMandateId: parent.id,
      delegatingAgentIdentityId: parent.subjectAgentIdentityId,
      delegationDepth: parent.delegationDepth + 1,
    },
  });
}
