import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  AuthorityResolutionError,
  assertDelegationNarrowing,
  createDelegatedMandate,
  evaluateAuthorityChain,
  isEconomicLimitsNarrowerOrEqual,
  isPolicyNarrowerOrEqual,
  isScopeSetNarrowerOrEqual,
  resolveAuthority,
  scopePatternCovers,
} from '../src/lib/authority/authority.mjs';

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

const HASH_CHARS = '0123456789abcdef';
let hashIndex = 0;
function nextHash() {
  const char = HASH_CHARS[hashIndex % HASH_CHARS.length];
  hashIndex += 1;
  return char.repeat(64);
}

function expectAuthorityCode(code) {
  return (error) => {
    assert.ok(error instanceof AuthorityResolutionError);
    assert.equal(error.code, code);
    return true;
  };
}

async function createAuthorityFixture(label, options = {}) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: {
      name: `M1-05 Org ${suffix}`,
      type: 'supplier',
    },
  });
  const principal = await prisma.principal.create({
    data: {
      type: 'organization',
      organizationId: organization.id,
    },
  });
  const primaryAgent = await prisma.agentIdentity.create({
    data: {
      principalId: principal.id,
      name: `Primary Agent ${suffix}`,
    },
  });
  const subAgent = await prisma.agentIdentity.create({
    data: {
      principalId: principal.id,
      name: `Sub Agent ${suffix}`,
    },
  });

  const validFrom = options.validFrom ?? new Date(Date.now() - 60_000);
  const validUntil = options.validUntil ?? new Date(Date.now() + 3_600_000);
  const rootMandate = await prisma.mandate.create({
    data: {
      mandateFamilyId: `root-family-${suffix}`,
      version: 1,
      issuerPrincipalId: principal.id,
      subjectAgentIdentityId: primaryAgent.id,
      actionScopes: ['task.*', 'offer.*'],
      capabilityScopes: ['urn:iwantu:capability:manufacturing.cam.*'],
      economicLimits: {
        singleContract: 500,
        daily: 2000,
        currency: 'IWC',
      },
      resourcePolicy: {
        allowedResourceRefs: ['resource:cad', 'resource:tooling'],
      },
      dataPolicy: {
        allowedDataRefs: ['asset:part', 'asset:drawing'],
        rawDataAccess: true,
      },
      counterpartyPolicy: {
        allow: ['principal:vendor-1', 'principal:vendor-2'],
      },
      validFrom,
      validUntil,
      delegationAllowed: true,
      maxDelegationDepth: 1,
      payloadHash: nextHash(),
      signatureAlgorithm: 'EdDSA',
      signatureKeyId: `principal-key-${suffix}`,
      signature: `principal-signature-${suffix}`,
    },
  });

  return {
    suffix,
    organization,
    principal,
    primaryAgent,
    subAgent,
    rootMandate,
  };
}

function delegatedInput(fixture, overrides = {}) {
  return {
    parentMandateId: fixture.rootMandate.id,
    subjectAgentIdentityId: fixture.subAgent.id,
    mandateFamilyId: `child-family-${fixture.suffix}-${Math.random().toString(16).slice(2)}`,
    version: 1,
    protocolVersion: 'iwantu-mandate/0.1',
    actionScopes: ['offer.submit'],
    capabilityScopes: ['urn:iwantu:capability:manufacturing.cam.toolpath.generate'],
    economicLimits: {
      singleContract: 200,
      daily: 1000,
      currency: 'IWC',
      concurrentExposure: 300,
    },
    resourcePolicy: {
      allowedResourceRefs: ['resource:cad'],
    },
    dataPolicy: {
      allowedDataRefs: ['asset:part'],
      rawDataAccess: false,
    },
    counterpartyPolicy: {
      allow: ['principal:vendor-1'],
    },
    validFrom: new Date(Date.now() - 5_000),
    validUntil: new Date(Date.now() + 1_800_000),
    payloadHash: nextHash(),
    signatureAlgorithm: 'EdDSA',
    signatureKeyId: `agent-key-${fixture.suffix}`,
    signature: `delegation-signature-${fixture.suffix}`,
    ...overrides,
  };
}

function rootFact(fixture, overrides = {}) {
  return {
    id: fixture.rootMandate.id,
    version: 1,
    payloadHash: fixture.rootMandate.payloadHash,
    issuerPrincipalId: fixture.principal.id,
    subjectAgentIdentityId: fixture.primaryAgent.id,
    actionScopes: ['task.*', 'offer.*'],
    capabilityScopes: ['urn:iwantu:capability:manufacturing.cam.*'],
    economicLimits: {
      singleContract: 500,
      daily: 2000,
      currency: 'IWC',
    },
    resourcePolicy: {
      allowedResourceRefs: ['resource:cad', 'resource:tooling'],
    },
    dataPolicy: {
      allowedDataRefs: ['asset:part', 'asset:drawing'],
      rawDataAccess: true,
    },
    counterpartyPolicy: {
      allow: ['principal:vendor-1', 'principal:vendor-2'],
    },
    validFrom: fixture.rootMandate.validFrom,
    validUntil: fixture.rootMandate.validUntil,
    delegationAllowed: true,
    maxDelegationDepth: 1,
    delegationDepth: 0,
    parentMandateId: null,
    delegatingAgentIdentityId: null,
    revokedAt: null,
    supersededAt: null,
    principalStatus: 'active',
    subjectAgentStatus: 'active',
    ...overrides,
  };
}

function childFact(fixture, parent, overrides = {}) {
  const input = delegatedInput(fixture);
  return {
    id: unique('child-fact'),
    version: input.version,
    payloadHash: input.payloadHash,
    issuerPrincipalId: parent.issuerPrincipalId,
    subjectAgentIdentityId: fixture.subAgent.id,
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
    delegationDepth: 1,
    parentMandateId: parent.id,
    delegatingAgentIdentityId: fixture.primaryAgent.id,
    revokedAt: null,
    supersededAt: null,
    principalStatus: 'active',
    subjectAgentStatus: 'active',
    ...overrides,
  };
}

test('M1-05: scope, economic and policy subset helpers are conservative', () => {
  assert.equal(scopePatternCovers('*', 'offer.accept'), true);
  assert.equal(scopePatternCovers('offer.*', 'offer.accept'), true);
  assert.equal(scopePatternCovers('offer.submit', 'offer.accept'), false);
  assert.equal(
    isScopeSetNarrowerOrEqual(
      ['urn:iwantu:capability:manufacturing.cam.*'],
      ['urn:iwantu:capability:manufacturing.cam.toolpath.generate'],
    ),
    true,
  );
  assert.equal(
    isScopeSetNarrowerOrEqual(['offer.submit'], ['offer.*']),
    false,
  );
  assert.equal(
    isEconomicLimitsNarrowerOrEqual(
      { singleContract: 500, daily: 2000, currency: 'IWC' },
      { singleContract: 200, daily: 1000, currency: 'IWC', concurrent: 300 },
    ),
    true,
  );
  assert.equal(
    isEconomicLimitsNarrowerOrEqual(
      { singleContract: 500, daily: 2000, currency: 'IWC' },
      { singleContract: 600, daily: 1000, currency: 'IWC' },
    ),
    false,
  );
  assert.equal(
    isPolicyNarrowerOrEqual(
      { allowedResourceRefs: ['resource:cad', 'resource:tooling'] },
      { allowedResourceRefs: ['resource:cad'] },
    ),
    true,
  );
  assert.equal(
    isPolicyNarrowerOrEqual(
      { rawDataAccess: false },
      { rawDataAccess: true },
    ),
    false,
  );
});

test('M1-05: delegation may only reduce authority in every modeled dimension', async () => {
  const fixture = await createAuthorityFixture('pure-narrowing');
  const parent = rootFact(fixture);
  const child = childFact(fixture, parent);
  assert.equal(assertDelegationNarrowing(parent, child), true);

  assert.throws(
    () => assertDelegationNarrowing(parent, { ...child, actionScopes: ['contract.form'] }),
    expectAuthorityCode('delegation_action_expansion'),
  );
  assert.throws(
    () =>
      assertDelegationNarrowing(parent, {
        ...child,
        capabilityScopes: ['urn:iwantu:capability:software.code.review'],
      }),
    expectAuthorityCode('delegation_capability_expansion'),
  );
  assert.throws(
    () =>
      assertDelegationNarrowing(parent, {
        ...child,
        economicLimits: { ...child.economicLimits, singleContract: 501 },
      }),
    expectAuthorityCode('delegation_economic_expansion'),
  );
  assert.throws(
    () =>
      assertDelegationNarrowing(parent, {
        ...child,
        resourcePolicy: { allowedResourceRefs: ['resource:outside'] },
      }),
    expectAuthorityCode('delegation_resource_expansion'),
  );
  assert.throws(
    () =>
      assertDelegationNarrowing(parent, {
        ...child,
        dataPolicy: { allowedDataRefs: ['asset:part'], rawDataAccess: true },
      }),
    expectAuthorityCode('delegation_data_expansion'),
  );
  assert.throws(
    () =>
      assertDelegationNarrowing(parent, {
        ...child,
        counterpartyPolicy: { allow: ['principal:vendor-3'] },
      }),
    expectAuthorityCode('delegation_counterparty_expansion'),
  );
});

test('M1-05: database enforces root attribution, delegating Agent, one-hop depth and parent lifetime', async () => {
  const fixture = await createAuthorityFixture('db-structure');
  const base = delegatedInput(fixture);

  await assert.rejects(
    prisma.mandate.create({
      data: {
        ...base,
        issuerPrincipalId: fixture.principal.id,
        subjectAgentIdentityId: fixture.subAgent.id,
        delegationAllowed: false,
        maxDelegationDepth: 0,
        delegationDepth: 1,
        parentMandateId: fixture.rootMandate.id,
        delegatingAgentIdentityId: fixture.subAgent.id,
      },
    }),
  );

  await assert.rejects(
    prisma.mandate.create({
      data: {
        ...delegatedInput(fixture, {
          mandateFamilyId: unique('bad-depth-family'),
          payloadHash: nextHash(),
        }),
        issuerPrincipalId: fixture.principal.id,
        subjectAgentIdentityId: fixture.subAgent.id,
        delegationAllowed: false,
        maxDelegationDepth: 0,
        delegationDepth: 2,
        parentMandateId: fixture.rootMandate.id,
        delegatingAgentIdentityId: fixture.primaryAgent.id,
      },
    }),
  );

  await assert.rejects(
    prisma.mandate.create({
      data: {
        ...delegatedInput(fixture, {
          mandateFamilyId: unique('bad-time-family'),
          payloadHash: nextHash(),
          validUntil: new Date(fixture.rootMandate.validUntil.getTime() + 60_000),
        }),
        issuerPrincipalId: fixture.principal.id,
        subjectAgentIdentityId: fixture.subAgent.id,
        delegationAllowed: false,
        maxDelegationDepth: 0,
        delegationDepth: 1,
        parentMandateId: fixture.rootMandate.id,
        delegatingAgentIdentityId: fixture.primaryAgent.id,
      },
    }),
  );
});

test('M1-05: controlled Delegation creates a one-hop child attributable to the root Principal', async () => {
  const fixture = await createAuthorityFixture('service-create');
  const child = await createDelegatedMandate(prisma, delegatedInput(fixture));

  assert.equal(child.issuerPrincipalId, fixture.principal.id);
  assert.equal(child.parentMandateId, fixture.rootMandate.id);
  assert.equal(child.delegatingAgentIdentityId, fixture.primaryAgent.id);
  assert.equal(child.subjectAgentIdentityId, fixture.subAgent.id);
  assert.equal(child.delegationDepth, 1);
  assert.equal(child.delegationAllowed, false);
  assert.equal(child.maxDelegationDepth, 0);

  await assert.rejects(
    createDelegatedMandate(
      prisma,
      delegatedInput(fixture, {
        mandateFamilyId: unique('economic-expansion-family'),
        payloadHash: nextHash(),
        economicLimits: {
          singleContract: 600,
          daily: 1000,
          currency: 'IWC',
        },
      }),
    ),
    expectAuthorityCode('delegation_economic_expansion'),
  );
});

test('M1-05: Authority Resolver returns deterministic chain evidence and effective narrowed authority', async () => {
  const fixture = await createAuthorityFixture('resolve');
  const child = await createDelegatedMandate(prisma, delegatedInput(fixture));

  const resolution = await resolveAuthority(prisma, {
    mandateId: child.id,
    subjectAgentIdentityId: fixture.subAgent.id,
    action: 'offer.submit',
    capabilityId: 'urn:iwantu:capability:manufacturing.cam.toolpath.generate',
    economic: {
      singleContract: 100,
      daily: 500,
      currency: 'IWC',
    },
    resourceRefs: ['resource:cad'],
    dataRefs: ['asset:part'],
    rawDataAccess: false,
    counterpartyPrincipalId: 'principal:vendor-1',
  });

  assert.equal(resolution.allowed, true);
  assert.equal(resolution.principalId, fixture.principal.id);
  assert.equal(resolution.subjectAgentIdentityId, fixture.subAgent.id);
  assert.equal(resolution.delegationDepth, 1);
  assert.deepEqual(
    resolution.mandateChain.map((entry) => entry.id),
    [fixture.rootMandate.id, child.id],
  );
  assert.deepEqual(resolution.effective.actionScopes, ['offer.submit']);
  assert.deepEqual(
    resolution.effective.capabilityScopes,
    ['urn:iwantu:capability:manufacturing.cam.toolpath.generate'],
  );
});

test('M1-05: Resolver fails closed for expanded requests and identity/lifecycle kill switches', async () => {
  const fixture = await createAuthorityFixture('fail-closed');
  const child = await createDelegatedMandate(prisma, delegatedInput(fixture));

  await assert.rejects(
    resolveAuthority(prisma, {
      mandateId: child.id,
      subjectAgentIdentityId: fixture.subAgent.id,
      action: 'contract.form',
    }),
    expectAuthorityCode('action_not_authorized'),
  );

  await assert.rejects(
    resolveAuthority(prisma, {
      mandateId: child.id,
      subjectAgentIdentityId: fixture.subAgent.id,
      action: 'offer.submit',
      capabilityId: 'urn:iwantu:capability:software.code.review',
    }),
    expectAuthorityCode('capability_not_authorized'),
  );

  await assert.rejects(
    resolveAuthority(prisma, {
      mandateId: child.id,
      subjectAgentIdentityId: fixture.subAgent.id,
      action: 'offer.submit',
      economic: { singleContract: 250 },
    }),
    expectAuthorityCode('economic_limit_exceeded'),
  );

  await assert.rejects(
    resolveAuthority(prisma, {
      mandateId: child.id,
      subjectAgentIdentityId: fixture.subAgent.id,
      action: 'offer.submit',
      dataRefs: ['asset:drawing'],
    }),
    expectAuthorityCode('data_not_authorized'),
  );

  await assert.rejects(
    resolveAuthority(prisma, {
      mandateId: child.id,
      subjectAgentIdentityId: fixture.subAgent.id,
      action: 'offer.submit',
      counterpartyPrincipalId: 'principal:vendor-2',
    }),
    expectAuthorityCode('counterparty_not_authorized'),
  );

  await prisma.agentIdentity.update({
    where: { id: fixture.subAgent.id },
    data: { status: 'suspended', suspendedAt: new Date() },
  });

  await assert.rejects(
    resolveAuthority(prisma, {
      mandateId: child.id,
      subjectAgentIdentityId: fixture.subAgent.id,
      action: 'offer.submit',
    }),
    expectAuthorityCode('agent_not_active'),
  );
});

test('M1-05: parent revocation prevents new Delegation and invalidates new commitments without erasing historical authority', async () => {
  const fixture = await createAuthorityFixture('revocation');
  const childInput = delegatedInput(fixture, {
    validFrom: new Date(Date.now() - 10_000),
  });
  const child = await createDelegatedMandate(prisma, childInput);
  const historicalAt = new Date(Date.now() - 2_000);

  const before = await resolveAuthority(prisma, {
    mandateId: child.id,
    subjectAgentIdentityId: fixture.subAgent.id,
    action: 'offer.submit',
    at: historicalAt,
  });
  assert.equal(before.allowed, true);

  const revokedAt = new Date();
  await prisma.mandateRevocation.create({
    data: {
      mandateId: fixture.rootMandate.id,
      revokedByPrincipalId: fixture.principal.id,
      reasonCode: 'root-revoked',
      payloadHash: nextHash(),
      signatureAlgorithm: 'EdDSA',
      signatureKeyId: `principal-key-${fixture.suffix}`,
      signature: `revocation-signature-${fixture.suffix}`,
      revokedAt,
    },
  });

  await assert.rejects(
    createDelegatedMandate(
      prisma,
      delegatedInput(fixture, {
        mandateFamilyId: unique('post-revoke-family'),
        payloadHash: nextHash(),
        validFrom: new Date(revokedAt.getTime() + 1),
      }),
    ),
    expectAuthorityCode('mandate_not_active'),
  );

  await assert.rejects(
    resolveAuthority(prisma, {
      mandateId: child.id,
      subjectAgentIdentityId: fixture.subAgent.id,
      action: 'offer.submit',
      at: new Date(revokedAt.getTime() + 1),
    }),
    expectAuthorityCode('mandate_not_active'),
  );

  const historical = await resolveAuthority(prisma, {
    mandateId: child.id,
    subjectAgentIdentityId: fixture.subAgent.id,
    action: 'offer.submit',
    at: historicalAt,
  });
  assert.equal(historical.allowed, true);
});

test('M1-05: superseded parent authority cannot form new commitments, while pre-supersession history remains reconstructable', async () => {
  const fixture = await createAuthorityFixture('supersession');
  const supersededAt = new Date(Date.now() + 5_000);
  const rootV2 = await prisma.mandate.create({
    data: {
      mandateFamilyId: fixture.rootMandate.mandateFamilyId,
      version: 2,
      issuerPrincipalId: fixture.principal.id,
      subjectAgentIdentityId: fixture.primaryAgent.id,
      actionScopes: ['offer.*'],
      capabilityScopes: ['urn:iwantu:capability:manufacturing.cam.*'],
      economicLimits: {
        singleContract: 400,
        daily: 1500,
        currency: 'IWC',
      },
      resourcePolicy: {
        allowedResourceRefs: ['resource:cad'],
      },
      dataPolicy: {
        allowedDataRefs: ['asset:part'],
        rawDataAccess: false,
      },
      counterpartyPolicy: {
        allow: ['principal:vendor-1'],
      },
      validFrom: supersededAt,
      validUntil: fixture.rootMandate.validUntil,
      delegationAllowed: true,
      maxDelegationDepth: 1,
      payloadHash: nextHash(),
      signatureAlgorithm: 'EdDSA',
      signatureKeyId: `principal-key-v2-${fixture.suffix}`,
      signature: `principal-signature-v2-${fixture.suffix}`,
      supersedesMandateId: fixture.rootMandate.id,
    },
  });
  assert.equal(rootV2.supersedesMandateId, fixture.rootMandate.id);

  const historical = await resolveAuthority(prisma, {
    mandateId: fixture.rootMandate.id,
    subjectAgentIdentityId: fixture.primaryAgent.id,
    action: 'offer.submit',
    at: new Date(supersededAt.getTime() - 1),
  });
  assert.equal(historical.allowed, true);

  await assert.rejects(
    resolveAuthority(prisma, {
      mandateId: fixture.rootMandate.id,
      subjectAgentIdentityId: fixture.primaryAgent.id,
      action: 'offer.submit',
      at: new Date(supersededAt.getTime() + 1),
    }),
    expectAuthorityCode('mandate_not_active'),
  );
});

test('M1-05: pure evaluator rejects malformed two-hop authority even if supplied outside Prisma', () => {
  const fakeFixture = {
    principal: { id: 'principal-root' },
    primaryAgent: { id: 'agent-primary' },
    subAgent: { id: 'agent-sub' },
    rootMandate: {
      id: 'mandate-root',
      payloadHash: 'a'.repeat(64),
      validFrom: new Date(Date.now() - 1_000),
      validUntil: new Date(Date.now() + 60_000),
    },
    suffix: 'pure',
  };
  const parent = rootFact(fakeFixture);
  const child = childFact(fakeFixture, parent, {
    parentMandateId: 'different-parent',
  });

  assert.throws(
    () =>
      evaluateAuthorityChain([parent, child], {
        mandateId: child.id,
        subjectAgentIdentityId: child.subjectAgentIdentityId,
        action: 'offer.submit',
      }),
    expectAuthorityCode('delegation_parent_mismatch'),
  );
});
