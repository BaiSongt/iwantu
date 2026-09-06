import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

const TASK_REVISION_PROTOCOL_VERSION = 'iwantu-task-revision/0.1';
const TASK_VISIBILITIES = new Set(['public', 'unlisted', 'private']);
const REVISIONABLE_TASK_STATUSES = new Set(['draft', 'open']);

export class TaskProtocolError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'TaskProtocolError';
    this.code = code;
    this.details = details;
  }
}

function deny(code, message, details) {
  throw new TaskProtocolError(code, message, details);
}

function nonEmpty(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    deny('TASK_INPUT_INVALID', `${field} must be a non-empty string`, { field });
  }
  return value.trim();
}

function normalizeJsonValue(value, field) {
  if (value === null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      deny('TASK_PAYLOAD_INVALID', `${field} contains a non-finite number`, { field });
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => normalizeJsonValue(item, `${field}[${index}]`));
  }
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, normalizeJsonValue(value[key], `${field}.${key}`)]),
    );
  }
  deny('TASK_PAYLOAD_INVALID', `${field} must be JSON-compatible`, { field });
}

function normalizeJsonObject(value, field) {
  const normalized = normalizeJsonValue(value ?? {}, field);
  if (!normalized || Array.isArray(normalized) || typeof normalized !== 'object') {
    deny('TASK_PAYLOAD_INVALID', `${field} must be a JSON object`, { field });
  }
  return normalized;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalTaskJson(value) {
  return JSON.stringify(canonicalize(value));
}

export function normalizeTaskCapabilityRequirements(input) {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) {
    deny('TASK_CAPABILITY_REQUIREMENTS_INVALID', 'capabilityRequirements must be an array');
  }

  const seen = new Set();
  const requirements = input.map((requirement, index) => {
    if (!requirement || typeof requirement !== 'object' || Array.isArray(requirement)) {
      deny('TASK_CAPABILITY_REQUIREMENT_INVALID', 'Capability requirement must be an object', {
        index,
      });
    }
    const capabilityId = nonEmpty(
      requirement.capabilityId,
      `capabilityRequirements[${index}].capabilityId`,
    );
    if (seen.has(capabilityId)) {
      deny('TASK_CAPABILITY_REQUIREMENT_DUPLICATE', 'Capability requirement ids must be unique', {
        capabilityId,
      });
    }
    seen.add(capabilityId);

    const requirementPayload = requirement.requirementPayload === undefined
      || requirement.requirementPayload === null
      ? null
      : normalizeJsonObject(
        requirement.requirementPayload,
        `capabilityRequirements[${index}].requirementPayload`,
      );

    return { capabilityId, requirementPayload };
  });

  return requirements.sort((left, right) => left.capabilityId.localeCompare(right.capabilityId));
}

export function normalizeTaskRevisionInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('TASK_INPUT_INVALID', 'Task revision input must be an object');
  }

  return {
    protocolPayload: normalizeJsonObject(input.protocolPayload, 'protocolPayload'),
    workPayload: normalizeJsonObject(input.workPayload, 'workPayload'),
    marketPayload: normalizeJsonObject(input.marketPayload, 'marketPayload'),
    trustPayload: normalizeJsonObject(input.trustPayload, 'trustPayload'),
    policyPayload: normalizeJsonObject(input.policyPayload, 'policyPayload'),
    capabilityRequirements: normalizeTaskCapabilityRequirements(input.capabilityRequirements),
  };
}

export function buildTaskRevisionEvidence(normalized) {
  return {
    protocolVersion: TASK_REVISION_PROTOCOL_VERSION,
    protocolPayload: normalized.protocolPayload,
    workPayload: normalized.workPayload,
    marketPayload: normalized.marketPayload,
    trustPayload: normalized.trustPayload,
    policyPayload: normalized.policyPayload,
    capabilityRequirements: normalized.capabilityRequirements,
  };
}

export function hashTaskRevisionEvidence(evidence) {
  return createHash('sha256').update(canonicalTaskJson(evidence), 'utf8').digest('hex');
}

export function buildTaskRevisionHash(input) {
  const normalized = normalizeTaskRevisionInput(input);
  return hashTaskRevisionEvidence(buildTaskRevisionEvidence(normalized));
}

async function requireActiveIssuer(tx, principalId, agentIdentityId) {
  const [principal, agent] = await Promise.all([
    tx.principal.findUnique({
      where: { id: principalId },
      select: { id: true, status: true },
    }),
    tx.agentIdentity.findUnique({
      where: { id: agentIdentityId },
      select: { id: true, principalId: true, status: true },
    }),
  ]);

  if (!principal) {
    deny('TASK_ISSUER_PRINCIPAL_NOT_FOUND', 'Issuer Principal does not exist', { principalId });
  }
  if (principal.status !== 'active') {
    deny('TASK_ISSUER_PRINCIPAL_INACTIVE', 'Issuer Principal must be active', {
      principalId,
      status: principal.status,
    });
  }
  if (!agent) {
    deny('TASK_ISSUER_AGENT_NOT_FOUND', 'Issuer AgentIdentity does not exist', { agentIdentityId });
  }
  if (agent.principalId !== principalId) {
    deny('TASK_ISSUER_OWNERSHIP_MISMATCH', 'Issuer AgentIdentity must belong to issuer Principal', {
      principalId,
      agentIdentityId,
      agentPrincipalId: agent.principalId,
    });
  }
  if (agent.status !== 'active') {
    deny('TASK_ISSUER_AGENT_INACTIVE', 'Issuer AgentIdentity must be active', {
      agentIdentityId,
      status: agent.status,
    });
  }
}

async function createAndSealRevision(tx, taskId, revision, normalized) {
  const contentHash = hashTaskRevisionEvidence(buildTaskRevisionEvidence(normalized));
  const duplicate = await tx.taskRevision.findUnique({
    where: { taskId_contentHash: { taskId, contentHash } },
    select: { id: true, revision: true },
  });
  if (duplicate) {
    deny('TASK_REVISION_DUPLICATE_CONTENT', 'Task revision content is already present on this Task', {
      taskId,
      contentHash,
      existingRevision: duplicate.revision,
    });
  }

  const taskRevision = await tx.taskRevision.create({
    data: {
      taskId,
      revision,
      contentHash,
      protocolPayload: normalized.protocolPayload,
      workPayload: normalized.workPayload,
      marketPayload: normalized.marketPayload,
      trustPayload: normalized.trustPayload,
      policyPayload: normalized.policyPayload,
    },
  });

  if (normalized.capabilityRequirements.length > 0) {
    await tx.taskCapabilityRequirement.createMany({
      data: normalized.capabilityRequirements.map((requirement) => ({
        taskRevisionId: taskRevision.id,
        capabilityId: requirement.capabilityId,
        ...(requirement.requirementPayload === null
          ? {}
          : { requirementPayload: requirement.requirementPayload }),
      })),
    });
  }

  return tx.taskRevision.update({
    where: { id: taskRevision.id },
    data: { sealedAt: new Date() },
    include: { capabilityRequirements: { orderBy: { capabilityId: 'asc' } } },
  });
}

export async function createTask(prisma, input) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('TASK_CLIENT_INVALID', 'createTask requires a PrismaClient');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('TASK_INPUT_INVALID', 'Task input must be an object');
  }

  const issuerPrincipalId = nonEmpty(input.issuerPrincipalId, 'issuerPrincipalId');
  const issuerAgentIdentityId = nonEmpty(input.issuerAgentIdentityId, 'issuerAgentIdentityId');
  const visibility = input.visibility ?? 'public';
  if (!TASK_VISIBILITIES.has(visibility)) {
    deny('TASK_VISIBILITY_INVALID', 'Unsupported Task visibility', { visibility });
  }
  const normalized = normalizeTaskRevisionInput(input);

  return prisma.$transaction(async (tx) => {
    await requireActiveIssuer(tx, issuerPrincipalId, issuerAgentIdentityId);

    const task = await tx.task.create({
      data: {
        issuerPrincipalId,
        issuerAgentIdentityId,
        visibility,
        currentRevision: 1,
      },
    });
    const revision = await createAndSealRevision(tx, task.id, 1, normalized);
    return { task, revision };
  });
}

async function lockTask(tx, taskId) {
  const rows = await tx.$queryRaw(
    Prisma.sql`
      SELECT
        "id",
        "issuerPrincipalId",
        "issuerAgentIdentityId",
        "status",
        "visibility",
        "currentRevision",
        "createdAt",
        "openedAt",
        "closedAt"
      FROM "tasks"
      WHERE "id" = ${taskId}
      FOR UPDATE
    `,
  );
  return rows[0] ?? null;
}

export async function reviseTask(prisma, input) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('TASK_CLIENT_INVALID', 'reviseTask requires a PrismaClient');
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    deny('TASK_INPUT_INVALID', 'Task revision input must be an object');
  }
  const taskId = nonEmpty(input.taskId, 'taskId');
  const normalized = normalizeTaskRevisionInput(input);

  return prisma.$transaction(async (tx) => {
    const task = await lockTask(tx, taskId);
    if (!task) {
      deny('TASK_NOT_FOUND', 'Task does not exist', { taskId });
    }
    if (!REVISIONABLE_TASK_STATUSES.has(task.status)) {
      deny('TASK_NOT_REVISIONABLE', 'Task can only be revised while draft or open', {
        taskId,
        status: task.status,
      });
    }

    const revisionNumber = task.currentRevision + 1;
    const revision = await createAndSealRevision(tx, taskId, revisionNumber, normalized);
    const updatedTask = await tx.task.update({
      where: { id: taskId },
      data: { currentRevision: revisionNumber },
    });
    return { task: updatedTask, revision };
  });
}

export async function openTask(prisma, input) {
  if (!prisma || typeof prisma.$transaction !== 'function') {
    deny('TASK_CLIENT_INVALID', 'openTask requires a PrismaClient');
  }
  const taskId = nonEmpty(input?.taskId, 'taskId');

  return prisma.$transaction(async (tx) => {
    const task = await lockTask(tx, taskId);
    if (!task) {
      deny('TASK_NOT_FOUND', 'Task does not exist', { taskId });
    }
    if (task.status === 'open') {
      return tx.task.findUnique({ where: { id: taskId } });
    }
    if (task.status !== 'draft') {
      deny('TASK_NOT_OPENABLE', 'Only draft Task can be opened', {
        taskId,
        status: task.status,
      });
    }

    return tx.task.update({
      where: { id: taskId },
      data: { status: 'open', openedAt: new Date() },
    });
  });
}

export async function loadTaskRevisionSnapshot(prisma, input) {
  const taskId = nonEmpty(input?.taskId, 'taskId');
  const revision = input?.revision;
  if (!Number.isInteger(revision) || revision < 1) {
    deny('TASK_REVISION_INVALID', 'revision must be a positive integer', { revision });
  }

  const snapshot = await prisma.taskRevision.findUnique({
    where: { taskId_revision: { taskId, revision } },
    include: { capabilityRequirements: { orderBy: { capabilityId: 'asc' } } },
  });
  if (!snapshot || !snapshot.sealedAt) {
    deny('TASK_REVISION_NOT_FOUND', 'Sealed Task revision does not exist', { taskId, revision });
  }
  return snapshot;
}

export async function loadCurrentTaskSnapshot(prisma, input) {
  const taskId = nonEmpty(input?.taskId, 'taskId');
  const task = await prisma.task.findUnique({ where: { id: taskId } });
  if (!task) {
    deny('TASK_NOT_FOUND', 'Task does not exist', { taskId });
  }
  const revision = await loadTaskRevisionSnapshot(prisma, {
    taskId,
    revision: task.currentRevision,
  });
  return { task, revision };
}
