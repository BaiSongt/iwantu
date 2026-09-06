import { Prisma } from '@prisma/client';

export class TaskOfferLifecycleError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'TaskOfferLifecycleError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new TaskOfferLifecycleError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('PROTOCOL_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function positiveRevision(value) {
  if (!Number.isInteger(value) || value < 1) {
    deny('OFFER_REVISION_INVALID', 'revision must be a positive integer', { revision: value });
  }
  return value;
}

function asDate(value, field) {
  const result = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(result.getTime())) {
    deny('PROTOCOL_INPUT_INVALID', `${field} must be a valid timestamp`, { field });
  }
  return result;
}

function rejected(code, details = undefined) {
  return { ok: false, code, ...(details === undefined ? {} : { details }) };
}

async function lockTask(tx, taskId, mode = 'update') {
  const lockSql = mode === 'share' ? Prisma.sql`FOR SHARE` : Prisma.sql`FOR UPDATE`;
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT "id", "issuerPrincipalId", "issuerAgentIdentityId", "status", "currentRevision",
             "openedAt", "closedAt"
      FROM "tasks"
      WHERE "id" = ${taskId}
      ${lockSql}
    `,
  );
  return rows[0] ?? null;
}

async function lockOffer(tx, offerId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT "id", "taskId", "supplierPrincipalId", "supplierAgentIdentityId", "status", "currentRevision"
      FROM "offers"
      WHERE "id" = ${offerId}
      FOR UPDATE
    `,
  );
  return rows[0] ?? null;
}

async function lockOffersForTask(tx, taskId) {
  return tx.$queryRaw(
    Prisma.sql`
      SELECT "id", "status"
      FROM "offers"
      WHERE "taskId" = ${taskId}
      ORDER BY "id"
      FOR UPDATE
    `,
  );
}

async function closeActiveOffers(tx, taskId) {
  await lockOffersForTask(tx, taskId);
  return tx.offer.updateMany({
    where: { taskId, status: 'active' },
    data: { status: 'closed' },
  });
}

export async function cancelTask(prisma, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('PROTOCOL_CLIENT_INVALID', 'cancelTask requires a PrismaClient');
  }
  const taskId = nonEmpty(input?.taskId, 'taskId');
  const now = asDate(options.now ?? new Date(), 'now');

  return prisma.$transaction(async (tx) => {
    const task = await lockTask(tx, taskId);
    if (!task) deny('TASK_NOT_FOUND', 'Task does not exist', { taskId });
    if (task.status === 'cancelled') {
      return tx.task.findUnique({ where: { id: taskId } });
    }
    if (!['draft', 'open'].includes(task.status)) {
      deny('TASK_NOT_CANCELLABLE', 'Only draft or open Task can be cancelled', {
        taskId,
        status: task.status,
      });
    }

    await closeActiveOffers(tx, taskId);
    return tx.task.update({
      where: { id: taskId },
      data: { status: 'cancelled', closedAt: now },
    });
  });
}

export async function closeTask(prisma, input, options = {}) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('PROTOCOL_CLIENT_INVALID', 'closeTask requires a PrismaClient');
  }
  const taskId = nonEmpty(input?.taskId, 'taskId');
  const now = asDate(options.now ?? new Date(), 'now');

  return prisma.$transaction(async (tx) => {
    const task = await lockTask(tx, taskId);
    if (!task) deny('TASK_NOT_FOUND', 'Task does not exist', { taskId });
    if (task.status === 'closed') {
      return tx.task.findUnique({ where: { id: taskId } });
    }
    if (task.status !== 'open') {
      deny('TASK_NOT_CLOSABLE', 'Only open Task can be closed without a Contract', {
        taskId,
        status: task.status,
      });
    }

    await closeActiveOffers(tx, taskId);
    return tx.task.update({
      where: { id: taskId },
      data: { status: 'closed', closedAt: now },
    });
  });
}

export async function withdrawFirmOffer(prisma, input) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('PROTOCOL_CLIENT_INVALID', 'withdrawFirmOffer requires a PrismaClient');
  }
  const offerId = nonEmpty(input?.offerId, 'offerId');

  return prisma.$transaction(async (tx) => {
    // Read immutable taskId first, then follow the global M3 lock order Task -> Offer.
    const envelope = await tx.offer.findUnique({
      where: { id: offerId },
      select: { id: true, taskId: true },
    });
    if (!envelope) deny('OFFER_NOT_FOUND', 'Offer does not exist', { offerId });

    await lockTask(tx, envelope.taskId, 'share');
    const offer = await lockOffer(tx, offerId);
    if (!offer) deny('OFFER_NOT_FOUND', 'Offer does not exist', { offerId });
    if (offer.status === 'withdrawn') {
      return tx.offer.findUnique({ where: { id: offerId } });
    }
    if (offer.status !== 'active') {
      deny('OFFER_NOT_WITHDRAWABLE', 'Only an active Firm Offer can be withdrawn', {
        offerId,
        status: offer.status,
      });
    }

    return tx.offer.update({
      where: { id: offerId },
      data: { status: 'withdrawn' },
    });
  });
}

async function findCapabilityEligibleAgentVersion(prisma, agentIdentityId, requiredCapabilityIds) {
  if (requiredCapabilityIds.length === 0) return { ok: true, agentVersionId: null };

  const versions = await prisma.agentVersion.findMany({
    where: { agentIdentityId, retiredAt: null },
    select: { id: true, version: true, createdAt: true },
    orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
  });
  if (versions.length === 0) {
    return {
      ok: false,
      code: 'SUPPLIER_CAPABILITY_MISMATCH',
      details: { reason: 'NO_ACTIVE_AGENT_VERSION', requiredCapabilityIds },
    };
  }

  const claims = await prisma.agentCapabilityClaim.findMany({
    where: {
      agentVersionId: { in: versions.map((version) => version.id) },
      capabilityId: { in: requiredCapabilityIds },
    },
    select: { agentVersionId: true, capabilityId: true, claimStatus: true },
  });

  const claimsByVersion = new Map();
  for (const claim of claims) {
    if (!claimsByVersion.has(claim.agentVersionId)) claimsByVersion.set(claim.agentVersionId, new Set());
    claimsByVersion.get(claim.agentVersionId).add(claim.capabilityId);
  }

  for (const version of versions) {
    const versionClaims = claimsByVersion.get(version.id) ?? new Set();
    if (requiredCapabilityIds.every((capabilityId) => versionClaims.has(capabilityId))) {
      return { ok: true, agentVersionId: version.id, agentVersion: version.version };
    }
  }

  const best = versions
    .map((version) => {
      const versionClaims = claimsByVersion.get(version.id) ?? new Set();
      const missingCapabilityIds = requiredCapabilityIds.filter(
        (capabilityId) => !versionClaims.has(capabilityId),
      );
      return { version, missingCapabilityIds };
    })
    .sort((left, right) => left.missingCapabilityIds.length - right.missingCapabilityIds.length)[0];

  return {
    ok: false,
    code: 'SUPPLIER_CAPABILITY_MISMATCH',
    details: {
      requiredCapabilityIds,
      closestAgentVersionId: best?.version.id ?? null,
      missingCapabilityIds: best?.missingCapabilityIds ?? requiredCapabilityIds,
    },
  };
}

function statusFailure(status) {
  if (status === 'withdrawn') return 'OFFER_WITHDRAWN';
  if (status === 'accepted') return 'OFFER_ALREADY_ACCEPTED';
  if (status === 'not_selected') return 'OFFER_NOT_SELECTED';
  if (status === 'closed') return 'OFFER_CLOSED';
  return 'OFFER_NOT_ACTIVE';
}

export async function evaluateFirmOfferAcceptability(prisma, input, options = {}) {
  if (!prisma || typeof prisma.offer?.findUnique !== 'function') {
    deny('PROTOCOL_CLIENT_INVALID', 'evaluateFirmOfferAcceptability requires a PrismaClient');
  }
  const offerId = nonEmpty(input?.offerId, 'offerId');
  const revision = positiveRevision(input?.revision);
  const offerHash = nonEmpty(input?.offerHash, 'offerHash');
  const now = asDate(options.now ?? new Date(), 'now');

  const offer = await prisma.offer.findUnique({ where: { id: offerId } });
  if (!offer) return rejected('OFFER_NOT_FOUND', { offerId });

  const task = await prisma.task.findUnique({ where: { id: offer.taskId } });
  if (!task) return rejected('TASK_NOT_FOUND', { taskId: offer.taskId });
  if (task.status !== 'open') {
    return rejected('TASK_NOT_OPEN', { taskId: task.id, status: task.status });
  }

  if (offer.status !== 'active') {
    return rejected(statusFailure(offer.status), { offerId, status: offer.status });
  }
  if (revision !== offer.currentRevision) {
    return rejected('OFFER_SUPERSEDED', {
      offerId,
      requestedRevision: revision,
      currentRevision: offer.currentRevision,
    });
  }

  const offerRevision = await prisma.offerRevision.findUnique({
    where: { offerId_revision: { offerId, revision } },
  });
  if (!offerRevision) return rejected('OFFER_REVISION_NOT_FOUND', { offerId, revision });
  if (offerRevision.offerHash !== offerHash) {
    return rejected('OFFER_REVISION_MISMATCH', {
      offerId,
      revision,
      expectedOfferHash: offerRevision.offerHash,
      providedOfferHash: offerHash,
    });
  }
  if (now.getTime() >= offerRevision.validUntil.getTime()) {
    return rejected('OFFER_EXPIRED', {
      offerId,
      revision,
      validUntil: offerRevision.validUntil.toISOString(),
      evaluatedAt: now.toISOString(),
    });
  }

  const currentTaskRevision = await prisma.taskRevision.findUnique({
    where: { taskId_revision: { taskId: task.id, revision: task.currentRevision } },
    include: { capabilityRequirements: { orderBy: { capabilityId: 'asc' } } },
  });
  if (!currentTaskRevision || !currentTaskRevision.sealedAt) {
    return rejected('TASK_REVISION_INVALID', {
      taskId: task.id,
      revision: task.currentRevision,
    });
  }
  if (
    offerRevision.taskRevisionId !== currentTaskRevision.id
    || offerRevision.taskHash !== currentTaskRevision.contentHash
  ) {
    return rejected('TASK_REVISION_MISMATCH', {
      taskId: task.id,
      currentTaskRevision: task.currentRevision,
      currentTaskHash: currentTaskRevision.contentHash,
      offerTaskRevisionId: offerRevision.taskRevisionId,
      offerTaskHash: offerRevision.taskHash,
    });
  }

  const [supplierPrincipal, supplierAgent] = await Promise.all([
    prisma.principal.findUnique({
      where: { id: offer.supplierPrincipalId },
      select: { id: true, status: true },
    }),
    prisma.agentIdentity.findUnique({
      where: { id: offer.supplierAgentIdentityId },
      select: { id: true, principalId: true, status: true },
    }),
  ]);
  if (!supplierPrincipal || supplierPrincipal.status !== 'active') {
    return rejected('OFFER_SUPPLIER_PRINCIPAL_INACTIVE', {
      supplierPrincipalId: offer.supplierPrincipalId,
      status: supplierPrincipal?.status ?? 'missing',
    });
  }
  if (
    !supplierAgent
    || supplierAgent.status !== 'active'
    || supplierAgent.principalId !== offer.supplierPrincipalId
  ) {
    return rejected('OFFER_SUPPLIER_AGENT_INACTIVE', {
      supplierAgentIdentityId: offer.supplierAgentIdentityId,
      status: supplierAgent?.status ?? 'missing',
    });
  }

  const requiredCapabilityIds = currentTaskRevision.capabilityRequirements.map(
    (requirement) => requirement.capabilityId,
  );
  const capability = await findCapabilityEligibleAgentVersion(
    prisma,
    offer.supplierAgentIdentityId,
    requiredCapabilityIds,
  );
  if (!capability.ok) return rejected(capability.code, capability.details);

  return {
    ok: true,
    code: 'OFFER_ACCEPTABLE',
    offerId,
    revision,
    offerHash,
    taskId: task.id,
    taskRevision: task.currentRevision,
    taskHash: currentTaskRevision.contentHash,
    supplierPrincipalId: offer.supplierPrincipalId,
    supplierAgentIdentityId: offer.supplierAgentIdentityId,
    matchingAgentVersionId: capability.agentVersionId,
    matchingAgentVersion: capability.agentVersion ?? null,
    evaluatedAt: now.toISOString(),
  };
}

export async function assertFirmOfferAcceptable(prisma, input, options = {}) {
  const result = await evaluateFirmOfferAcceptability(prisma, input, options);
  if (!result.ok) {
    deny(result.code, 'Firm Offer is not currently acceptable', result.details);
  }
  return result;
}
