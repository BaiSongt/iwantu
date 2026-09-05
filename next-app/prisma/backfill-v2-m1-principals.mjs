import { PrismaClient } from '@prisma/client';
import { pathToFileURL } from 'node:url';

function assertIndividualMapping(principal, userId) {
  if (
    principal.type !== 'individual' ||
    principal.userId !== userId ||
    principal.organizationId !== null
  ) {
    throw new Error(
      `Legacy User ${userId} is mapped to an invalid Principal ${principal.id}`,
    );
  }
}

function assertOrganizationMapping(principal, organizationId) {
  if (
    principal.type !== 'organization' ||
    principal.organizationId !== organizationId ||
    principal.userId !== null
  ) {
    throw new Error(
      `Legacy Organization ${organizationId} is mapped to an invalid Principal ${principal.id}`,
    );
  }
}

/**
 * Idempotently creates the v2 Principal shadow records for legacy control-plane
 * entities. User and Organization remain intact; buyer/supplier roles are not
 * copied into Principal because they are transaction roles in v2.
 */
export async function backfillPrincipals(prisma) {
  const [users, organizations] = await Promise.all([
    prisma.user.findMany({ select: { id: true, createdAt: true } }),
    prisma.organization.findMany({ select: { id: true, createdAt: true } }),
  ]);

  for (const user of users) {
    const principal = await prisma.principal.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        type: 'individual',
        userId: user.id,
        createdAt: user.createdAt,
      },
    });
    assertIndividualMapping(principal, user.id);
  }

  for (const organization of organizations) {
    const principal = await prisma.principal.upsert({
      where: { organizationId: organization.id },
      update: {},
      create: {
        type: 'organization',
        organizationId: organization.id,
        createdAt: organization.createdAt,
      },
    });
    assertOrganizationMapping(principal, organization.id);
  }

  return {
    usersSeen: users.length,
    organizationsSeen: organizations.length,
  };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await backfillPrincipals(prisma);
    console.log(
      `[v2-m1] Principal backfill complete: ${result.usersSeen} users, ${result.organizationsSeen} organizations`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;

if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error('[v2-m1] Principal backfill failed:', error);
    process.exitCode = 1;
  });
}
