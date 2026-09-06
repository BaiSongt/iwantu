import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  TaskProtocolError,
  buildTaskRevisionHash,
  createTask,
  loadCurrentTaskSnapshot,
  loadTaskRevisionSnapshot,
  openTask,
  reviseTask,
} from '../src/lib/task-protocol.mjs';

const prisma = new PrismaClient();

before(async () => {
  await prisma.$connect();
});

after(async () => {
  await prisma.$disconnect();
});

function unique(label) {
  return `${label}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createIssuerFixture(label) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `Task Org ${suffix}`, type: 'buyer' },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `Task Agent ${suffix}` },
  });
  return { suffix, organization, principal, agent };
}

function revisionInput(label, capabilityRequirements = []) {
  return {
    protocolPayload: {
      objective: `Complete ${label}`,
      inputs: [{ kind: 'asset_ref', ref: `asset:${label}` }],
      expectedOutputs: [{ kind: 'artifact', schema: `urn:test:${label}:output` }],
    },
    workPayload: {
      constraints: { deterministic: true },
      executionEnvironment: { mode: 'agent_runtime' },
    },
    marketPayload: {
      deadline: '2026-09-30T00:00:00Z',
      budget: { currency: 'IWC', maxAmount: '100.00000000' },
    },
    trustPayload: {
      requiredReputation: { mode: 'insufficient_evidence_allowed' },
    },
    policyPayload: {
      acceptancePolicy: { mode: 'REQUESTER_ACCEPTANCE', windowSeconds: 3600 },
      dataPolicy: { rawDataAccess: false },
    },
    capabilityRequirements,
  };
}

test('M3-01: Task domain is protocol-native and remains separate from legacy Demand', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const taskModel = schema.match(/model Task \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const revisionModel = schema.match(/model TaskRevision \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const requirementModel = schema.match(/model TaskCapabilityRequirement \{([\s\S]*?)\n\}/)?.[1] ?? '';

  assert.match(schema, /model Demand \{/);
  assert.match(schema, /model Task \{/);
  assert.match(schema, /model TaskRevision \{/);
  assert.match(schema, /model TaskCapabilityRequirement \{/);
  assert.match(taskModel, /issuerPrincipalId/);
  assert.match(taskModel, /issuerAgentIdentityId/);
  assert.match(revisionModel, /contentHash/);
  assert.match(revisionModel, /sealedAt/);
  assert.match(requirementModel, /taskRevisionId/);
  assert.match(requirementModel, /capabilityId/);

  for (const forbidden of ['allowAiSupplier', 'allowAiAutoBid', 'matchScore', 'matchScoreNum']) {
    assert.doesNotMatch(taskModel, new RegExp(forbidden, 'i'));
    assert.doesNotMatch(revisionModel, new RegExp(forbidden, 'i'));
  }
});

test('M3-01: createTask seals revision 1 with unregistered external capability requirements', async () => {
  const fixture = await createIssuerFixture('create');
  const capabilityId = `urn:external:cad:${fixture.suffix}:geometry-analysis`;
  const definition = await prisma.capabilityDefinition.findUnique({ where: { id: capabilityId } });
  assert.equal(definition, null);

  const input = revisionInput('create', [
    {
      capabilityId,
      requirementPayload: { minimumVersion: '2.1', feature: 'brep' },
    },
  ]);
  const created = await createTask(prisma, {
    issuerPrincipalId: fixture.principal.id,
    issuerAgentIdentityId: fixture.agent.id,
    visibility: 'public',
    ...input,
  });

  assert.equal(created.task.status, 'draft');
  assert.equal(created.task.currentRevision, 1);
  assert.ok(created.revision.sealedAt);
  assert.equal(created.revision.contentHash, buildTaskRevisionHash(input));
  assert.equal(created.revision.capabilityRequirements.length, 1);
  assert.equal(created.revision.capabilityRequirements[0].capabilityId, capabilityId);
});

test('M3-01: canonical task hash is independent of JSON key and capability input order', () => {
  const left = revisionInput('canonical', [
    { capabilityId: 'urn:test:z', requirementPayload: { b: 2, a: 1 } },
    { capabilityId: 'urn:test:a', requirementPayload: { mode: 'required' } },
  ]);
  const right = {
    policyPayload: { dataPolicy: { rawDataAccess: false }, acceptancePolicy: { windowSeconds: 3600, mode: 'REQUESTER_ACCEPTANCE' } },
    trustPayload: { requiredReputation: { mode: 'insufficient_evidence_allowed' } },
    marketPayload: { budget: { maxAmount: '100.00000000', currency: 'IWC' }, deadline: '2026-09-30T00:00:00Z' },
    workPayload: { executionEnvironment: { mode: 'agent_runtime' }, constraints: { deterministic: true } },
    protocolPayload: {
      expectedOutputs: [{ schema: 'urn:test:canonical:output', kind: 'artifact' }],
      inputs: [{ ref: 'asset:canonical', kind: 'asset_ref' }],
      objective: 'Complete canonical',
    },
    capabilityRequirements: [
      { capabilityId: 'urn:test:a', requirementPayload: { mode: 'required' } },
      { capabilityId: 'urn:test:z', requirementPayload: { a: 1, b: 2 } },
    ],
  };

  assert.equal(buildTaskRevisionHash(left), buildTaskRevisionHash(right));
});

test('M3-01: issuer AgentIdentity must belong to issuer Principal', async () => {
  const left = await createIssuerFixture('issuer-left');
  const right = await createIssuerFixture('issuer-right');

  await assert.rejects(
    createTask(prisma, {
      issuerPrincipalId: left.principal.id,
      issuerAgentIdentityId: right.agent.id,
      ...revisionInput('issuer-mismatch'),
    }),
    (error) => {
      assert.ok(error instanceof TaskProtocolError);
      assert.equal(error.code, 'TASK_ISSUER_OWNERSHIP_MISMATCH');
      return true;
    },
  );
});

test('M3-01: sealed TaskRevision and capability requirements are append-only', async () => {
  const fixture = await createIssuerFixture('immutable');
  const capabilityId = `urn:test:immutable:${fixture.suffix}`;
  const created = await createTask(prisma, {
    issuerPrincipalId: fixture.principal.id,
    issuerAgentIdentityId: fixture.agent.id,
    ...revisionInput('immutable', [{ capabilityId, requirementPayload: { level: 'strict' } }]),
  });

  await assert.rejects(
    prisma.taskRevision.update({
      where: { id: created.revision.id },
      data: { marketPayload: { budget: { maxAmount: '999' } } },
    }),
  );
  await assert.rejects(
    prisma.taskRevision.delete({ where: { id: created.revision.id } }),
  );
  await assert.rejects(
    prisma.taskCapabilityRequirement.update({
      where: { taskRevisionId_capabilityId: { taskRevisionId: created.revision.id, capabilityId } },
      data: { requirementPayload: { level: 'weaker' } },
    }),
  );
  await assert.rejects(
    prisma.taskCapabilityRequirement.create({
      data: {
        taskRevisionId: created.revision.id,
        capabilityId: `urn:test:late:${fixture.suffix}`,
      },
    }),
  );
});

test('M3-01: revisions advance sequentially and preserve historical snapshots', async () => {
  const fixture = await createIssuerFixture('revision');
  const created = await createTask(prisma, {
    issuerPrincipalId: fixture.principal.id,
    issuerAgentIdentityId: fixture.agent.id,
    ...revisionInput('revision-v1'),
  });
  const firstHash = created.revision.contentHash;

  const revised = await reviseTask(prisma, {
    taskId: created.task.id,
    ...revisionInput('revision-v2'),
  });
  assert.equal(revised.task.currentRevision, 2);
  assert.equal(revised.revision.revision, 2);
  assert.notEqual(revised.revision.contentHash, firstHash);

  const oldSnapshot = await loadTaskRevisionSnapshot(prisma, { taskId: created.task.id, revision: 1 });
  const current = await loadCurrentTaskSnapshot(prisma, { taskId: created.task.id });
  assert.equal(oldSnapshot.contentHash, firstHash);
  assert.equal(current.task.currentRevision, 2);
  assert.equal(current.revision.revision, 2);
});

test('M3-01: duplicate revision content is rejected instead of manufacturing a new revision number', async () => {
  const fixture = await createIssuerFixture('duplicate');
  const input = revisionInput('duplicate');
  const created = await createTask(prisma, {
    issuerPrincipalId: fixture.principal.id,
    issuerAgentIdentityId: fixture.agent.id,
    ...input,
  });

  await assert.rejects(
    reviseTask(prisma, { taskId: created.task.id, ...input }),
    (error) => {
      assert.ok(error instanceof TaskProtocolError);
      assert.equal(error.code, 'TASK_REVISION_DUPLICATE_CONTENT');
      return true;
    },
  );

  const task = await prisma.task.findUnique({ where: { id: created.task.id } });
  assert.equal(task?.currentRevision, 1);
});

test('M3-01: concurrent revisions serialize on Task and produce a contiguous sealed chain', async () => {
  const fixture = await createIssuerFixture('concurrent');
  const created = await createTask(prisma, {
    issuerPrincipalId: fixture.principal.id,
    issuerAgentIdentityId: fixture.agent.id,
    ...revisionInput('concurrent-v1'),
  });

  const results = await Promise.all([
    reviseTask(prisma, { taskId: created.task.id, ...revisionInput('concurrent-v2a') }),
    reviseTask(prisma, { taskId: created.task.id, ...revisionInput('concurrent-v2b') }),
  ]);
  assert.deepEqual(results.map((result) => result.revision.revision).sort(), [2, 3]);

  const task = await prisma.task.findUnique({ where: { id: created.task.id } });
  const revisions = await prisma.taskRevision.findMany({
    where: { taskId: created.task.id },
    orderBy: { revision: 'asc' },
  });
  assert.equal(task?.currentRevision, 3);
  assert.deepEqual(revisions.map((revision) => revision.revision), [1, 2, 3]);
  assert.equal(revisions.every((revision) => Boolean(revision.sealedAt)), true);
});

test('M3-01: an open Task remains revisionable so old future Offers can become stale by exact revision/hash', async () => {
  const fixture = await createIssuerFixture('open');
  const created = await createTask(prisma, {
    issuerPrincipalId: fixture.principal.id,
    issuerAgentIdentityId: fixture.agent.id,
    ...revisionInput('open-v1'),
  });
  const opened = await openTask(prisma, { taskId: created.task.id });
  assert.equal(opened.status, 'open');
  assert.ok(opened.openedAt);

  const revised = await reviseTask(prisma, {
    taskId: created.task.id,
    ...revisionInput('open-v2'),
  });
  assert.equal(revised.task.status, 'open');
  assert.equal(revised.task.currentRevision, 2);
  assert.notEqual(revised.revision.contentHash, created.revision.contentHash);
});

test('M3-01: database deferred guard rejects a Task committed without a sealed revision chain', async () => {
  const fixture = await createIssuerFixture('deferred-guard');

  await assert.rejects(
    prisma.task.create({
      data: {
        issuerPrincipalId: fixture.principal.id,
        issuerAgentIdentityId: fixture.agent.id,
        visibility: 'private',
      },
    }),
  );
});
