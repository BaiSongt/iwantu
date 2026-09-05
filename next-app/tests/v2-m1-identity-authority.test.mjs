import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { backfillPrincipals } from '../prisma/backfill-v2-m1-principals.mjs';

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

async function createLegacyFixture(label) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: {
      name: `M1 Org ${suffix}`,
      type: 'supplier',
    },
  });
  const user = await prisma.user.create({
    data: {
      name: `M1 User ${suffix}`,
      email: `${suffix}@example.test`,
      passwordHash: 'test-only-hash',
      role: 'buyer',
      orgId: organization.id,
    },
  });
  return { suffix, user, organization };
}

async function cleanupFixture(fixture) {
  const userIds = fixture.user ? [fixture.user.id] : [];
  const organizationIds = fixture.organization
    ? [fixture.organization.id]
    : [];

  const principalFilters = [];
  if (userIds.length) principalFilters.push({ userId: { in: userIds } });
  if (organizationIds.length) {
    principalFilters.push({ organizationId: { in: organizationIds } });
  }

  const principals = principalFilters.length
    ? await prisma.principal.findMany({
        where: { OR: principalFilters },
        select: { id: true },
      })
    : [];
  const principalIds = principals.map(({ id }) => id);

  if (principalIds.length) {
    const identities = await prisma.agentIdentity.findMany({
      where: { principalId: { in: principalIds } },
      select: { id: true },
    });
    const identityIds = identities.map(({ id }) => id);
    if (identityIds.length) {
      await prisma.agentVersion.deleteMany({
        where: { agentIdentityId: { in: identityIds } },
      });
    }
    await prisma.agentIdentity.deleteMany({
      where: { principalId: { in: principalIds } },
    });
    await prisma.principal.deleteMany({
      where: { id: { in: principalIds } },
    });
  }

  if (userIds.length) {
    await prisma.apiKey.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.demand.deleteMany({ where: { ownerUserId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (organizationIds.length) {
    await prisma.agentProduct.deleteMany({
      where: { orgId: { in: organizationIds } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: organizationIds } },
    });
  }
}

test('M1-01: User and Organization map to exactly one correctly typed Principal and backfill is idempotent', async (t) => {
  const fixture = await createLegacyFixture('mapping');
  t.after(() => cleanupFixture(fixture));

  await backfillPrincipals(prisma);
  const firstUserPrincipal = await prisma.principal.findUniqueOrThrow({
    where: { userId: fixture.user.id },
  });
  const firstOrgPrincipal = await prisma.principal.findUniqueOrThrow({
    where: { organizationId: fixture.organization.id },
  });

  assert.equal(firstUserPrincipal.type, 'individual');
  assert.equal(firstUserPrincipal.organizationId, null);
  assert.equal(firstOrgPrincipal.type, 'organization');
  assert.equal(firstOrgPrincipal.userId, null);

  await backfillPrincipals(prisma);

  const userMappings = await prisma.principal.findMany({
    where: { userId: fixture.user.id },
  });
  const orgMappings = await prisma.principal.findMany({
    where: { organizationId: fixture.organization.id },
  });
  assert.equal(userMappings.length, 1);
  assert.equal(orgMappings.length, 1);
  assert.equal(userMappings[0].id, firstUserPrincipal.id);
  assert.equal(orgMappings[0].id, firstOrgPrincipal.id);

  await assert.rejects(
    prisma.principal.create({
      data: { type: 'individual', userId: fixture.user.id },
    }),
  );
  await assert.rejects(
    prisma.principal.create({
      data: {
        type: 'organization',
        organizationId: fixture.organization.id,
      },
    }),
  );
});

test('M1-02: AgentIdentity requires an existing Principal', async () => {
  await assert.rejects(
    prisma.agentIdentity.create({
      data: {
        principalId: unique('missing-principal'),
        name: 'Invalid Agent',
      },
    }),
  );
});

test('M1-02: AgentVersion requires an existing AgentIdentity', async () => {
  await assert.rejects(
    prisma.agentVersion.create({
      data: {
        agentIdentityId: unique('missing-agent'),
        version: '1.0.0',
      },
    }),
  );
});

test('M1-02: suspended/retired identities and their AgentVersion history remain resolvable', async (t) => {
  const fixture = await createLegacyFixture('history');
  t.after(() => cleanupFixture(fixture));
  await backfillPrincipals(prisma);

  const principal = await prisma.principal.findUniqueOrThrow({
    where: { organizationId: fixture.organization.id },
  });
  const identity = await prisma.agentIdentity.create({
    data: {
      principalId: principal.id,
      name: 'Historical Agent',
      versions: {
        create: {
          version: '1.0.0',
          softwareVersion: 'build-1',
          runtimeMeta: { runtime: 'test-runtime' },
          modelMeta: { provider: 'test-provider', model: 'test-model' },
          capabilityImplementationMeta: { revision: 'cap-v1' },
        },
      },
    },
  });

  await prisma.agentIdentity.update({
    where: { id: identity.id },
    data: { status: 'suspended', suspendedAt: new Date() },
  });
  await prisma.agentIdentity.update({
    where: { id: identity.id },
    data: { status: 'retired', retiredAt: new Date() },
  });

  const retired = await prisma.agentIdentity.findUniqueOrThrow({
    where: { id: identity.id },
    include: { versions: true },
  });
  assert.equal(retired.status, 'retired');
  assert.equal(retired.versions.length, 1);
  assert.equal(retired.versions[0].version, '1.0.0');

  // Restrict deletion while version history exists; retirement is the lifecycle path.
  await assert.rejects(
    prisma.agentIdentity.delete({ where: { id: identity.id } }),
  );
});

test('M1-02: AgentIdentity ownership cannot be moved across Principals', async (t) => {
  const fixture = await createLegacyFixture('ownership');
  t.after(() => cleanupFixture(fixture));
  await backfillPrincipals(prisma);

  const owner = await prisma.principal.findUniqueOrThrow({
    where: { organizationId: fixture.organization.id },
  });
  const other = await prisma.principal.findUniqueOrThrow({
    where: { userId: fixture.user.id },
  });
  const identity = await prisma.agentIdentity.create({
    data: { principalId: owner.id, name: 'Owned Agent' },
  });

  await assert.rejects(
    prisma.agentIdentity.update({
      where: { id: identity.id },
      data: { principalId: other.id },
    }),
  );

  const unchanged = await prisma.agentIdentity.findUniqueOrThrow({
    where: { id: identity.id },
  });
  assert.equal(unchanged.principalId, owner.id);
});

test('M1 compatibility: legacy ApiKey, Demand and AgentProduct remain usable; AgentProduct only links to AgentIdentity', async (t) => {
  const fixture = await createLegacyFixture('legacy');
  t.after(() => cleanupFixture(fixture));
  await backfillPrincipals(prisma);

  const apiKey = await prisma.apiKey.create({
    data: {
      key: `iwantu_test_${fixture.suffix}`,
      name: 'legacy compatibility key',
      userId: fixture.user.id,
      scopes: ['read'],
    },
  });
  const demand = await prisma.demand.create({
    data: {
      ownerUserId: fixture.user.id,
      ownerOrgId: fixture.organization.id,
      title: 'Legacy demand compatibility',
      industry: 'test',
      budgetRange: 'test',
      deliveryPeriod: 'test',
      dataTypes: [],
      deploymentRequirement: 'test',
    },
  });
  const agentProduct = await prisma.agentProduct.create({
    data: {
      orgId: fixture.organization.id,
      name: 'Legacy marketplace display agent',
      summary: 'display model only',
      inputSpec: [],
      outputSpec: [],
      toolCalls: [],
      deploymentModes: [],
      tags: [],
    },
  });

  const principal = await prisma.principal.findUniqueOrThrow({
    where: { organizationId: fixture.organization.id },
  });
  const identity = await prisma.agentIdentity.create({
    data: {
      principalId: principal.id,
      legacyAgentProductId: agentProduct.id,
      name: 'Stable protocol identity',
      versions: { create: { version: 'legacy-bootstrap-v1' } },
    },
  });

  const legacyDisplay = await prisma.agentProduct.findUniqueOrThrow({
    where: { id: agentProduct.id },
    include: { agentIdentity: true },
  });

  assert.equal((await prisma.apiKey.findUnique({ where: { id: apiKey.id } }))?.id, apiKey.id);
  assert.equal((await prisma.demand.findUnique({ where: { id: demand.id } }))?.id, demand.id);
  assert.equal(legacyDisplay.agentIdentity?.id, identity.id);
  assert.notEqual(legacyDisplay.id, identity.id);
});
