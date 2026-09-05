import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  declareAgentCapability,
  registerCapabilityDefinition,
  upsertAgentMarketProfile,
} from '../src/lib/capability-discovery.mjs';

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

async function createAgentFixture(label) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `Capability Org ${suffix}`, type: 'supplier' },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `Capability Agent ${suffix}` },
  });
  const version = await prisma.agentVersion.create({
    data: {
      agentIdentityId: agent.id,
      version: `v-${suffix}`,
      softwareVersion: '1.0.0',
    },
  });
  return { suffix, organization, principal, agent, version };
}

test('M1-08: capability/discovery models remain separate from identity, authority and reputation', async () => {
  const schema = await readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8');
  const claimModel = schema.match(/model AgentCapabilityClaim \{([\s\S]*?)\n\}/)?.[1] ?? '';
  const profileModel = schema.match(/model AgentMarketProfile \{([\s\S]*?)\n\}/)?.[1] ?? '';

  assert.match(schema, /model CapabilityDefinition/);
  assert.match(claimModel, /agentVersionId/);
  assert.match(claimModel, /capabilityId/);
  assert.match(profileModel, /agentIdentityId/);

  for (const forbidden of [
    'successRate',
    'rating',
    'reputationScore',
    'trustScore',
    'economicLimit',
    'mandateId',
    'permission',
  ]) {
    assert.doesNotMatch(claimModel, new RegExp(forbidden, 'i'));
    assert.doesNotMatch(profileModel, new RegExp(forbidden, 'i'));
  }
});

test('M1-08: capability registry accepts arbitrary external namespaces and optional hierarchy', async () => {
  const suffix = unique('registry');
  const parentId = `https://example.external/capability/${suffix}`;
  const childId = `${parentId}/specialized`;

  const parent = await registerCapabilityDefinition(prisma, {
    id: parentId,
    name: 'External Capability',
    namespace: 'https://example.external/capability',
    version: '2026-09',
    schemaRef: 'https://example.external/schema/capability.json',
  });
  const child = await registerCapabilityDefinition(prisma, {
    id: childId,
    parentId: parent.id,
    name: 'External Specialized Capability',
    namespace: 'https://example.external/capability',
    metadata: { vendorExtension: true },
  });

  assert.equal(parent.id, parentId);
  assert.equal(child.parentId, parentId);
  assert.equal(child.namespace, 'https://example.external/capability');
});

test('M1-08: AgentVersion may declare an unregistered external capability because registry is not an allowlist', async () => {
  const fixture = await createAgentFixture('unknown-capability');
  const capabilityId = `urn:external:vendor:${fixture.suffix}:do-work`;

  const definition = await prisma.capabilityDefinition.findUnique({
    where: { id: capabilityId },
  });
  assert.equal(definition, null);

  const claim = await declareAgentCapability(prisma, {
    agentVersionId: fixture.version.id,
    capabilityId,
    descriptor: {
      inputSchema: 'urn:external:schema:input',
      outputSchema: 'urn:external:schema:output',
    },
  });

  assert.equal(claim.capabilityId, capabilityId);
  assert.equal(claim.claimStatus, 'declared');
});

test('M1-08: capability claims require a real AgentVersion and are unique per version/capability', async () => {
  const fixture = await createAgentFixture('claim-integrity');
  const capabilityId = `urn:iwantu:capability:test:${fixture.suffix}`;

  await declareAgentCapability(prisma, {
    agentVersionId: fixture.version.id,
    capabilityId,
  });

  await assert.rejects(
    declareAgentCapability(prisma, {
      agentVersionId: fixture.version.id,
      capabilityId,
    }),
  );

  await assert.rejects(
    declareAgentCapability(prisma, {
      agentVersionId: `missing-version-${fixture.suffix}`,
      capabilityId: `urn:external:missing:${fixture.suffix}`,
    }),
  );
});

test('M1-08: one mutable AgentMarketProfile belongs to one stable AgentIdentity', async () => {
  const fixture = await createAgentFixture('market-profile');

  const created = await upsertAgentMarketProfile(prisma, {
    agentIdentityId: fixture.agent.id,
    summary: 'CAM automation Agent',
    a2aCardUrl: 'https://agent.example.test/.well-known/agent-card.json',
    acceptsPublicTasks: true,
    availability: 'available',
    extensions: { protocol: 'a2a' },
  });
  const updated = await upsertAgentMarketProfile(prisma, {
    agentIdentityId: fixture.agent.id,
    summary: 'CAM automation Agent - updated market copy',
    acceptsPublicTasks: false,
    availability: 'busy',
  });

  assert.equal(created.id, updated.id);
  assert.equal(updated.agentIdentityId, fixture.agent.id);
  assert.equal(updated.summary, 'CAM automation Agent - updated market copy');
  assert.equal(updated.acceptsPublicTasks, false);
  assert.equal(updated.availability, 'busy');

  const profiles = await prisma.agentMarketProfile.findMany({
    where: { agentIdentityId: fixture.agent.id },
  });
  assert.equal(profiles.length, 1);
});

test('M1-08: AgentMarketProfile requires an existing AgentIdentity', async () => {
  await assert.rejects(
    upsertAgentMarketProfile(prisma, {
      agentIdentityId: unique('missing-agent'),
      summary: 'should fail',
    }),
  );
});

test('M1-08 compatibility: legacy AgentProduct remains a catalog object, not protocol capability truth', async () => {
  const fixture = await createAgentFixture('legacy-distinct');
  const legacy = await prisma.agentProduct.create({
    data: {
      orgId: fixture.organization.id,
      name: `Legacy AgentProduct ${fixture.suffix}`,
      summary: 'legacy catalog record',
      inputSpec: ['text'],
      outputSpec: ['text'],
      toolCalls: [],
      deploymentModes: ['api'],
      tags: ['legacy'],
    },
  });
  const profile = await upsertAgentMarketProfile(prisma, {
    agentIdentityId: fixture.agent.id,
    summary: 'v2 stable Agent discovery profile',
  });

  assert.notEqual(legacy.id, fixture.agent.id);
  assert.equal(profile.agentIdentityId, fixture.agent.id);
  assert.equal(legacy.agentIdentity, undefined);
});
