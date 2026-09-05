import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after, before } from 'node:test';
import { PrismaClient } from '@prisma/client';
import {
  authenticateAgentApiToken,
  createAgentApiCredentialMaterial,
} from '../src/lib/agent-auth-core.mjs';
import {
  AuthenticationContextError,
  bindAuthorityToAuthentication,
  classifyAgentBearerToken,
  createLegacyAgentAuthenticationContext,
  createV2AgentAuthenticationContext,
} from '../src/lib/agent-auth-context-core.mjs';
import { resolveAuthority } from '../src/lib/authority/authority.mjs';

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

let hashIndex = 0;
function nextHash() {
  const chars = '0123456789abcdef';
  const first = chars[hashIndex % chars.length];
  const second = chars[(hashIndex + 7) % chars.length];
  hashIndex += 1;
  return `${first}${second}`.repeat(32);
}

function expectAuthenticationCode(code) {
  return (error) => {
    assert.ok(error instanceof AuthenticationContextError);
    assert.equal(error.code, code);
    return true;
  };
}

function fakeAuthority(principalId = 'principal-1', agentId = 'agent-1') {
  return {
    allowed: true,
    principalId,
    subjectAgentIdentityId: agentId,
    delegationDepth: 0,
    mandateChain: [{ id: 'mandate-1', version: 1, payloadHash: 'a'.repeat(64) }],
    effective: {
      actionScopes: ['contract.form'],
      capabilityScopes: ['manufacturing.cam.*'],
      economicLimits: { singleContract: 100 },
      resourcePolicy: {},
      dataPolicy: {},
      counterpartyPolicy: {},
      validFrom: new Date(),
      validUntil: null,
    },
  };
}

async function createV2Fixture(label) {
  const suffix = unique(label);
  const organization = await prisma.organization.create({
    data: { name: `M1-06 Org ${suffix}`, type: 'supplier' },
  });
  const principal = await prisma.principal.create({
    data: { type: 'organization', organizationId: organization.id },
  });
  const agent = await prisma.agentIdentity.create({
    data: { principalId: principal.id, name: `M1-06 Agent ${suffix}` },
  });

  const material = createAgentApiCredentialMaterial();
  const credential = await prisma.agentCredential.create({
    data: {
      agentIdentityId: agent.id,
      kind: 'api',
      keyId: material.keyId,
      prefix: material.prefix,
      secretHash: material.secretHash,
    },
  });

  const mandate = await prisma.mandate.create({
    data: {
      mandateFamilyId: `m1-06-family-${suffix}`,
      version: 1,
      issuerPrincipalId: principal.id,
      subjectAgentIdentityId: agent.id,
      actionScopes: ['offer.*', 'contract.form'],
      capabilityScopes: ['urn:iwantu:capability:manufacturing.cam.*'],
      economicLimits: {
        singleContract: 500,
        daily: 2000,
        currency: 'IWC',
      },
      resourcePolicy: { allowedResourceRefs: ['resource:cad'] },
      dataPolicy: {
        allowedDataRefs: ['asset:part'],
        rawDataAccess: false,
      },
      counterpartyPolicy: { allow: ['principal:vendor-1'] },
      validFrom: new Date(Date.now() - 60_000),
      validUntil: new Date(Date.now() + 3_600_000),
      delegationAllowed: false,
      maxDelegationDepth: 0,
      payloadHash: nextHash(),
      signatureAlgorithm: 'EdDSA',
      signatureKeyId: `principal-key-${suffix}`,
      signature: `principal-signature-${suffix}`,
    },
  });

  return { organization, principal, agent, material, credential, mandate };
}

test('M1-06: bearer classification distinguishes v2 credentials from legacy API keys without inferring authority', () => {
  const v2 = createAgentApiCredentialMaterial();
  assert.equal(classifyAgentBearerToken(v2.rawToken), 'v2_agent_credential');
  assert.equal(classifyAgentBearerToken('iwantu_legacy-example'), 'legacy_user_api_key');
  assert.equal(classifyAgentBearerToken('Bearer something-else'), 'unknown');
  assert.equal(classifyAgentBearerToken(''), 'unknown');
});

test('M1-06: legacy User/ApiKey scopes never fabricate Principal, AgentIdentity or protocol authority', () => {
  const legacy = createLegacyAgentAuthenticationContext({
    user: {
      id: 'legacy-user-1',
      name: 'Legacy User',
      email: 'legacy@example.test',
      role: 'admin',
      orgId: 'legacy-org-1',
    },
    scopes: ['write:*', 'contract.form', 'offer.accept'],
  });

  assert.equal(legacy.kind, 'legacy_user_api_key');
  assert.equal(legacy.securityLayer, 'legacy_access_only');
  assert.equal(legacy.canResolveProtocolAuthority, false);
  assert.equal(legacy.principal, null);
  assert.equal(legacy.agent, null);
  assert.equal(legacy.credential, null);
  assert.deepEqual(legacy.legacy.scopes, ['write:*', 'contract.form', 'offer.accept']);

  assert.throws(
    () => bindAuthorityToAuthentication(legacy, fakeAuthority()),
    expectAuthenticationCode('protocol_agent_required'),
  );
});

test('M1-06: authenticated AgentCredential produces identity-only context with no embedded Mandate authority', async () => {
  const fixture = await createV2Fixture('identity-only');
  const rawAuth = await authenticateAgentApiToken(prisma, fixture.material.rawToken);
  assert.equal(rawAuth.ok, true);
  if (!rawAuth.ok) return;

  const authentication = createV2AgentAuthenticationContext(rawAuth);
  assert.equal(authentication.kind, 'v2_agent_credential');
  assert.equal(authentication.securityLayer, 'access_identity_only');
  assert.equal(authentication.canResolveProtocolAuthority, true);
  assert.equal(authentication.principal.id, fixture.principal.id);
  assert.equal(authentication.agent.id, fixture.agent.id);
  assert.equal(authentication.credential.id, fixture.credential.id);
  assert.equal(authentication.legacy, null);

  for (const forbidden of [
    'scopes',
    'permissions',
    'mandate',
    'authority',
    'economicLimits',
    'signatureVerified',
  ]) {
    assert.equal(forbidden in authentication, false);
    assert.equal(forbidden in authentication.credential, false);
  }
});

test('M1-06: authenticated v2 Agent binds only to Authority resolved for the same Principal and AgentIdentity', async () => {
  const fixture = await createV2Fixture('binding');
  const rawAuth = await authenticateAgentApiToken(prisma, fixture.material.rawToken);
  assert.equal(rawAuth.ok, true);
  if (!rawAuth.ok) return;
  const authentication = createV2AgentAuthenticationContext(rawAuth);

  const authority = await resolveAuthority(prisma, {
    mandateId: fixture.mandate.id,
    subjectAgentIdentityId: fixture.agent.id,
    action: 'contract.form',
    capabilityId: 'urn:iwantu:capability:manufacturing.cam.toolpath.generate',
    economic: { singleContract: 100, currency: 'IWC' },
    resourceRefs: ['resource:cad'],
    dataRefs: ['asset:part'],
    rawDataAccess: false,
    counterpartyPrincipalId: 'principal:vendor-1',
  });

  const bound = bindAuthorityToAuthentication(authentication, authority);
  assert.equal(bound.kind, 'authenticated_authority_context');
  assert.equal(bound.securityStage, 'identity_and_authority_resolved');
  assert.equal(bound.economicSignatureRequired, true);
  assert.equal(bound.authentication.agent.id, fixture.agent.id);
  assert.equal(bound.authentication.principal.id, fixture.principal.id);
  assert.equal(bound.authority.mandateChain[0].id, fixture.mandate.id);
});

test('M1-06: credential identity and Authority Chain mismatches fail closed', async () => {
  const fixture = await createV2Fixture('mismatch');
  const rawAuth = await authenticateAgentApiToken(prisma, fixture.material.rawToken);
  assert.equal(rawAuth.ok, true);
  if (!rawAuth.ok) return;
  const authentication = createV2AgentAuthenticationContext(rawAuth);

  assert.throws(
    () =>
      bindAuthorityToAuthentication(
        authentication,
        fakeAuthority('different-principal', fixture.agent.id),
      ),
    expectAuthenticationCode('authenticated_principal_mismatch'),
  );

  assert.throws(
    () =>
      bindAuthorityToAuthentication(
        authentication,
        fakeAuthority(fixture.principal.id, 'different-agent'),
      ),
    expectAuthenticationCode('authenticated_agent_mismatch'),
  );
});

test('M1-06 compatibility: existing MCP remains on the legacy auth adapter and is not silently cut over', async () => {
  const mcpSource = await readFile(
    new URL('../src/app/api/mcp/route.ts', import.meta.url),
    'utf8',
  );
  const legacyAuthSource = await readFile(
    new URL('../src/lib/auth-agent.ts', import.meta.url),
    'utf8',
  );

  assert.match(mcpSource, /auth-agent/);
  assert.doesNotMatch(mcpSource, /auth-agent-context/);
  assert.doesNotMatch(mcpSource, /resolveAuthenticatedAgentAuthority/);
  assert.match(legacyAuthSource, /prisma\.apiKey\.findUnique/);
  assert.doesNotMatch(legacyAuthSource, /agentCredential/);
  assert.doesNotMatch(legacyAuthSource, /resolveAuthority/);
});
