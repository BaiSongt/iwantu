import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';

import {
  rebuildReputationSnapshot,
} from '../src/lib/reputation/reputation-snapshot.mjs';
import {
  rebuildGlobalTrustSnapshot,
  rebuildLocalTrustSnapshot,
} from '../src/lib/reputation/trust-projections.mjs';
import {
  rebuildCapabilityReputationSnapshot,
} from '../src/lib/reputation/capability-reputation.mjs';
import {
  getReputationPassport,
} from '../src/lib/reputation/reputation-passport.mjs';

const prisma = new PrismaClient();

before(async () => prisma.$connect());
after(async () => prisma.$disconnect());

function unique(label) {
  return label + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

async function createActor(label, orgType = 'supplier') {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: {
      name: 'M10 Org ' + suffix,
      type: orgType,
    },
  });
  const principal = await prisma.principal.create({
    data: {
      type: 'organization',
      organizationId: organization.id,
    },
  });
  const agent = await prisma.agentIdentity.create({
    data: {
      principalId: principal.id,
      name: 'M10 Agent ' + suffix,
    },
  });

  return { organization, principal, agent };
}

test('M10-05: all trust projections rebuild deterministically on real PostgreSQL with zero evidence', async () => {
  const subject = await createActor('subject');
  const counterparty = await createActor('counterparty', 'buyer');
  const capabilityId =
    'urn:iwantu:capability:test:m10-rebuild-hardening';

  const subjectInput = {
    subjectPrincipalId: subject.principal.id,
    subjectAgentIdentityId: subject.agent.id,
  };

  const reputation = await rebuildReputationSnapshot(prisma, subjectInput);
  const globalTrust = await rebuildGlobalTrustSnapshot(prisma, subjectInput);
  const localTrust = await rebuildLocalTrustSnapshot(prisma, {
    ...subjectInput,
    counterpartyPrincipalId: counterparty.principal.id,
    counterpartyAgentIdentityId: counterparty.agent.id,
  });
  const capability = await rebuildCapabilityReputationSnapshot(prisma, {
    ...subjectInput,
    capabilityId,
  });

  assert.equal(reputation.projection.evidenceState, 'insufficient_evidence');
  assert.equal(globalTrust.projection.evidenceState, 'insufficient_evidence');
  assert.equal(localTrust.projection.evidenceState, 'insufficient_evidence');
  assert.equal(localTrust.projection.globalEligible, true);
  assert.equal(capability.projection.evidenceState, 'insufficient_evidence');
  assert.equal(capability.projection.agentVersionBinding, 'unbound');

  const rebuilt = await rebuildReputationSnapshot(prisma, subjectInput);
  assert.equal(rebuilt.id, reputation.id);

  const rows = await prisma.$queryRawUnsafe(
    'SELECT count(*)::integer AS "count" FROM "reputation_snapshots" WHERE "subjectPrincipalId" = $1 AND "subjectAgentIdentityId" = $2',
    subject.principal.id,
    subject.agent.id,
  );
  assert.equal(rows[0].count, 1);
});

test('M10-05: canonical projection guards reject forged cache contents', async () => {
  const subject = await createActor('tamper-subject');
  const counterparty = await createActor('tamper-counterparty', 'buyer');

  const subjectInput = {
    subjectPrincipalId: subject.principal.id,
    subjectAgentIdentityId: subject.agent.id,
  };

  const reputation = await rebuildReputationSnapshot(prisma, subjectInput);
  const globalTrust = await rebuildGlobalTrustSnapshot(prisma, subjectInput);
  const localTrust = await rebuildLocalTrustSnapshot(prisma, {
    ...subjectInput,
    counterpartyPrincipalId: counterparty.principal.id,
    counterpartyAgentIdentityId: counterparty.agent.id,
  });
  const capability = await rebuildCapabilityReputationSnapshot(prisma, {
    ...subjectInput,
    capabilityId: 'urn:test:m10:tamper',
  });

  const forged = JSON.stringify({ forged: true });

  await assert.rejects(
    prisma.$executeRawUnsafe(
      'UPDATE "reputation_snapshots" SET "projection" = CAST($1 AS jsonb) WHERE "id" = $2',
      forged,
      reputation.id,
    ),
    /REPUTATION_SNAPSHOT_PROJECTION_MISMATCH/,
  );

  await assert.rejects(
    prisma.$executeRawUnsafe(
      'UPDATE "reputation_global_trust_snapshots" SET "projection" = CAST($1 AS jsonb) WHERE "id" = $2',
      forged,
      globalTrust.id,
    ),
    /REPUTATION_GLOBAL_TRUST_PROJECTION_MISMATCH/,
  );

  await assert.rejects(
    prisma.$executeRawUnsafe(
      'UPDATE "reputation_local_trust_snapshots" SET "projection" = CAST($1 AS jsonb) WHERE "id" = $2',
      forged,
      localTrust.id,
    ),
    /REPUTATION_LOCAL_TRUST_PROJECTION_MISMATCH/,
  );

  await assert.rejects(
    prisma.$executeRawUnsafe(
      'UPDATE "reputation_capability_snapshots" SET "projection" = CAST($1 AS jsonb) WHERE "id" = $2',
      forged,
      capability.id,
    ),
    /REPUTATION_CAPABILITY_PROJECTION_MISMATCH/,
  );
});

test('M10-05: deleting disposable caches never deletes evidence and rebuild restores canonical rows', async () => {
  const subject = await createActor('delete-rebuild-subject');
  const counterparty = await createActor('delete-rebuild-counterparty', 'buyer');
  const capabilityId = 'urn:test:m10:delete-rebuild';

  const subjectInput = {
    subjectPrincipalId: subject.principal.id,
    subjectAgentIdentityId: subject.agent.id,
  };

  const reputation = await rebuildReputationSnapshot(prisma, subjectInput);
  const globalTrust = await rebuildGlobalTrustSnapshot(prisma, subjectInput);
  const localTrust = await rebuildLocalTrustSnapshot(prisma, {
    ...subjectInput,
    counterpartyPrincipalId: counterparty.principal.id,
    counterpartyAgentIdentityId: counterparty.agent.id,
  });
  const capability = await rebuildCapabilityReputationSnapshot(prisma, {
    ...subjectInput,
    capabilityId,
  });

  const evidenceBefore = await prisma.$queryRawUnsafe(
    'SELECT count(*)::integer AS "count" FROM "reputation_evidence" WHERE "subjectPrincipalId" = $1 AND "subjectAgentIdentityId" = $2',
    subject.principal.id,
    subject.agent.id,
  );

  await prisma.$executeRawUnsafe(
    'DELETE FROM "reputation_snapshots" WHERE "id" = $1',
    reputation.id,
  );
  await prisma.$executeRawUnsafe(
    'DELETE FROM "reputation_global_trust_snapshots" WHERE "id" = $1',
    globalTrust.id,
  );
  await prisma.$executeRawUnsafe(
    'DELETE FROM "reputation_local_trust_snapshots" WHERE "id" = $1',
    localTrust.id,
  );
  await prisma.$executeRawUnsafe(
    'DELETE FROM "reputation_capability_snapshots" WHERE "id" = $1',
    capability.id,
  );

  const evidenceAfter = await prisma.$queryRawUnsafe(
    'SELECT count(*)::integer AS "count" FROM "reputation_evidence" WHERE "subjectPrincipalId" = $1 AND "subjectAgentIdentityId" = $2',
    subject.principal.id,
    subject.agent.id,
  );
  assert.equal(evidenceAfter[0].count, evidenceBefore[0].count);

  const rebuiltReputation = await rebuildReputationSnapshot(
    prisma,
    subjectInput,
  );
  const rebuiltGlobal = await rebuildGlobalTrustSnapshot(prisma, subjectInput);
  const rebuiltLocal = await rebuildLocalTrustSnapshot(prisma, {
    ...subjectInput,
    counterpartyPrincipalId: counterparty.principal.id,
    counterpartyAgentIdentityId: counterparty.agent.id,
  });
  const rebuiltCapability = await rebuildCapabilityReputationSnapshot(
    prisma,
    { ...subjectInput, capabilityId },
  );

  assert.equal(rebuiltReputation.id, reputation.id);
  assert.equal(rebuiltGlobal.id, globalTrust.id);
  assert.equal(rebuiltLocal.id, localTrust.id);
  assert.equal(rebuiltCapability.id, capability.id);
});

test('M10-05: public Reputation Passport remains useful for a cold-start Agent', async () => {
  const subject = await createActor('passport-cold-start');

  const passport = await getReputationPassport(prisma, {
    agentIdentityId: subject.agent.id,
  });

  assert.equal(passport.identity.agentIdentityId, subject.agent.id);
  assert.equal(passport.evidenceState, 'insufficient_evidence');
  assert.equal(passport.trackRecord.settlementCount, 0);
  assert.equal(passport.marketDiversity.independentSettlementCount, 0);
  assert.deepEqual(passport.capabilityEvidence, []);
  assert.equal(passport.versionEvidence.state, 'unbound');
  assert.equal(passport.integrityEvidence.state, 'not_available');
});
