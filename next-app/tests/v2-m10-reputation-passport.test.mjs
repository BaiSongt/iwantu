import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  REPUTATION_PASSPORT_VERSION,
  ReputationPassportError,
  buildReputationPassportDocument,
} from '../src/lib/reputation/reputation-passport.mjs';

const serviceUrl = new URL(
  '../src/lib/reputation/reputation-passport.mjs',
  import.meta.url,
);
const routeUrl = new URL(
  '../src/app/api/public/v2/agent-identities/[id]/reputation-passport/route.ts',
  import.meta.url,
);

test('M10-04: passport is a versioned derived document backed by ReputationEvidence', () => {
  const passport = buildReputationPassportDocument({
    identity: {
      principalId: 'principal_supplier',
      principalType: 'organization',
      principalStatus: 'active',
      agentIdentityId: 'agent_supplier',
      agentName: 'Supplier Agent',
      agentStatus: 'active',
      agentCreatedAt: new Date('2026-09-01T00:00:00.000Z'),
    },
    reputation: {
      evidenceState: 'observed',
      evidenceCount: 4,
      settlementCount: 2,
      transactionEvidenceCount: 2,
      counterpartyPrincipalCount: 2,
      terminalOutcomes: { success: 2 },
      economic: {
        currency: 'IWC',
        grossSettledCredit: '40',
        subjectReceivedCredit: '40',
        counterpartyReceivedCredit: '0',
      },
    },
    globalTrust: {
      evidenceState: 'observed',
      independentSettlementCount: 2,
      independentCounterpartyPrincipalCount: 2,
      repeatIndependentSettlementCount: 0,
      topCounterpartySettlementShare: '0.50000000',
      samePrincipalSettlementCount: 0,
    },
    capabilities: [
      { capabilityId: 'urn:cap:z', evidenceState: 'observed' },
      { capabilityId: 'urn:cap:a', evidenceState: 'observed' },
    ],
  });

  assert.equal(passport.protocolVersion, REPUTATION_PASSPORT_VERSION);
  assert.equal(passport.sourceOfTruth, 'reputation_evidence');
  assert.equal(passport.derivedReadModel, true);
  assert.equal(passport.identity.agentIdentityId, 'agent_supplier');
  assert.deepEqual(
    passport.capabilityEvidence.map((item) => item.capabilityId),
    ['urn:cap:a', 'urn:cap:z'],
  );
});

test('M10-04: cold-start passport says insufficient evidence rather than low trust', () => {
  const passport = buildReputationPassportDocument({
    identity: {
      principalId: 'principal_new',
      principalType: 'organization',
      principalStatus: 'active',
      agentIdentityId: 'agent_new',
      agentName: 'New Agent',
      agentStatus: 'active',
      agentCreatedAt: '2026-09-21T00:00:00.000Z',
    },
    reputation: null,
    globalTrust: null,
    capabilities: [],
  });

  assert.equal(passport.evidenceState, 'insufficient_evidence');
  assert.equal(
    passport.globalTrustEvidence.evidenceState,
    'insufficient_evidence',
  );
  assert.equal(passport.trackRecord.settlementCount, 0);
  assert.equal(passport.capabilityEvidence.length, 0);
});

test('M10-04: protocol gaps are explicit instead of fabricated', () => {
  const passport = buildReputationPassportDocument({
    identity: {
      principalId: 'principal_a',
      principalType: 'organization',
      principalStatus: 'active',
      agentIdentityId: 'agent_a',
      agentName: 'Agent A',
      agentStatus: 'active',
      agentCreatedAt: '2026-09-01T00:00:00.000Z',
    },
    reputation: null,
    globalTrust: null,
    capabilities: [],
  });

  assert.equal(passport.versionEvidence.state, 'unbound');
  assert.equal(passport.integrityEvidence.state, 'not_available');
  assert.deepEqual(passport.integrityEvidence.signals, []);
});

test('M10-04: passport document introduces no opaque platform score', () => {
  const passport = buildReputationPassportDocument({
    identity: {
      principalId: 'p',
      principalType: 'organization',
      principalStatus: 'active',
      agentIdentityId: 'a',
      agentName: 'A',
      agentStatus: 'active',
      agentCreatedAt: null,
    },
    reputation: null,
    globalTrust: null,
    capabilities: [],
  });

  const serialized = JSON.stringify(passport);
  assert.doesNotMatch(
    serialized,
    /trustScore|reputationScore|weightedScore|rating|starRating/i,
  );
});

test('M10-04: invalid passport input fails closed', async () => {
  const source = await readFile(serviceUrl, 'utf8');

  assert.match(source, /REPUTATION_PASSPORT_INPUT_INVALID/);
  assert.match(source, /REPUTATION_PASSPORT_AGENT_NOT_FOUND/);
  assert.throws(
    () => buildReputationPassportDocument({ identity: null }),
    (error) =>
      error instanceof ReputationPassportError &&
      error.code === 'REPUTATION_PASSPORT_IDENTITY_INVALID',
  );
});

test('M10-04: live passport composes canonical evidence projectors rather than stale UI ratings', async () => {
  const source = await readFile(serviceUrl, 'utf8');

  assert.match(source, /iwantu_build_reputation_snapshot_projection/);
  assert.match(source, /iwantu_build_global_trust_projection/);
  assert.match(source, /iwantu_build_capability_reputation_projection/);
  assert.match(source, /FROM "reputation_evidence" e/);
  assert.match(source, /JOIN "task_capability_requirements" r/);
  assert.doesNotMatch(source, /agentProduct|successRate|review|star/i);
});

test('M10-04: public API is explicitly namespaced to v2 AgentIdentity', async () => {
  const source = await readFile(routeUrl, 'utf8');

  assert.match(source, /getReputationPassport/);
  assert.match(source, /agentIdentityId: id/);
  assert.match(source, /REPUTATION_PASSPORT_AGENT_NOT_FOUND/);
  assert.match(source, /apiSuccess\(passport\)/);
});
