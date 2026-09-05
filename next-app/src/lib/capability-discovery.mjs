export class CapabilityDiscoveryError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'CapabilityDiscoveryError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new CapabilityDiscoveryError(code, message, details);
}

function nonEmptyString(value, code, message) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny(code, message);
  }
  return value.trim();
}

/**
 * Registers a discoverable capability definition. Registration is indexing
 * metadata only; absence from this table must never mean an Agent is forbidden
 * from claiming or using an external capability namespace.
 */
export async function registerCapabilityDefinition(prisma, input) {
  const id = nonEmptyString(input?.id, 'capability_id_required', 'Capability id is required');
  const namespace = nonEmptyString(
    input?.namespace,
    'capability_namespace_required',
    'Capability namespace is required',
  );
  const name = nonEmptyString(input?.name, 'capability_name_required', 'Capability name is required');

  if (input.parentId === id) {
    deny('capability_parent_self', 'Capability cannot be its own parent');
  }

  return prisma.capabilityDefinition.create({
    data: {
      id,
      parentId: input.parentId ?? null,
      name,
      description: input.description ?? null,
      namespace,
      version: input.version ?? null,
      schemaRef: input.schemaRef ?? null,
      status: input.status ?? 'active',
      metadata: input.metadata ?? undefined,
    },
  });
}

/**
 * Declares a capability for one immutable AgentVersion. Deliberately does not
 * query CapabilityDefinition first: the local registry is an index, not an
 * allowlist, and external capability URIs/URNs remain valid declarations.
 */
export async function declareAgentCapability(prisma, input) {
  const agentVersionId = nonEmptyString(
    input?.agentVersionId,
    'agent_version_required',
    'AgentVersion id is required',
  );
  const capabilityId = nonEmptyString(
    input?.capabilityId,
    'capability_id_required',
    'Capability id is required',
  );

  return prisma.agentCapabilityClaim.create({
    data: {
      agentVersionId,
      capabilityId,
      claimStatus: 'declared',
      descriptor: input.descriptor ?? undefined,
    },
  });
}

/**
 * Discovery/presentation metadata for a stable AgentIdentity. This profile is
 * mutable market metadata, not protocol identity, authority or reputation.
 */
export async function upsertAgentMarketProfile(prisma, input) {
  const agentIdentityId = nonEmptyString(
    input?.agentIdentityId,
    'agent_identity_required',
    'AgentIdentity id is required',
  );
  const data = {
    summary: input.summary ?? null,
    description: input.description ?? null,
    a2aCardUrl: input.a2aCardUrl ?? null,
    acceptsPublicTasks: input.acceptsPublicTasks ?? true,
    availability: input.availability ?? 'available',
    extensions: input.extensions ?? undefined,
  };

  return prisma.agentMarketProfile.upsert({
    where: { agentIdentityId },
    create: { agentIdentityId, ...data },
    update: data,
  });
}
